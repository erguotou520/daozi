/**
 * 倒子结算引擎 · 回归测试
 *
 * 运行： node scripts/test-score.ts
 *
 * A–F 是用户已确认口径的基准算例（`prototype/chat.txt`），
 * 验证范围为「基础成牌 + 自家三张/碰/杠 + 只子 + 连号」，因此这几例显式禁用了
 * 其它加点子（不动手、四活、对对胡……），否则会得到「完整规则」下的另一组分数。
 */

import {
  daLiaoCheForbiddenTiles,
  isAbsolutelySafe,
  scoreHand,
  suitTiles,
  type Meld,
  type MeldKind,
  type ScoreInput,
  type Tile
} from '../src/game/score'
import {
  createMatch,
  dealPlan,
  dealTrace,
  rollOpening,
  rollRound,
  rotateSeatsAfterRound,
  seatFromDice,
  seatOffsetFromDice,
  settleRound
} from '../src/game/table'

const BASIC_SCOPE_DISABLED = [
  '压当',
  '单吊',
  '棒棒',
  '不动手',
  '四活',
  '草一色',
  '对对胡',
  '七对',
  '大吊车',
  '老小对',
  '三打一',
  '杠开'
]

interface RegressionCase {
  id: string
  note: string
  concealed: Tile[]
  melds?: Meld[]
  expect: { deal: number; selfDraw: number; dealMozi?: string; selfDrawMozi?: string }
}

const pung = (tile: Tile): Meld => ({ kind: '碰', tile })
const kong = (tile: Tile, kind: MeldKind = '明杠'): Meld => ({ kind, tile })

const cases: RegressionCase[] = [
  {
    id: 'A',
    note: '123567筒、22299条，碰南风（暗刻 2 + 明碰 1）',
    concealed: ['1筒', '2筒', '3筒', '5筒', '6筒', '7筒', '2条', '2条', '2条', '9条', '9条'],
    melds: [pung('南')],
    expect: { deal: 7, selfDraw: 14, selfDrawMozi: '0 大 + 1 小' }
  },
  {
    id: 'B',
    note: '123456789筒、234条、55条（大连号 20 + 只子 2）',
    concealed: [...suitTiles('筒'), '2条', '3条', '4条', '5条', '5条'],
    expect: { deal: 26, selfDraw: 52 }
  },
  {
    id: 'C',
    note: '123456789筒、222条、55条（大连号 20 + 只子 2 + 暗刻 2）',
    concealed: [...suitTiles('筒'), '2条', '2条', '2条', '5条', '5条'],
    expect: { deal: 28, selfDraw: 56 }
  },
  {
    id: 'D',
    note: '123筒、456筒、222条、333条、55条（小连号 5 + 只子 1 + 双暗刻 4）',
    concealed: [
      '1筒', '2筒', '3筒', '4筒', '5筒', '6筒',
      '2条', '2条', '2条', '3条', '3条', '3条', '5条', '5条'
    ],
    expect: { deal: 14, selfDraw: 28 }
  },
  {
    id: 'E',
    note: '123筒、456筒、77条，碰南风、碰发财（小连号 5 + 明碰 2）',
    concealed: ['1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7条', '7条'],
    melds: [pung('南'), pung('发')],
    expect: { deal: 11, selfDraw: 22 }
  },
  {
    id: 'F',
    note: '123筒、456筒、789筒、55条，杠南风（大连号 20 + 只子 2 + 杠 2）',
    concealed: [...suitTiles('筒'), '5条', '5条'],
    melds: [kong('南')],
    expect: { deal: 28, selfDraw: 56 }
  }
]

/* ---------------------------------------------------------------- */

let failures = 0
let checks = 0

const check = (label: string, actual: unknown, expected: unknown) => {
  checks += 1
  const ok = actual === expected
  if (!ok) {
    failures += 1
    console.log(`  ✗ ${label}: 期望 ${expected}，实际 ${actual}`)
  } else {
    console.log(`  ✓ ${label}: ${actual}`)
  }
}

