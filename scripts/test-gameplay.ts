/**
 * 倒子麻将 · 玩法全量回归（LayaAir / Web 共用逻辑）
 *
 * 运行： pnpm test:gameplay
 *
 * 这一套按 LayaAir 的工程约定只测纯 TypeScript 规则层：
 * - 不依赖 LayaAir 的 DOM / 渲染 / 生命周期，测试可以直接跑在 Node；
 * - 每个场景都用固定手牌和固定牌墙，避免随机；
 * - 同一组算例同时跑 web `src/game` 和 LayaAir `layair/src/game`，确保移植后规则一致。
 */

import {
  daLiaoCheForbiddenTiles,
  isAbsolutelySafe,
  isKong,
  meldTiles,
  scoreHand,
  suitTiles,
  type Meld,
  type ScoreInput,
  type Tile
} from '../src/game/score'
import { scoreHand as layaScoreHand } from '../layair/src/game/score'
import {
  applyAction,
  chooseAIAction,
  createHand,
  forbiddenDiscardsFor,
  isDaLiaoChe,
  kongOptionsFor,
  legalActions,
  legalDiscards,
  playableDiscards,
  settleHand,
  wallVisualOf,
  type HandState,
  type RoundAction
} from '../src/game/game'
import {
  applyAction as layaApplyAction,
  createHand as layaCreateHand,
  legalActions as layaLegalActions
} from '../layair/src/game/game'

/* ------------------------------------------------------------------ *
 * 测试工具
 * ------------------------------------------------------------------ */

let checks = 0
let failures = 0

const check = (label: string, actual: unknown, expected: unknown) => {
  checks += 1
  if (actual === expected) {
    console.log(`  ✓ ${label}: ${actual}`)
    return
  }
  failures += 1
  console.log(`  ✗ ${label}: 期望 ${expected}，实际 ${actual}`)
}

const checkTrue = (label: string, actual: unknown) => check(label, !!actual, true)

const section = (title: string) => {
  console.log(`\n${'='.repeat(72)}`)
  console.log(title)
  console.log('='.repeat(72))
}

const pung = (tile: Tile): Meld => ({ kind: '碰', tile })
const kong = (tile: Tile, kind: Meld['kind'] = '明杠'): Meld => ({ kind, tile })

const hasItem = (input: ScoreInput, name: string, points?: number): boolean => {
  const result = scoreHand(input)
  return result.points.items.some(item => item.name === name && (points === undefined || item.points === points))
}

const itemPoints = (input: ScoreInput, name: string): number =>
  scoreHand(input).points.items.find(item => item.name === name)?.points ?? 0

/** 同一输入跑 web / LayaAir 两份 score，返回 web 结果；顺便校验移植一致性 */
const scoreBoth = (label: string, input: ScoreInput) => {
  const web = scoreHand(input)
  const laya = layaScoreHand(input)
  const summarize = (r: ReturnType<typeof scoreHand>) =>
    JSON.stringify({
      win: r.isWinningHand,
      points: r.points.total,
      items: r.points.items.map(i => [i.name, i.points, i.count]),
      big: r.bigWin.isBigWin,
      reasons: r.bigWin.reasons.map(i => i.name),
      mozi: [r.mozi.big, r.mozi.small, r.mozi.units],
      money: r.money
    })
  check(`${label}：LayaAir 与 web 结算一致`, summarize(web), summarize(laya))
  return web
}

/** 选完四家缺门，进入摸牌 */
const ready = (
  hands: Tile[][],
  piles: Tile[][],
  shortages: Array<'万' | '筒' | '条'> = ['万', '筒', '条', '万']
): HandState => {
  let state = createHand({ diceA: 1, diceB: 4, hands, piles, aiSeats: [] })
  for (const seat of [0, 1, 2, 3]) {
    state = applyAction(state, {
      type: 'chooseShortage',
      seat,
      suit: shortages[seat]
    } as RoundAction)
  }
  return state
}