const basicInput = (item: RegressionCase, selfDraw: boolean): ScoreInput => ({
  concealed: item.concealed,
  melds: item.melds,
  selfDraw,
  disabledPatterns: BASIC_SCOPE_DISABLED
})

console.log('='.repeat(72))
console.log('A–F 基准算例（用户已确认口径）')
console.log('='.repeat(72))

for (const item of cases) {
  console.log(`\n[${item.id}] ${item.note}`)
  const deal = scoreHand(basicInput(item, false))
  const self = scoreHand(basicInput(item, true))
  const structure = deal.isWinningHand ? '成牌结构合法' : `成牌结构告警：${deal.problems.join('；')}`
  console.log(`  ${structure}`)
  console.log(`  接牌：${deal.details.join(' | ')}`)
  check(`${item.id} 接牌点数`, deal.points.total, item.expect.deal)
  check(`${item.id} 自摸点数`, self.points.total, item.expect.selfDraw)
  if (item.expect.dealMozi) check(`${item.id} 接牌摸子`, `${self.mozi.big} 大 + ${self.mozi.small} 小`, item.expect.dealMozi)
  if (item.expect.selfDrawMozi) check(`${item.id} 自摸摸子`, `${self.mozi.big} 大 + ${self.mozi.small} 小`, item.expect.selfDrawMozi)
  const full = scoreHand({ concealed: item.concealed, melds: item.melds })
  console.log(
    `  （完整规则下接牌为 ${full.points.total} 点：${full.points.items.map(i => `${i.name}+${i.points}`).join(' ')}）`
  )
}

/* ---------------------------------------------------------------- */
console.log('\n' + '='.repeat(72))
console.log('其它规则自检（用于暴露实现问题，不是用户确认值）')
console.log('='.repeat(72))