const baseHands = (): Tile[][] => [
  ['1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '1条', '2条', '3条', '4条'],
  ['1条', '1条', '2条', '2条', '3条', '3条', '4条', '4条', '5条', '5条', '6条', '6条', '7条'],
  ['1万', '1万', '2万', '2万', '3万', '3万', '4万', '4万', '5万', '5万', '6万', '6万', '7万'],
  ['1筒', '1筒', '2筒', '2筒', '3筒', '3筒', '4筒', '4筒', '6筒', '6筒', '7筒', '7筒', '8筒']
]

const basePiles = (): Tile[][] => [['9筒'], ['1条'], ['1条'], ['1条']]

/** 把一张牌打出去，返回 claim 状态；用于接牌优先级测试 */
const discardToClaim = (state: HandState, seat: number, tile: Tile): HandState => {
  const next: HandState = {
    ...state,
    players: state.players.map(player => ({ ...player, hand: [...player.hand] })),
    piles: state.piles.map(pile => [...pile]),
    pileMeta: state.pileMeta.map(pile => pile.map(item => ({ ...item }))),
    phase: 'discard',
    turn: seat,
    drawnTile: tile,
    robKong: null
  }
  if (!next.players[seat].hand.includes(tile)) next.players[seat].hand.push(tile)
  return applyAction(next, { type: 'discard', seat, tile })
}

/* ------------------------------------------------------------------ *
 * 1. 基础结构 / 只子 / 通 / 连号 / 对子
 * ------------------------------------------------------------------ */

section('1. 基础结构：只子、通、连号、对子、四活、不动手')

{
  // 只子：B 的 9 筒，外面还有 2 条 5 条，基础手牌是 123456789筒 + 234条 + 55条
  const zhizi = { concealed: [...suitTiles('筒'), '2条', '3条', '4条', '5条', '5条'] }
  const result = scoreBoth('只子 9 筒', zhizi)
  check('同一门 9 张 → 只子 2 点', itemPoints(zhizi, '只子'), 2)
  check('只子说明包含张数', result.details.some(line => line.includes('只子') && line.includes('9 张')), true)

  // 只子上限：10 张只算 3 点，12 张封顶 5 点
  const twelve = scoreBoth('只子上限', {
    concealed: ['1万', '1万', '1万', '2万', '2万', '2万', '3万', '3万', '3万', '4万', '4万', '4万', '5万', '5万']
  })
  check('一色 12 张 → 只子封顶 5 点', twelve.points.items.find(i => i.name === '只子')?.points, 5)

  // 只子按门分别计算：这一手只有万满 8 张
  const oneZhizi = scoreBoth('单门只子', {
    concealed: ['1万', '2万', '3万', '4万', '5万', '6万', '7万', '8万', '1筒', '2筒', '3筒', '4筒', '5筒', '6筒']
  })
  check('只有万满 8 张 → 只子只有 1 点', oneZhizi.points.items.filter(i => i.name === '只子').map(i => i.points).join(','), '1')

  // 通：3 筒×3 + 3 条×2，其他牌凑成合法成牌
  const tong = {
    concealed: ['3筒', '3筒', '3筒', '3条', '3条', '1筒', '2筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '9筒']
  }
  scoreBoth('通 5 张', tong)
  check('3 跨 2 门共 5 张 → 5 通', itemPoints(tong, '通'), 5)

  // 通封顶 8：4 万×4 + 4 筒×4（碰/杠只用于提供跨门张数）
  const tong8 = {
    concealed: ['1条', '2条', '3条', '5条', '6条', '7条', '9条', '9条'],
    melds: [kong('4万'), kong('4筒')]
  }
  scoreBoth('通封顶', tong8)
  check('4 跨 2 门共 8 张 → 通封顶 8 点', itemPoints(tong8, '通'), 8)

  // 小连号：手上恰好 234567 万
  const smallRun = {
    concealed: ['2万', '3万', '4万', '5万', '6万', '7万', '7筒', '8筒', '9筒', '5条', '5条']
  }
  scoreBoth('小连号', smallRun)
  check('手牌连续六张 → 小连号 +5', itemPoints(smallRun, '小连号'), 5)

  // 大连号：1–9 筒齐张
  const bigRun = { concealed: [...suitTiles('筒'), '2条', '3条', '4条', '5条', '5条'] }
  scoreBoth('大连号', bigRun)
  check('1–9 同门齐张 → 大连号 +20', itemPoints(bigRun, '大连号'), 20)

  // 双连号：两门小连号 + 逢2加1
  const doubleRun = {
    concealed: ['1万', '2万', '3万', '4万', '5万', '6万', '1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '5条', '5条'],
    winTile: '1万'
  }
  const doubleResult = scoreBoth('双连号', doubleRun)
  check('两门小连号 → 双连号 +5', itemPoints(doubleRun, '双连号'), 5)
  check('双连号 24 点', doubleResult.points.total, 24)
  check('双连号本身不是大拿', doubleResult.bigWin.isBigWin, false)

  // 234456 不算小连号，必须有完整 234567
  const notRun = {
    concealed: ['2万', '3万', '4万', '4万', '5万', '6万', '7筒', '8筒', '9筒', '5条', '5条'],
    melds: [pung('7万')]
  }
  scoreBoth('234456 不是连号', notRun)
  check('234456 万 + 碰 7 万不算小连号', hasItem(notRun, '小连号'), false)

  // 棒棒：223344 万
  const bangBang = {
    concealed: ['2万', '2万', '3万', '3万', '4万', '4万', '5万', '6万', '7万', '7万', '8万', '9万', '5条', '5条']
  }
  scoreBoth('棒棒', bangBang)
  check('同门连续三组对子 → 棒棒 +5', itemPoints(bangBang, '棒棒'), 5)

  // 四活 + 七对：1111 万 + 五对
  const four = {
    concealed: ['1万', '1万', '1万', '1万', '2筒', '2筒', '3筒', '3筒', '4筒', '4筒', '5条', '5条', '6条', '6条']
  }
  const fourResult = scoreBoth('四活 + 七对', four)
  check('未开杠的四张 → 四活 +10', itemPoints(four, '四活'), 10)
  check('四活 + 七对 → 大拿', fourResult.bigWin.isBigWin, true)
  check('大拿原因含七对/四活组合', fourResult.bigWin.reasons.some(r => r.name === '两个大牌型'), true)

  // 不动手：没有碰杠
  const buDong = { concealed: [...suitTiles('筒'), '2条', '3条', '4条', '5条', '5条'] }
  scoreBoth('不动手', buDong)
  check('没有碰杠 → 不动手 +5', itemPoints(buDong, '不动手'), 5)

  // 暗杠仍然算不动手
  const darkKong = {
    concealed: [...suitTiles('筒'), '5条', '5条'],
    melds: [kong('东', '暗杠')]
  }
  scoreBoth('暗杠算不动手', darkKong)
  check('暗杠 → 不动手仍 +5', itemPoints(darkKong, '不动手'), 5)

  // 草一色：一门数字 + 字牌
  const grass = {
    concealed: ['1万', '2万', '3万', '4万', '5万', '6万', '7万', '8万', '9万', '东', '东', '东', '中', '中']
  }
  scoreBoth('草一色', grass)
  check('一门数字 + 字牌 → 草一色 +10', itemPoints(grass, '草一色'), 10)

  // 对对胡
  const allTriplets = {
    concealed: ['1万', '1万', '1万', '3万', '3万', '3万', '5万', '5万', '5万', '东', '东', '东', '中', '中']
  }
  scoreBoth('对对胡', allTriplets)
  check('全刻子 + 一对将 → 对对胡 +10', itemPoints(allTriplets, '对对胡'), 10)

  // 副露张数：碰 3、明杠/暗杠 4，供牌河/牌墙和亮牌逻辑共用
  check('碰展开 3 张', meldTiles(pung('东')).length, 3)
  check('明杠展开 4 张', meldTiles(kong('东', '明杠')).length, 4)
  check('暗杠展开 4 张', meldTiles(kong('东', '暗杠')).length, 4)
  check('明杠/暗杠都算杠', `${isKong(kong('东', '明杠'))},${isKong(kong('东', '暗杠'))}`, 'true,true')
}

/* ------------------------------------------------------------------ *
 * 2. 成牌张相关：压当、单吊、枯只压、老小对
 * ------------------------------------------------------------------ */

section('2. 成牌张相关：压当、单吊、枯只压、老小对')

{
  const concealed = [
    '4筒',
    '5筒',
    '6筒',
    '1条',
    '1条',
    '1条',
    '2条',
    '3条',
    '4条',
    '5条',
    '6条',
    '7条',
    '9条',
    '9条'
  ]
  const middle = { concealed, winTile: '5筒' }
  const middleResult = scoreBoth('压当', middle)
  check('成牌张补顺子中张 → 压当', middleResult.patterns['压当'], true)
  check('压当 +1 点', itemPoints(middle, '压当'), 1)
  check('普通压当摸子 1 个大摸子', middleResult.mozi.units, 1)

  const pair = { concealed, winTile: '9条' }
  const pairResult = scoreBoth('单吊', pair)
  check('成牌张补将牌 → 单吊', pairResult.patterns['单吊'], true)
  check('单吊 +1 点', itemPoints(pair, '单吊'), 1)
  check('单吊摸子 1 个大摸子', pairResult.mozi.units, 1)

  // 枯只压：卡张 5筒且外面已经出了 3 张
  const ku = scoreBoth('枯只压接牌', { concealed, winTile: '5筒', visibleWinTileCount: 3 })
  check('外面出 3 张 + 只能等 5 筒 → 枯只压', ku.mozi.items.some(i => i.name === '枯只压'), true)
  check('枯只压接牌 = 1 大 + 1 小', `${ku.mozi.big} 大 + ${ku.mozi.small} 小`, '1 大 + 1 小')

  const kuSelf = scoreBoth('枯只压自摸', { concealed, winTile: '5筒', visibleWinTileCount: 3, selfDraw: true })
  check('枯只压自摸 = 3 大', `${kuSelf.mozi.big} 大 + ${kuSelf.mozi.small} 小`, '3 大 + 0 小')

  const notKu = scoreBoth('枯只压边界：外面 2 张', { concealed, winTile: '5筒', visibleWinTileCount: 2 })
  check('外面只有 2 张 → 不是枯只压', notKu.mozi.items.some(i => i.name === '枯只压'), false)

  // 边张：89 等 7 / 12 等 3 也算只等一张；23 等 1 两面不算
  const edgeBase = ['1万', '2万', '3万', '4万', '5万', '6万', '1条', '2条', '3条', '9条', '9条']
  const lowEdge = scoreBoth('边张 89 等 7', { concealed: ['7筒', '8筒', '9筒', ...edgeBase], winTile: '7筒', visibleWinTileCount: 3 })
  check('89 等 7 + 外面 3 张 → 枯只压', lowEdge.mozi.items.some(i => i.name === '枯只压'), true)
  const highEdge = scoreBoth('边张 12 等 3', { concealed: ['1筒', '2筒', '3筒', ...edgeBase], winTile: '3筒', visibleWinTileCount: 3 })
  check('12 等 3 + 外面 3 张 → 枯只压', highEdge.mozi.items.some(i => i.name === '枯只压'), true)
  const twoWay = scoreBoth('两面 23 等 1', { concealed: ['1筒', '2筒', '3筒', ...edgeBase], winTile: '1筒', visibleWinTileCount: 3 })
  check('23 等 1 两面 → 不算枯只压', twoWay.mozi.items.some(i => i.name === '枯只压'), false)

  // 老小对：同门对 1 + 对 9，碰出来的也算；只计一门
  const laoXiao = {
    concealed: ['9筒', '9筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '1条', '2条', '3条'],
    melds: [pung('1筒')]
  }
  scoreBoth('老小对', laoXiao)
  check('同门对 1 + 对 9 → 老小对 +5', itemPoints(laoXiao, '老小对'), 5)
  check('老小对说明带花色', scoreHand(laoXiao).details.some(line => line.includes('筒 同时有对 1 和对 9')), true)

  const laoXiaoOff = scoreHand({ ...laoXiao, rules: { laoXiaoDuiEnabled: false } })
  check('关闭老小对开关 → 不再计算', laoXiaoOff.points.items.some(i => i.name === '老小对'), false)
}

/* ------------------------------------------------------------------ *
 * 3. 七对 / 大吊车 / 三打一 / 杠开 / 清水
 * ------------------------------------------------------------------ */

section('3. 七对、大吊车、三打一、杠开、清水')

{
  const sevenPairs = {
    concealed: ['1筒', '1筒', '5筒', '5筒', '2条', '2条', '8条', '8条', '3万', '3万', '7万', '7万', '东', '东']
  }
  const seven = scoreBoth('普通七对', sevenPairs)
  check('七个对子 → 七对 +31', itemPoints(sevenPairs, '七对'), 31)
  check('普通七对不是大拿', seven.bigWin.isBigWin, false)

  const daDiaoChe = {
    concealed: ['9条', '9条'],
    melds: [pung('1筒'), pung('2筒'), pung('3筒'), pung('4筒')],
    winTile: '9条'
  }
  const daDiao = scoreBoth('大吊车', daDiaoChe)
  check('四组碰 + 单吊 → 大吊车', daDiao.patterns['大吊车'], true)
  check('大吊车 +31', itemPoints(daDiaoChe, '大吊车'), 31)
  check('大吊车是大拿', daDiao.bigWin.isBigWin, true)
  check('大吊车单吊摸子 1 大', daDiao.mozi.units, 1)

  const threeToOne = scoreBoth('三打一', { concealed: [...suitTiles('筒'), '2条', '2条', '2条', '5条', '5条'], threeToOne: true })
  check('三家缺同一门 → 三打一 +5', itemPoints({ concealed: [...suitTiles('筒'), '2条', '2条', '2条', '5条', '5条'], threeToOne: true }, '三打一'), 5)
  check('三打一附 1 小摸子', threeToOne.mozi.items.some(i => i.name === '三打一' && i.units === 0.5), true)

  // 三打一：三家缺条、自己缺万时，自己从定缺结束起标记为明牌；成牌时自动带 +5 / 小摸子
  let threeState = ready([
    ['1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '2条', '2条', '2条', '5条'],
    baseHands()[1],
    baseHands()[2],
    baseHands()[3]
  ], basePiles(), ['万', '条', '条', '条'])
  check('三打一：定缺后标记明牌座位', threeState.threeToOneSeat, 0)
  threeState.players[0].hand = ['1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '2条', '2条', '2条', '5条']
  threeState.phase = 'discard'
  threeState.turn = 0
  threeState.drawnTile = '5条'
  const threeWin = applyAction(threeState, { type: 'win', seat: 0 })
  check('三打一：成牌时自动计入 +5', threeWin.winner?.score.points.items.some(i => i.name === '三打一' && i.points === 5), true)
  check('三打一：成牌时自动计入小摸子', threeWin.winner?.score.mozi.items.some(i => i.name === '三打一' && i.units === 0.5), true)

  const kongOpen = { concealed: [...suitTiles('筒'), '5条', '5条'], isAfterKong: true }
  const kongOpenResult = scoreBoth('杠开', kongOpen)
  check('杠后补摸 → 杠开 +5', itemPoints(kongOpen, '杠开'), 5)
  check('杠开按自摸翻倍', kongOpenResult.points.multiplier, 2)
  check('杠后赛花摸子 ×2', kongOpenResult.mozi.multiplier, 2)

  const qingShui = scoreBoth('清水', {
    concealed: ['1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '1条', '2条', '3条', '4条', '4条'],
    selfDraw: true,
    isFirstHand: true
  })
  check('首牌大拿 → 清水摸子', qingShui.mozi.items.some(i => i.name === '清水' && i.units === 1.5), true)
  const qingShuiItem = qingShui.mozi.items.find(i => i.name === '清水')
  check('清水摸子 = 1 大 + 1 小', qingShuiItem?.units, 1.5)
}

/* ------------------------------------------------------------------ *
 * 4. 大拿牌型
 * ------------------------------------------------------------------ */

section('4. 大拿牌型：清一色、双通、双棒棒、双四活、一一九、三杠、三大坎、乱分、自摸大连号')

{
  const cases: Array<{ label: string; input: ScoreInput; pattern: string; total?: number }> = [
    {
      label: '清一色',
      input: { concealed: ['1万', '1万', '1万', '2万', '3万', '4万', '5万', '6万', '7万', '8万', '9万', '9万', '9万', '2万'] },
      pattern: '清一色',
      total: 43
    },
    {
      label: '双通',
      input: {
        concealed: ['1万', '1万', '1万', '1筒', '1筒', '1筒', '2万', '2万', '2万', '2筒', '2筒', '2筒', '9条', '9条']
      },
      pattern: '双通',
      total: 39
    },
    {
      label: '双棒棒',
      input: {
        concealed: ['2万', '2万', '3万', '3万', '4万', '4万', '2筒', '2筒', '3筒', '3筒', '4筒', '4筒', '5条', '5条']
      },
      pattern: '双棒棒',
      total: 50
    },
    {
      label: '双四活',
      input: {
        concealed: ['1万', '1万', '1万', '1万', '2万', '2万', '2万', '2万', '3筒', '3筒', '4筒', '4筒', '5条', '5条']
      },
      pattern: '双四活',
      total: 61
    },
    {
      label: '一一九',
      input: {
        concealed: ['1万', '1万', '1万', '9万', '9万', '9万', '1筒', '1筒', '1筒', '9筒', '9筒', '9筒', '东', '东']
      },
      pattern: '一一九',
      total: 44
    },
    {
      label: '三杠',
      input: {
        concealed: ['1条', '2条', '3条', '5条', '5条'],
        melds: [kong('1万'), kong('2万'), kong('3万')]
      },
      pattern: '三杠',
      total: 30
    },
    {
      label: '三大坎 + 同门 2 张',
      input: {
        concealed: ['1万', '1万', '1万', '2万', '2万', '2万', '3万', '3万', '3万', '8万', '8万', '2条', '3条', '4条']
      },
      pattern: '三大坎+同门2张',
      total: 24
    },
    {
      label: '乱分',
      input: {
        concealed: ['东', '东', '东', '南', '南', '南', '西', '西', '西', '北', '北', '北', '中', '中']
      },
      pattern: '乱分',
      total: 27
    },
    {
      label: '自摸大连号',
      input: {
        concealed: [...suitTiles('筒'), '2条', '3条', '4条', '5条', '5条'],
        selfDraw: true
      },
      pattern: '自摸大连号',
      total: 62
    }
  ]

  for (const item of cases) {
    const result = scoreBoth(item.label, item.input)
    const reason = result.bigWin.reasons.some(r => r.name === item.pattern)
    check(`${item.label} 命中大拿牌型`, reason, true)
    if (item.total !== undefined) check(`${item.label} 点数`, result.points.total, item.total)
  }

  // 大拿点数线：B 自摸 52 点
  const threshold = scoreBoth('大拿点数线', {
    concealed: [...suitTiles('筒'), '2条', '3条', '4条', '5条', '5条'],
    selfDraw: true
  })
  check('52 点 ≥ 50 → 大拿', threshold.bigWin.reasons.some(r => r.name === '点数达到大拿线'), true)

  // 吸光三家点数
  const zeroed = scoreBoth('吸光三家', {
    concealed: [...suitTiles('筒'), '2条', '3条', '4条', '5条', '5条'],
    selfDraw: true,
    opponentsPoints: [10, 10, 10]
  })
  check('成牌点数 ≥ 三家剩余 → 一把吸光', zeroed.bigWin.reasons.some(r => r.name === '一把吸光三家点数'), true)

  // 七对本身不是大拿，七对 + 四活才是
  const seven = scoreHand({ concealed: ['1筒', '1筒', '5筒', '5筒', '2条', '2条', '8条', '8条', '3万', '3万', '7万', '7万', '东', '东'] })
  check('七对不是大拿', seven.bigWin.isBigWin, false)
  const sevenFour = scoreHand({
    concealed: ['1万', '1万', '1万', '1万', '2筒', '2筒', '3筒', '3筒', '4筒', '4筒', '5条', '5条', '6条', '6条']
  })
  check('七对 + 四活是大拿', sevenFour.bigWin.isBigWin, true)
}

/* ------------------------------------------------------------------ *
 * 5. 摸子 / 金额 / 单人赔三家
 * ------------------------------------------------------------------ */

section('5. 摸子、金额、单人赔三家')

{
  const daDiaoChe = {
    concealed: ['9条', '9条'],
    melds: [pung('1筒'), pung('2筒'), pung('3筒'), pung('4筒')],
    winTile: '9条'
  }
  const normal = scoreHand(daDiaoChe)
  check('大拿每家 40 元', normal.money.bigWinMoneyPerOpponent, 40)
  check('大吊车摸子 10 元/家', normal.money.moziMoneyPerOpponent, 10)
  check('大吊车三家合计 150 元', normal.money.total, 150)
  const single = scoreHand({ ...daDiaoChe, singlePayer: true })
  check('禁打点炮：付款人只有 1 个', single.money.payerCount, 1)
  check('禁打点炮：一人付 150 元', single.money.amountPerPayer, 150)
  check('禁打点炮：赢家仍收 150 元', single.money.total, 150)

  // 点数金额按 5 元取整
  const rounded = scoreHand({
    concealed: ['4万', '4万', '4万', '5万', '5万', '5万', '6筒', '6筒'],
    melds: [pung('4筒'), pung('北')],
    winTile: '5万',
    selfDraw: true
  })
  check('普通点数折算金额是 5 的倍数', rounded.money.perOpponentTotal % 5, 0)
  check('总金额是 5 的倍数', rounded.money.total % 5, 0)

  // 摸子：普通自摸 0.5，自摸大拿 1 大 + 清水 1.5
  const normalSelf = scoreHand({
    concealed: ['1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '2条', '2条', '2条', '5条', '5条'],
    selfDraw: true
  })
  check('普通自摸 = 1 小摸子', `${normalSelf.mozi.big} 大 + ${normalSelf.mozi.small} 小`, '0 大 + 1 小')
}

/* ------------------------------------------------------------------ *
 * 6. 规则开关 / 边界
 * ------------------------------------------------------------------ */

section('6. 规则开关与边界')

{
  const darkKong = {
    concealed: [...suitTiles('筒'), '5条', '5条'],
    melds: [kong('东', '暗杠')]
  }
  const off = scoreHand({ ...darkKong, rules: { anGangCountsAsBuDongShou: false } })
  check('关闭暗杠不动手 → 不再算不动手', off.points.items.some(i => i.name === '不动手'), false)

  const doubleRun = {
    concealed: ['1万', '2万', '3万', '4万', '5万', '6万', '1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '5条', '5条'],
    winTile: '1万'
  }
  const noBonus = scoreHand({ ...doubleRun, rules: { doubleRunBonusEnabled: false } })
  check('关闭双连号开关 → 不计算双连号', noBonus.points.items.some(i => i.name === '双连号'), false)
  check('关闭后仍有两门小连号', noBonus.points.items.filter(i => i.name === '小连号').length, 2)

  const laoXiao = {
    concealed: ['9筒', '9筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '1条', '2条', '3条'],
    melds: [pung('1筒')]
  }
  check('关闭老小对开关 → 不计算', scoreHand({ ...laoXiao, rules: { laoXiaoDuiEnabled: false } }).points.items.some(i => i.name === '老小对'), false)

  const kongOpenDouble = scoreHand({
    concealed: [...suitTiles('筒'), '5条', '5条'],
    isAfterKong: true,
    rules: { kongOpenDoublesPoints: true }
  })
  check('杠开额外翻倍开关生效', kongOpenDouble.points.multiplier, 4)

  const zhiziNoMelds = scoreHand({
    concealed: ['1万', '2万', '3万', '4万', '5万', '6万', '7万', '8万', '9万', '2条', '3条', '4条', '5条', '5条'],
    melds: [pung('1筒')],
    rules: { zhiziIncludesMelds: false }
  })
  check('关闭副露计入只子后，筒门不计只子', zhiziNoMelds.points.items.some(i => i.name === '只子' && i.detail.includes('筒')), false)

  // 非法牌 / 非法手牌
  let invalidTile = false
  try {
    scoreHand({ concealed: ['10万'] })
  } catch {
    invalidTile = true
  }
  check('非法牌面会报错', invalidTile, true)
  const invalidHand = scoreHand({
    concealed: ['1筒', '2筒', '4筒', '5筒', '6筒', '7筒', '2条', '2条', '2条', '9条', '9条'],
    melds: [pung('南')]
  })
  check('拆不成 4 组 + 1 将 → 非法成牌', invalidHand.isWinningHand, false)
  check('非法成牌带问题说明', invalidHand.problems.length > 0, true)
}

/* ------------------------------------------------------------------ *
 * 7. 大吊车禁打规则
 * ------------------------------------------------------------------ */

section('7. 大吊车禁打')

{
  check('打 5 万 → 禁 3~7 万', daLiaoCheForbiddenTiles('5万').join(','), '3万,4万,5万,6万,7万')
  check('打 1 万 → 只禁 1~3 万', daLiaoCheForbiddenTiles('1万').join(','), '1万,2万,3万')
  check('打字牌 → 只禁该字牌', daLiaoCheForbiddenTiles('东').join(','), '东')
  check('外面已有 3 张 → 绝对安全', isAbsolutelySafe(3), true)
  check('外面 2 + 自己 2 → 绝对安全', isAbsolutelySafe(2, 2), true)
  check('外面 2 + 自己 1 → 仍禁打', isAbsolutelySafe(2, 1), false)
}

/* ------------------------------------------------------------------ *
 * 8. 对局状态机：缺门、接牌优先级、碰杠、暗杠、加杠、抢杠
 * ------------------------------------------------------------------ */

section('8. 对局状态机：缺门、接牌优先级、碰杠、暗杠、加杠、抢杠')

{
  // 三打一：三家缺同一门，缺另一门的那家从定缺结束起翻牌明打
  const odd = ready(baseHands(), basePiles(), ['万', '条', '条', '条'])
  check('三打一：三家同缺条 → 缺万的一家明牌', odd.threeToOneSeat, 0)
  check('三打一：日志记录翻牌明打', odd.logs.some(line => line.includes('三打一')), true)
  const twoTwo = ready(baseHands(), basePiles(), ['万', '万', '条', '条'])
  check('三打一：2:2 不触发', twoTwo.threeToOneSeat, null)
  const allSame = ready(baseHands(), basePiles(), ['筒', '筒', '筒', '筒'])
  check('三打一：四家同缺不触发', allSame.threeToOneSeat, null)
  const oddOther = ready(baseHands(), basePiles(), ['条', '条', '条', '万'])
  check('三打一：明牌家随座位变化', oddOther.threeToOneSeat, 3)

  // 明牌家成牌：+5 点 + 1 小摸子
  let oddWin = ready(baseHands(), basePiles(), ['万', '条', '条', '条'])
  oddWin.players[0].hand = ['1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '1条', '2条', '3条', '9条', '9条']
  oddWin.phase = 'discard'
  oddWin.turn = 0
  oddWin.drawnTile = '9条'
  oddWin = applyAction(oddWin, { type: 'win', seat: 0 })
  check(
    '三打一：明牌家成牌 +5',
    oddWin.winner?.score.points.items.some(item => item.name === '三打一' && item.points === 5),
    true
  )
  check(
    '三打一：明牌家成牌附 1 小摸子',
    oddWin.winner?.score.mozi.items.some(item => item.name === '三打一' && item.units === 0.5),
    true
  )

  // 缺门：手里有缺门牌必须优先打缺门牌
  const hands = baseHands()
  hands[0] = ['1万', '2万', '3万', '1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '1条', '2条']
  let state = ready(hands, basePiles(), ['万', '条', '万', '条'])
  state = applyAction(state, { type: 'draw', seat: 0 })
  check('缺门：只能打缺门牌', legalDiscards(state, 0).join(','), '1万,2万,3万')
  check('缺门：playableDiscards 包含全部缺门牌', playableDiscards(state, 0).join(','), '1万,2万,3万')
  let threw = false
  try {
    applyAction(state, { type: 'discard', seat: 0, tile: '1筒' })
  } catch {
    threw = true
  }
  check('缺门：打非缺门牌被拒绝', threw, true)

  // 碰：接走牌、牌河移除、碰后立即打牌
  state = ready(baseHands(), basePiles(), ['条', '万', '万', '万'])
  state.players[0].hand = ['5筒', '1万', '2万', '3万', '4万', '6万', '7万', '8万', '9万', '1筒', '2筒', '3筒', '4筒']
  state.players[1].hand = ['5筒', '5筒', '1万', '1万', '2万', '2万', '3万', '3万', '4万', '4万', '6万', '6万', '7万']
  state.phase = 'discard'
  state.turn = 0
  state.drawnTile = '5筒'
  state = applyAction(state, { type: 'discard', seat: 0, tile: '5筒' })
  check('碰：进入 claim 阶段', state.phase, 'claim')
  check('碰：座位 1 进入待表态', state.pendingClaims.includes(1), true)
  state = applyAction(state, { type: 'claim', seat: 1, claim: '碰' })
  check('碰：手牌减少 2 张', state.players[1].hand.length, 11)
  check('碰：副露 1 组', state.players[1].melds.length, 1)
  check('碰：被碰牌从牌河移除', state.players[0].discards.includes('5筒'), false)
  check('碰：立即轮到碰牌者打牌', `${state.phase}/${state.turn}`, 'discard/1')
  check('碰完不能立即加杠', kongOptionsFor(state, 1).some(o => o.kind === '加杠'), false)

  // 不能吃：1 万 + 3 万不能吃 2 万；接牌只有成/杠/碰
  state = ready(baseHands(), basePiles(), ['条', '条', '条', '条'])
  state.players[0].hand = ['2万', '1万', '3万', '4万', '1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒']
  state.players[1].hand = ['1万', '3万', '东', '东', '南', '南', '西', '西', '北', '北', '中', '中', '发']
  state.players[2].hand = ['东', '东', '南', '南', '西', '西', '北', '北', '中', '中', '发', '发', '白']
  state.players[3].hand = ['东', '南', '西', '北', '中', '发', '白', '东', '南', '西', '北', '中', '发']
  state.phase = 'discard'
  state.turn = 0
  state.drawnTile = '2万'
  state = applyAction(state, { type: 'discard', seat: 0, tile: '2万' })
  check('不能吃：1 万 + 3 万不吃 2 万', state.phase, 'draw')
  check('不能吃：没有 claim 候选', state.pendingClaims.length, 0)

  // 缺门不能碰：手里有缺门对子，也不能碰别人打出的缺门牌
  state = ready(baseHands(), basePiles(), ['条', '筒', '条', '条'])
  state.players[0].hand = ['5筒', '1万', '2万', '3万', '4万', '6万', '7万', '8万', '9万', '1筒', '2筒', '3筒', '4筒']
  state.players[1].hand = ['5筒', '5筒', '1万', '2万', '3万', '4万', '6万', '7万', '8万', '9万', '1条', '2条', '3条']
  state.phase = 'discard'
  state.turn = 0
  state.drawnTile = '5筒'
  state = applyAction(state, { type: 'discard', seat: 0, tile: '5筒' })
  check('缺门不能碰：缺筒的 p1 不进入候选', state.pendingClaims.includes(1), false)

  // 接牌优先级：成 > 杠 > 碰，再按距离。p3 能成、p2 能杠、p1 能碰。
  state = ready(baseHands(), basePiles(), ['条', '万', '万', '万'])
  state.players[0].hand = ['5筒', '1万', '2万', '3万', '4万', '6万', '7万', '8万', '9万', '1筒', '2筒', '3筒', '4筒']
  state.players[1].hand = ['5筒', '5筒', '1万', '1万', '2万', '2万', '3万', '3万', '4万', '4万', '6万', '6万', '7万']
  state.players[2].hand = ['5筒', '5筒', '5筒', '1万', '2万', '3万', '4万', '6万', '7万', '8万', '9万', '1条', '2条']
  state.players[3].hand = ['5筒', '1筒', '1筒', '2筒', '2筒', '3筒', '3筒', '4筒', '4筒', '6筒', '6筒', '7筒', '7筒']
  // p3 的 13 张 + 5筒 = 七对，正好能成
  state.phase = 'discard'
  state.turn = 0
  state.drawnTile = '5筒'
  state = applyAction(state, { type: 'discard', seat: 0, tile: '5筒' })
  check('优先级：成牌 p3 排在杠 p2、碰 p1 前', state.pendingClaims.join(','), '3,2,1')
  check('优先级：当前只能 p3 表态', legalActions(state, 2).length, 0)
  state = applyAction(state, { type: 'pass', seat: 3 })
  check('优先级：p3 过后轮到 p2', state.pendingClaims[0], 2)
  state = applyAction(state, { type: 'pass', seat: 2 })
  check('优先级：p2 过后轮到 p1', state.pendingClaims[0], 1)
  check('优先级：最后 p1 的选项', legalActions(state, 1).map(a => a.type === 'claim' ? a.claim : a.type).join(','), '碰,pass')

  // 暗杠：四张一样的牌，杠后补牌；暗杠不能被抢
  state = ready(baseHands(), basePiles(), ['筒', '条', '万', '条'])
  state.players[0].hand = ['1万', '1万', '1万', '1万', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '2条']
  state.piles[1] = ['9条']
  state.phase = 'discard'
  state.turn = 0
  state.drawnTile = '1万'
  const darkOptions = kongOptionsFor(state, 0)
  check('暗杠：手牌四张相同可暗杠', darkOptions.some(o => o.kind === '暗杠' && o.tile === '1万'), true)
  state = applyAction(state, { type: 'kong', seat: 0, tile: '1万', kind: '暗杠' })
  check('暗杠：副露是暗杠', state.players[0].melds[0]?.kind, '暗杠')
  check('暗杠：杠后从牌尾补牌', state.players[0].hand.includes('9条'), true)
  check('暗杠：标记杠后状态', state.afterKong, true)
  check('暗杠：不能被人抢杠', state.phase, 'discard')

  // 加杠：碰 + 第四张，先进入抢杠窗口；无人能抢则补牌，成功明杠
  state = ready(baseHands(), basePiles(), ['筒', '条', '万', '条'])
  state.players[0].hand = ['1万', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '2条']
  state.players[0].melds = [pung('1万')]
  state.drawnTile = '1万'
  state.piles[1] = ['9条']
  state.phase = 'discard'
  state.turn = 0
  let addKong = applyAction(state, { type: 'kong', seat: 0, tile: '1万', kind: '加杠' })
  check('加杠：无人能抢时直接完成', addKong.players[0].melds[0]?.kind, '明杠')
  check('加杠：补牌后标记杠后', addKong.afterKong, true)
  check('加杠：补到牌尾 9 条', addKong.players[0].hand.includes('9条'), true)

  // 加杠被抢：p1 单吊 1 万；p0 碰后又摸到第四张
  state = ready(baseHands(), basePiles(), ['筒', '条', '条', '条'])
  state.players[0].hand = ['1万', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '2条']
  state.players[0].melds = [pung('1万')]
  state.drawnTile = '1万'
  state.piles[1] = ['9条']
  state.players[1].hand = ['1万', '1条', '1条', '2条', '2条', '3条', '3条', '4条', '4条', '6条', '6条', '7条', '7条']
  state.phase = 'discard'
  state.turn = 0
  const robbed = applyAction(state, { type: 'kong', seat: 0, tile: '1万', kind: '加杠' })
  check('抢杠：加杠先进入抢杠窗口', robbed.phase, 'rob-kong')
  check('抢杠：能成的 p1 在待表态队列', robbed.robKong?.pending[0], 1)
  check('抢杠：p1 有 成/过', legalActions(robbed, 1).map(a => a.type).join(','), 'win,pass')
  check('AI：抢杠能成会成', chooseAIAction(robbed, 1)?.type, 'win')
  const win = applyAction(robbed, { type: 'win', seat: 1, robKong: true })
  check('抢杠：成牌结束本把', win.phase, 'over')
  check('抢杠：赢家是 p1', win.winner?.seat, 1)
  check('抢杠：杠牌家的第四张已移除', win.players[0].hand.filter(t => t === '1万').length, 0)
  check('抢杠：杠牌家仍是碰，不升级明杠', win.players[0].melds[0]?.kind, '碰')
  check('抢杠：记录抢杠日志', win.logs.some(line => line.includes('抢杠')), true)

  // 抢杠全部过掉：杠才真正完成
  let allPass = robbed
  while (allPass.phase === 'rob-kong') allPass = applyAction(allPass, { type: 'pass', seat: allPass.robKong!.pending[0] })
  check('抢杠过掉：完成明杠', allPass.players[0].melds[0]?.kind, '明杠')
  check('抢杠过掉：补牌并回到打牌', `${allPass.phase}/${allPass.turn}`, 'discard/0')
  check('抢杠过掉：杠后状态', allPass.afterKong, true)

  // 暗杠不能被抢：同样有听 1 万的 p1，暗杠仍直接完成
  const darkState = ready(baseHands(), basePiles(), ['筒', '万', '条', '条'])
  darkState.players[0].hand = ['1万', '1万', '1万', '1万', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '2条']
  darkState.drawnTile = '1万'
  darkState.piles[1] = ['9条']
  darkState.players[1].hand = ['1万', '1条', '1条', '2条', '2条', '3条', '3条', '4条', '4条', '6条', '6条', '7条', '8条']
  darkState.phase = 'discard'
  darkState.turn = 0
  const darkKong = applyAction(darkState, { type: 'kong', seat: 0, tile: '1万', kind: '暗杠' })
  check('暗杠：不能抢，直接完成', darkKong.phase, 'discard')
  check('暗杠：副露为暗杠', darkKong.players[0].melds[0]?.kind, '暗杠')
}

/* ------------------------------------------------------------------ *
 * 9. 牌墙、流局、结算、AI
 * ------------------------------------------------------------------ */

section('9. 牌墙、流局、结算、AI')

{
  // 牌墙摸完流局
  const empty = ready(baseHands(), [[], [], [], []], ['万', '条', '条', '条'])
  const after = applyAction(empty, { type: 'draw', seat: 0 })
  check('牌墙空 → 流局', after.result, 'exhausted')
  check('流局阶段结束', after.phase, 'over')
  check('流局没有赢家', after.winner, null)

  // 大吊车禁打：手牌四张 6 万绝对安全，其余仍在禁打范围
  let banState = ready(baseHands(), basePiles(), ['条', '筒', '条', '万'])
  banState.players[1].melds = [pung('1筒'), pung('2筒'), pung('3筒'), pung('4筒')]
  banState.players[1].hand = ['5万', '5万']
  banState.phase = 'discard'
  banState.turn = 1
  banState.drawnTile = '5万'
  banState = applyAction(banState, { type: 'discard', seat: 1, tile: '5万' })
  check('大吊车：打出后生成禁打范围', banState.bans.length, 1)
  check('大吊车：5 万禁 3~7 万', forbiddenDiscardsFor(banState, 2).join(','), '3万,4万,5万,6万,7万')
  const safeState: HandState = {
    ...banState,
    players: banState.players.map(player => ({ ...player, hand: [...player.hand] }))
  }
  safeState.players[2].hand = ['6万', '6万', '6万', '6万']
  check('大吊车：自己四张 6 万 → 6 万绝对安全', forbiddenDiscardsFor(safeState, 2).includes('6万'), false)

  // 结算：接牌成牌三家支付，金额四家配平
  let winState = ready(baseHands(), basePiles(), ['万', '万', '万', '万'])
  winState.players[0].hand = ['1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '2条', '2条', '2条', '5条']
  winState.players[1].hand = ['5条', '1筒', '1筒', '2筒', '2筒', '3筒', '3筒', '4条', '4条', '6条', '6条', '7条', '7条']
  winState.phase = 'discard'
  winState.turn = 0
  winState.drawnTile = '5条'
  // 三家只剩 10 点，接牌成牌 34 点足以把三家点数一次吸光 → 大拿
  winState.players[0].points = 10
  winState.players[2].points = 10
  winState.players[3].points = 10
  winState = applyAction(winState, { type: 'discard', seat: 0, tile: '5条' })
  winState = applyAction(winState, { type: 'claim', seat: 1, claim: '成' })
  check('大拿：游戏内把三家剩余点数传入结算', winState.winner?.score.bigWin.reasons.some(r => r.name === '一把吸光三家点数'), true)
  const settlement = settleHand(winState)
  const sum = (list: number[]) => Number(list.reduce((a, b) => a + b, 0).toFixed(1))
  check('结算：赢家是接牌者', settlement?.winnerSeat, 1)
  check('结算：金额四家合计为 0', sum(settlement?.moneyDelta ?? []), 0)
  check('结算：点数四家合计为 0', sum(settlement?.pointDelta ?? []), 0)

  // AI：接牌时会选碰
  let aiClaim = ready(baseHands(), basePiles(), ['条', '万', '万', '万'])
  aiClaim.players[0].hand = ['5筒', '1万', '2万', '3万', '4万', '6万', '7万', '8万', '9万', '1筒', '2筒', '3筒', '4筒']
  aiClaim.players[1].hand = ['5筒', '5筒', '1万', '2万', '3万', '4万', '6万', '7万', '8万', '9万', '1筒', '2筒']
  aiClaim.players[0].discards.push('5筒')
  aiClaim.phase = 'claim'
  aiClaim.turn = 1
  aiClaim.pendingClaims = [1]
  aiClaim.lastDiscard = { tile: '5筒', seat: 0 }
  const aiClaimAction = chooseAIAction(aiClaim, 1)
  check('AI：能碰时选择碰', aiClaimAction?.type === 'claim' ? aiClaimAction.claim : aiClaimAction?.type, '碰')

  // AI：能暗杠时选择杠
  const aiKong = ready(baseHands(), basePiles(), ['筒', '条', '万', '条'])
  aiKong.players[0].hand = ['1万', '1万', '1万', '1万', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '2条']
  aiKong.phase = 'discard'
  aiKong.turn = 0
  aiKong.drawnTile = '1万'
  const aiKongAction = chooseAIAction(aiKong, 0)
  check('AI：能暗杠时选择杠', aiKongAction?.type === 'kong' ? aiKongAction.kind : aiKongAction?.type, '暗杠')

  // AI：出牌阶段不会返回 null
  const aiDiscard = ready(baseHands(), basePiles(), ['万', '条', '条', '条'])
  aiDiscard.phase = 'discard'
  aiDiscard.turn = 0
  aiDiscard.drawnTile = '9筒'
  check('AI：出牌阶段有动作', chooseAIAction(aiDiscard, 0)?.type, 'discard')

}

/* ------------------------------------------------------------------ *
 * 10. LayaAir 移植一致性 + 牌墙形状
 * ------------------------------------------------------------------ */

section('10. LayaAir 移植一致性与牌墙')

{
  // 两份 game.ts 用同样的手牌/牌墙跑两条基础动作，状态摘要一致
  const hands = baseHands()
  const piles = basePiles()
  let web = ready(hands, piles, ['万', '条', '条', '条'])
  let laya = layaCreateHand({ diceA: 1, diceB: 4, hands, piles, aiSeats: [] })
  for (const seat of [0, 1, 2, 3]) {
    laya = layaApplyAction(laya, { type: 'chooseShortage', seat, suit: ['万', '条', '条', '条'][seat] } as RoundAction)
  }
  const summary = (state: HandState) =>
    JSON.stringify({
      phase: state.phase,
      turn: state.turn,
      hands: state.players.map(p => p.hand.length),
      piles: state.piles.map(p => p.length),
      shortages: state.players.map(p => p.shortage)
    })
  check('LayaAir 与 web 开局状态一致', summary(web), summary(laya as HandState))
  check('LayaAir 与 web 三打一标记一致', laya.threeToOneSeat, web.threeToOneSeat)
  web = applyAction(web, { type: 'draw', seat: 0 })
  laya = layaApplyAction(laya, { type: 'draw', seat: 0 })
  check('LayaAir 与 web 摸牌状态一致', summary(web), summary(laya as HandState))
  check('LayaAir 与 web 合法动作一致', layaLegalActions(laya, 0).length, legalActions(web, 0).length)

  // 牌墙形状：一墩两张，抽掉上层时只剩半格高度
  const wallState = ready(baseHands(), basePiles(), ['万', '条', '条', '条'])
  const walls = [0, 1, 2, 3].map(seat => wallVisualOf(wallState, seat))
  check('牌墙：4 面墙各 17 墩', walls.length, 4)
  check('牌墙：每面墙 17 墩、每墩上下两张', walls.every(wall => wall.length === 17 && wall.every(pair => pair.length === 2)), true)
  check('牌墙：开局座位 0 只剩留墩或已抽空', walls[0].flat().filter(Boolean).length <= 4, true)

  // 大吊车判定
  const daLiao = ready(baseHands(), basePiles(), ['万', '条', '条', '条'])
  daLiao.players[0].melds = [pung('1筒'), pung('2筒'), pung('3筒'), pung('4筒')]
  daLiao.players[0].hand = ['5万']
  check('大吊车判定：四副露 + 手牌一张', isDaLiaoChe(daLiao.players[0]), true)
}

/* ------------------------------------------------------------------ */

section('汇总')
console.log(`${checks - failures}/${checks} 项通过${failures ? `，${failures} 项失败` : ''}`)
if (failures) process.exitCode = 1