// 通：同一数字跨两门共 5 张 → 5 通
{
  const result = scoreHand({
    concealed: ['3筒', '3筒', '3筒', '3条', '3条', '1筒', '2筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '9筒']
  })
  const tong = result.points.items.find(item => item.name === '通')
  console.log(`\n[通] 3筒×3 + 3条×2 → 通 ${tong?.points ?? 0} 点`)
  check('5 通 = 5 点', tong?.points ?? 0, 5)
}

// 七对
{
  const result = scoreHand({
    concealed: ['1筒', '1筒', '2筒', '2筒', '3筒', '3筒', '4筒', '4筒', '5筒', '5筒', '6筒', '6筒', '7筒', '7筒'],
    selfDraw: false
  })
  console.log(`\n[七对] ${result.details.join(' | ')}`)
  console.log(`  大拿：${result.bigWin.isBigWin}（${result.bigWin.reasons.map(r => r.name).join('、')}）`)
  check('七对命中', result.patterns['七对'], true)
}

// 枯只压：压当（成牌张补顺子中张）+ 该牌外面已出 3 张
{
  const concealed = [
    '4筒', '5筒', '6筒',
    '1条', '1条', '1条', '2条', '3条', '4条', '5条', '6条', '7条', '9条', '9条'
  ]
  const deal = scoreHand({ concealed, winTile: '5筒', visibleWinTileCount: 3 })
  console.log(`\n[枯只压/接牌] ${deal.details.join(' | ')}`)
  check('成牌张补中张 → 压当', deal.patterns['压当'], true)
  check('枯只压接牌摸子 = 1.5 大 → 1 大 + 1 小', `${deal.mozi.big} 大 + ${deal.mozi.small} 小`, '1 大 + 1 小')
  check('枯只压额外 +21 点', deal.points.items.find(item => item.name === '枯只压')?.points, 21)
  const self = scoreHand({ concealed, winTile: '5筒', visibleWinTileCount: 3, selfDraw: true })
  check('枯只压自摸摸子 = 3 大 → 3 大 + 0 小', `${self.mozi.big} 大 + ${self.mozi.small} 小`, '3 大 + 0 小')
  const notKu = scoreHand({ concealed, winTile: '5筒', visibleWinTileCount: 2 })
  check('外面只有 2 张 → 只算压当（1 个大摸子）', notKu.mozi.units, 1)
}

// 枯只压扩展：边张（12 等 3 / 89 等 7）也只等一张，外面出完同样算
{
  const base = ['1万', '2万', '3万', '4万', '5万', '6万', '1条', '2条', '3条', '9条', '9条']
  // 89 等 7（边张），外面已出 3 张
  const kuLow = scoreHand({ concealed: ['7筒', '8筒', '9筒', ...base], winTile: '7筒', visibleWinTileCount: 3 })
  check('89 等 7 + 外面 3 张 → 枯只压', kuLow.mozi.items.some(i => i.name === '枯只压'), true)
  // 12 等 3（边张），外面已出 3 张
  const kuHigh = scoreHand({ concealed: ['1筒', '2筒', '3筒', ...base], winTile: '3筒', visibleWinTileCount: 3 })
  check('12 等 3 + 外面 3 张 → 枯只压', kuHigh.mozi.items.some(i => i.name === '枯只压'), true)
  // 23 等 1（两面），外面 1 出完也还有 4 能成，不算枯只压
  const twoWay = scoreHand({ concealed: ['1筒', '2筒', '3筒', ...base], winTile: '1筒', visibleWinTileCount: 3 })
  check('23 等 1（两面）→ 不算枯只压', twoWay.mozi.items.some(i => i.name === '枯只压'), false)
  // 外面只有 2 张 → 只是普通接牌，不给枯只压
  const kuFew = scoreHand({ concealed: ['7筒', '8筒', '9筒', ...base], winTile: '7筒', visibleWinTileCount: 2 })
  check('边张但外面只有 2 张 → 不算枯只压', kuFew.mozi.items.some(i => i.name === '枯只压'), false)
}

// 金额 5 元取整：点数折算的钱四舍五入到 5 元，战绩里不会再出现 34.5 这种小数
{
  const r = scoreHand({
    concealed: ['4万', '4万', '4万', '5万', '5万', '5万', '6筒', '6筒'],
    melds: [
      { kind: '碰', tile: '4筒' },
      { kind: '碰', tile: '北' }
    ] as Meld[],
    winTile: '5万',
    selfDraw: true
  })
  check('52 点大拿 → 每家金额是 5 的倍数', r.money.perOpponentTotal % 5, 0)
  check('三家合计也是 5 的倍数', r.money.total % 5, 0)
  const odd = scoreHand({
    concealed: ['4万', '4万', '4万', '5万', '6万', '6万', '5万', '北', '北'],
    melds: [
      { kind: '碰', tile: '4筒' },
      { kind: '碰', tile: '北' }
    ] as Meld[],
    winTile: '5万',
    selfDraw: true
  })
  check('38 点 → 每家金额是 5 的倍数', odd.money.perOpponentTotal % 5, 0)
}

// 杠后赛花：摸子翻倍
{
  const concealed = [...suitTiles('筒'), '5条', '5条']
  const result = scoreHand({
    concealed,
    melds: [kong('南')],
    selfDraw: true,
    isAfterKong: true
  })
  console.log(`\n[杠后赛花] ${result.details.join(' | ')}`)
  check('杠开 +5 点', result.points.items.some(i => i.name === '杠开' && i.points === 5), true)
  check('杠后赛花摸子 ×2', result.mozi.multiplier, 2)
}

// 非法手牌
{
  const result = scoreHand({ concealed: ['1筒', '2筒', '4筒', '5筒', '6筒', '7筒', '2条', '2条', '2条', '9条', '9条'], melds: [pung('南')] })
  console.log(`\n[非法手牌] isWinningHand=${result.isWinningHand}，问题：${result.problems.join('；')}`)
  check('非法手牌被识别', result.isWinningHand, false)
}

/* ---------------------------------------------------------------- */
console.log('\n' + '='.repeat(72))
console.log('本轮确认规则的自检')
console.log('='.repeat(72))

// 暗杠算不动手
{
  const result = scoreHand({
    concealed: [...suitTiles('筒'), '5条', '5条'],
    melds: [{ kind: '暗杠', tile: '东' }]
  })
  const buDongShou = result.points.items.find(item => item.name === '不动手')
  console.log(`\n[暗杠 + 不动手] ${result.details.join(' | ')}`)
  check('暗杠仍算不动手（5 点）', buDongShou?.points ?? 0, 5)
}

// 七对本身不是大拿
{
  const result = scoreHand({
    concealed: ['1筒', '1筒', '5筒', '5筒', '2条', '2条', '8条', '8条', '3万', '3万', '7万', '7万', '东', '东']
  })
  console.log(`\n[普通七对] ${result.details.join(' | ')}`)
  check('七对命中', result.patterns['七对'], true)
  check('七对本身不是大拿', result.bigWin.isBigWin, false)
  check('普通七对 40 点', result.points.total, 40)
}

// 七对 + 四活 = 大拿
{
  const result = scoreHand({
    concealed: ['1筒', '1筒', '1筒', '1筒', '2筒', '2筒', '3筒', '3筒', '4筒', '4筒', '5筒', '5筒', '6筒', '6筒']
  })
  console.log(`\n[七对 + 四活] ${result.details.join(' | ')}`)
  check('四活被识别（+10）', result.points.items.some(i => i.name === '四活' && i.points === 10), true)
  check('七对+四活 是大拿', result.bigWin.isBigWin, true)
  check(
    '大拿原因含「两个大牌型」',
    result.bigWin.reasons.some(reason => reason.name === '两个大牌型'),
    true
  )
}

// 老小对：同一门 1 和 9 都要成坎（至少 3 张，碰/杠也算），对子、拆顺子都不算
{
  const result = scoreHand({
    concealed: ['9筒', '9筒', '9筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '9条', '9条'],
    melds: [pung('1筒')]
  })
  const laoXiaoDui = result.points.items.find(item => item.name === '老小对')
  console.log(`\n[老小对] ${result.details.join(' | ')}`)
  check('碰 1 筒 + 手里 999 筒 → 老小对', laoXiaoDui?.points ?? 0, 5)
  check('老小对说明带花色', laoXiaoDui?.detail ?? '', '筒 有 1、9 的刻子')
}

// 通最多 8 通
{
  const result = scoreHand({
    concealed: ['1条', '2条', '3条', '5条', '6条', '7条', '9条', '9条'],
    melds: [kong('4万'), kong('4筒')]
  })
  const tong = result.points.items.find(item => item.name === '通')
  console.log(`\n[8 通] ${result.details.join(' | ')}`)
  check('4万×4 + 4筒×4 → 通 8 点', tong?.points ?? 0, 8)
}

// 大吊车禁打范围
{
  console.log('\n[大吊车禁打]')
  check('打 5 万 → 禁 3~7 万', daLiaoCheForbiddenTiles('5万').join(','), '3万,4万,5万,6万,7万')
  check('打 1 万 → 禁 1~3 万', daLiaoCheForbiddenTiles('1万').join(','), '1万,2万,3万')
  check('打 东 → 只禁东', daLiaoCheForbiddenTiles('东').join(','), '东')
  check('外面已有 3 张 → 绝对安全', isAbsolutelySafe(3), true)
  check('外面 2 张 + 自己 2 张 → 绝对安全', isAbsolutelySafe(2, 2), true)
  check('外面 2 张 + 自己 1 张 → 仍禁打', isAbsolutelySafe(2, 1), false)
}

// 双连号（逢2加1，用户确认口径）
// 典型双连号：两门小连号 = 2×5 + 逢2加1 再加一门 5 = 15 点
// → 底4 + 不动手5 + 15 = 24；有压当或 8 只再 +1 = 25；成牌张是字牌（无压当）停在 24
{
  console.log('\n[双连号]')
  // 边张成牌（成牌张不产生压当/单吊），两门小连号 + 不动手
  const edgeWin = {
    concealed: ['1万', '2万', '3万', '4万', '5万', '6万', '1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '5条', '5条'],
    winTile: '1万'
  }
  const base = scoreHand(edgeWin)
  console.log(`  ${base.details.join(' | ')}`)
  check('两门小连号 → 双连号命中', base.patterns['双连号'], true)
  check('双连号 = 逢2加1 再加一门（+5）', base.points.items.find(i => i.name === '双连号')?.points ?? 0, 5)
  check('底4 + 不动手5 + 小连号10 + 双连号5 = 24 点', base.points.total, 24)

  // 8 只（同一门 8 张 → 只子 +1）→ 25
  const eightTiles = scoreHand({
    concealed: ['1万', '2万', '3万', '4万', '5万', '5万', '5万', '6万', '1筒', '2筒', '3筒', '4筒', '5筒', '6筒'],
    winTile: '1万'
  })
  console.log(`  [8只] ${eightTiles.details.join(' | ')}`)
  check('万 8 张 → 只子 +1，共 25 点', eightTiles.points.total, 25)

  // 压当（亚当）→ 25
  const yaDang = scoreHand({
    concealed: ['1万', '2万', '3万', '4万', '5万', '6万', '1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '5条', '5条'],
    winTile: '2万'
  })
  console.log(`  [压当] ${yaDang.details.join(' | ')}`)
  check('成牌张补中张 → 压当 +1，共 25 点', yaDang.points.total, 25)
  check('压当成牌 → 1 个大摸子', yaDang.mozi.units, 1)

  // 字牌将、边张成牌（没有压当）→ 仍是 24
  const honorPair = scoreHand({
    concealed: ['1万', '2万', '3万', '4万', '5万', '6万', '1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '中', '中'],
    winTile: '1万'
  })
  console.log(`  [字牌将] ${honorPair.details.join(' | ')}`)
  check('字牌将 + 无压当 → 24 点', honorPair.points.total, 24)

  // 成牌张单吊字牌将 → 单吊 +1 → 25（单吊规则照常生效）
  const honorDanDiao = scoreHand({
    concealed: ['1万', '2万', '3万', '4万', '5万', '6万', '1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '中', '中'],
    winTile: '中'
  })
  console.log(`  [单吊字牌将] ${honorDanDiao.details.join(' | ')}`)
  check('单吊字牌将 → 单吊 +1，共 25 点', honorDanDiao.points.total, 25)
}

// 连号只看手上的牌：副露不参与「连续六张」
{
  console.log('\n[连号只数手牌]')
  // 234456 万（手上）+ 碰 7 万：整手看有 2–7，但手上根本没有六连
  const withPung = scoreHand({
    concealed: ['2万', '3万', '4万', '4万', '5万', '6万', '7筒', '8筒', '9筒', '5条', '5条'],
    melds: [{ kind: '碰', tile: '7万' }]
  })
  console.log(`  [碰7万 + 234456万] ${withPung.details.join(' | ')}`)
  check('234456 万 + 碰 7 万 不算小连号', withPung.points.items.some(i => i.name === '小连号'), false)
  check('大连号同样不认副露', withPung.points.items.some(i => i.name === '大连号'), false)

  // 手上真有 234567 才算
  const realRun = scoreHand({
    concealed: ['2万', '3万', '4万', '5万', '6万', '7万', '7筒', '8筒', '9筒', '5条', '5条']
  })
  console.log(`  [234567万] ${realRun.details.join(' | ')}`)
  check('手上 234567 万 → 小连号', realRun.points.items.some(i => i.name === '小连号'), true)
}

/* ---------------------------------------------------------------- */
console.log('\n' + '='.repeat(72))
console.log('大吊车与桌位流程')
console.log('='.repeat(72))

// 大吊车 = 大拿；禁打点炮由一人承担三家
{
  const melds = [pung('1筒'), pung('2筒'), pung('3筒'), pung('4筒')]
  const concealed = ['9条', '9条']
  const normal = scoreHand({ concealed, melds, winTile: '9条' })
  console.log(`\n[大吊车] ${normal.details.join(' | ')}`)
  check('大吊车命中', normal.patterns['大吊车'], true)
  check('大吊车 = 大拿', normal.bigWin.isBigWin, true)
  check('大拿每家 40 元', normal.money.bigWinMoneyPerOpponent, 40)
  check('大吊车必然是单吊 → 摸子 10 元/家', normal.money.moziMoneyPerOpponent, 10)
  check('三家合计 150 元（大拿 120 + 摸子 30）', normal.money.total, 150)
  const banned = scoreHand({ concealed, melds, winTile: '9条', singlePayer: true })
  check('禁打点炮：一人付三家 150 元', banned.money.amountPerPayer, 150)
  check('禁打点炮：赢家仍收 150 元', banned.money.total, 150)
  check('禁打点炮：付款人只有 1 个', banned.money.payerCount, 1)
}

// 掷骰与座位
{
  console.log('\n[掷骰与座位]')
  check('5 点 = 自己', seatOffsetFromDice(5), 0)
  check('6 点 = 下家', seatOffsetFromDice(6), 1)
  check('7 点 = 对面', seatOffsetFromDice(7), 2)
  check('8 点 = 上家', seatOffsetFromDice(8), 3)
  check('9 点回到自己', seatOffsetFromDice(9), 0)
  const opening = rollOpening(0, 2, 6)
  check('2+6=8 点 → 开牌墙在上家', opening.wallSeat, 3)
  check('骰子不改东家：东家还是掷骰的人', opening.dealerSeat, 0)
  check('2+6 → 留 2 墩', opening.breakStacks, 2)
  check('下家（座位 1）掷 6 点 → 对面（座位 2）', seatFromDice(1, 6), 2)
  check('下家坐东掷 3+5=8 点：东家不变、开牌墙在上家（座位 0）', `${rollOpening(1, 3, 5).dealerSeat}/${rollOpening(1, 3, 5).wallSeat}`, '1/0')
}

// 发牌
{
  console.log('\n[发牌]')
  const plan = dealPlan(0)
  const countOf = (seat: number) => plan.filter(step => step.seat === seat).reduce((n, step) => n + step.count, 0)
  check('发牌总数 53 张', plan.reduce((n, step) => n + step.count, 0), 53)
  check('东家 14 张', countOf(0), 14)
  check('其余各家 13 张', [1, 2, 3].map(countOf).join(','), '13,13,13')

  // 前 12 手都是 4 张一把，顺序是东家起顺时针
  check('前 4 手顺时针 4 张一把', plan.slice(0, 4).map(step => `${step.seat}:${step.count}`).join(','), '0:4,1:4,2:4,3:4')
  check('第 1 手不带跳格', plan[0].skip ?? 0, 0)
  // 东家跳牌：抓 1 张 → 跳过下面那张 → 拿下一墩的上层
  const jumpIndex = plan.findIndex(step => (step.skip ?? 0) > 0)
  check('跳牌前已经发了 49 张', plan.slice(0, jumpIndex).reduce((n, step) => n + step.count, 0), 49)
  check('跳牌那一手是东家', plan[jumpIndex].seat, 0)
  check('跳牌只跳过 1 张', plan[jumpIndex].skip, 1)

  // 牌墙是一条连续的牌：从开牌墙那段抓起，抓完接着下一段
  const trace = dealTrace(0, 0, 0)
  check('逐张抓牌共 53 张', trace.length, 53)
  check('每张牌都记了出自哪面墙的第几墩第几层', trace.every(item => item.col >= 0 && item.col < 17 && (item.layer === 0 || item.layer === 1)), true)
  check('东家前 4 张：16 墩上、16 墩下、15 墩上、15 墩下（从右往左）',
    trace.slice(0, 4).map(item => `${item.col}${item.layer}`).join(','), '160,161,150,151')
  check('前 34 张全出在开牌墙（座位 0）', trace.slice(0, 34).every(item => item.from === 0), true)
  check('第 35 张开始接到左手边那面墙（座位 3，顺时针）', trace[34].from, 3)
  check('东家第 13 张落在 9 墩上', `${trace[48].col}${trace[48].layer}`, '90')
  check('东家第 14 张跳过 1 张（落在 8 墩上）', `${trace[49].col}${trace[49].layer}`, '80')
  check('其余三家各 13 张', [1, 2, 3].map(seat => trace.filter(item => item.seat === seat).length).join(','), '13,13,13')

  // 换东家：张数、顺序都要跟着转
  for (const seat of [1, 2, 3]) {
    const items = dealTrace(seat, seat, 0)
    const counts = [0, 0, 0, 0]
    for (const item of items) counts[item.seat] += 1
    check(`东家 ${seat}：四家张数`, counts.join(','), [0, 1, 2, 3].map(s => (s === seat ? 14 : 13)).join(','))
    check(`东家 ${seat}：第一手给他自己`, items[0].seat, seat)
    check(`东家 ${seat}：从自己牌面右边（16 墩）抓起`, `${items[0].col}${items[0].layer}`, '160')
  }

  // 留墩：最右边几摞不动，发牌从再往左一摞开始，那几摞排到牌尾最后才抓
  const kept = dealTrace(0, 0, 3)
  check('留 3 墩：东家第一张从 13 墩上层开始', `${kept[0].col}${kept[0].layer}`, '130')
  check('留 3 墩：最右的 16、15、14 墩都不在前 28 张里', kept.slice(0, 28).every(item => item.col <= 13), true)
  check('留 3 墩：第 29 张才接到左手边那面墙', kept[28].from, 3)
}

// 四局调圈
{
  console.log('\n[四局调圈]')
  check('指向座位 2 → 座位 2 不动，其余依次调换', rotateSeatsAfterRound([0, 1, 2, 3], 0, 7).join(','), '3,0,2,1')
  // 顺时针 = 座位号往下走一格；不动的那家被绕过去
  check('调圈：1 号位掷 7 点 → 3 号位不动', rotateSeatsAfterRound([0, 1, 2, 3], 1, 7).join(','), '2,0,1,3')
  check('调圈：5 点 = 自己 → 自己不动', rotateSeatsAfterRound([0, 1, 2, 3], 0, 5).join(','), '0,3,1,2')
  {
    const moved = rotateSeatsAfterRound([0, 1, 2, 3], 1, 7)
    check('调圈：0 号顺时针挪到 1 号', moved[1], 0)
    check('调圈：1 号顺时针挪到 2 号', moved[2], 1)
    check('调圈：2 号绕过不动的 3 号挪到 0 号', moved[0], 2)
    check('调圈：3 号不动', moved[3], 3)
  }

  let state = createMatch()
  state = rollRound(state, 2, 6)
  check('掷骰：东家不变、开牌墙按点数', `${state.dealerSeat}/${state.wallSeat}`, '0/3')
  state = settleRound(state, 1)
  check('赢家获得下局掷骰权', state.rollerSeat, 1)
  check('局数 +1', state.round, 2)
  state = rollRound(state, 1, 4)
  check('下一把：赢家坐东（骰子不改东家）', `${state.dealerSeat}/${state.wallSeat}`, '1/1')

  const circle = settleRound({ ...createMatch(), round: 4 }, 2, 7)
  check('打满 4 局后局数重置为 1', circle.round, 1)
  check('调圈：骰子指向的座位 0 不动', circle.seats[0], 0)
  check('调圈：其余人依次调换', circle.seats.join(','), '0,3,1,2')
  check('调圈：东家跟着赢家到新座位（座位 3）', circle.rollerSeat, 3)

  let threw = false
  try {
    settleRound({ ...createMatch(), round: 4 }, 1)
  } catch {
    threw = true
  }
  check('打满 4 局却没给调圈骰子 → 报错', threw, true)
}

/* ---------------------------------------------------------------- */
console.log('\n' + '='.repeat(72))
console.log(`${checks - failures}/${checks} 项通过${failures ? `，${failures} 项失败` : ''}`)
console.log('='.repeat(72))

if (failures) process.exitCode = 1
