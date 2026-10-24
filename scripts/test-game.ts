/**
 * 倒子对局状态机 · 回归测试
 *
 * 运行： pnpm test:game
 *
 * 全部用「指定起手牌 + 指定牌墙」构造，保证确定性。
 */

import {
  applyAction,
  createHand,
  forbiddenDiscardsFor,
  isDaLiaoChe,
  legalActions,
  legalDiscards,
  remainingTiles,
  settleHand,
  takeWallTile,
  visibleCount,
  wallVisualOf,
  type HandState,
  type RoundAction
} from '../src/game/game'
import { applyHandSettlement, createMatch, endHand, startHand, type MatchState } from '../src/game/match'
import { dealTrace } from '../src/game/table'
import { scoreHand, type HandSettlement, type Tile } from '../src/game/score'

let failures = 0
let checks = 0

const check = (label: string, actual: unknown, expected: unknown) => {
  checks += 1
  if (actual === expected) {
    console.log(`  ✓ ${label}: ${actual}`)
  } else {
    failures += 1
    console.log(`  ✗ ${label}: 期望 ${expected}，实际 ${actual}`)
  }
}

/** 选完缺门，进入 draw 阶段 */
function ready(hands: Tile[][], piles: Tile[][], shortages: string[]): HandState {
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

// 庄家 = 掷骰子的人（rollerSeat）；存档每次都要把它带回来，否则读档后庄家会变回 0 号位
{
  let match = createMatch({ rollerSeat: 2 })
  match = startHand(match, 3, 4)
  const hand = match.current as HandState
  check('庄家跟着 rollerSeat', hand.dealerSeat, 2)
  const restoredHand = JSON.parse(JSON.stringify(hand)) as HandState
  check('存档往返后这把的庄家不变', restoredHand.dealerSeat, 2)
  const restoredMatch = JSON.parse(JSON.stringify(match)) as MatchState
  check('存档往返后 rollerSeat 不变', restoredMatch.rollerSeat, 2)
  const next = startHand({ ...restoredMatch, current: null }, 1, 1)
  check('续下一把时庄家仍是 2 号位', (next.current as HandState).dealerSeat, 2)
}

// 定缺阶段四家各自选，不受「轮到谁」限制（UI 靠这个决定显不显示 缺万/缺筒/缺条 按钮）
{
  const state = createHand({ diceA: 2, diceB: 6, seed: 7 })
  const patched: HandState = { ...state, turn: 2, dealerSeat: 2 }
  check('庄家不是自己时自己也能定缺', legalActions(patched, 0).filter(action => action.type === 'chooseShortage').length, 3)
  const chosen = applyAction(patched, { type: 'chooseShortage', seat: 0, suit: '万' } as RoundAction)
  check('自己定缺后选项清空', legalActions(chosen, 0).filter(action => action.type === 'chooseShortage').length, 0)
  check('别家还能继续定缺', legalActions(chosen, 1).filter(action => action.type === 'chooseShortage').length, 3)
}

/* ------------------------------------------------------------------ */
console.log('='.repeat(72))
console.log('1. 开局：掷骰、留墩、发牌')
console.log('='.repeat(72))
{
  const state = createHand({ diceA: 2, diceB: 6, seed: 7 })
  check('掷骰的人坐东（骰子不改东家）', state.dealerSeat, 0)
  check('2+6=8 → 开牌墙在上家（座位 3）', state.wallSeat, 3)
  check('留 2 墩', state.breakStacks, 2)
  check('东家 14 张', state.players[0].hand.length, 14)
  check('闲家各 13 张', [1, 2, 3].map(seat => state.players[seat].hand.length).join(','), '13,13,13')
  check('牌墙剩 136-53=83 张', remainingTiles(state), 83)
  check('开局阶段是选缺门', state.phase, 'choose-shortage')

  // 牌墙是一条连续的牌：从座位 3 那段抓起，抓完接左手边（座位 2）那段
  const remainingPerWall = [0, 1, 2, 3].map(seat => state.piles[seat].length)
  check('留墩 4 张留在开牌墙、下一面墙吃 23 张、另两面未动', remainingPerWall.join(','), '34,34,11,4')
  const openingWall = wallVisualOf(state, 3)
  check('开牌墙（座位 3）只剩最右的留墩 2 墩', openingWall.flat().filter(Boolean).length, 4)
  check(
    '留墩就压在牌墙最右端（左边 15 墩全空）',
    openingWall.every(([top, bottom], col) => (col >= 15 ? top && bottom : !top && !bottom)),
    true
  )
  // 座位 2 那面墙被抓走 23 张：11 墩整 + 1 墩上层，从右往左，没有任何中段空档
  const nextWall = wallVisualOf(state, 2)
  check('座位 2 那面墙还剩 11 张', nextWall.flat().filter(Boolean).length, 11)
  check(
    '座位 2 那面墙：5 墩整 + 1 道半墩 + 11 墩整',
    nextWall.map(([top, bottom]) => `${top ? 'o' : '_'}${bottom ? 'o' : '_'}`).join(''),
    `${'oo'.repeat(5)}${'_o'}${'__'.repeat(11)}`
  )
}

// 跳墩摸牌：摸牌时可以隔 1 墩取，被跳过的那两张留在墙上
{
  const state = createHand({ diceA: 2, diceB: 6, seed: 11 })
  // 开牌墙发完只剩留墩，跳墩摸牌落到下一面还没动过的墙（顺时针）
  const from = (state.wallSeat - 1 + 4) % 4
  const skipped = [state.piles[from][0], state.piles[from][1]]
  const target = state.piles[from][2]
  const got = takeWallTile(state, from, 2)
  check('跳墩摸牌：摸的是第 2 墩', got, target)
  check('跳墩摸牌：被跳过那两张还留在墙上', [state.piles[from][0], state.piles[from][1]].join(','), skipped.join(','))
}

// 发牌动画和引擎发牌必须是同一套顺序：四面墙各少多少张要完全对上
{
  const cases: Array<[number, number, string]> = [
    [1, 4, '5 点 → 开牌墙在自己'],
    [1, 5, '6 点 → 开牌墙在下家'],
    [2, 5, '7 点 → 开牌墙在对面'],
    [3, 5, '8 点 → 开牌墙在上家']
  ]
  for (const [diceA, diceB, label] of cases) {
    const state = createHand({ diceA, diceB, seed: 3 })
    const trace = dealTrace(state.dealerSeat, state.wallSeat, state.breakStacks)
    // 牌墙是一条连续的牌：开牌墙先扣掉留墩，接着顺时针吃下一段，另两面还没动
    const order = [0, 1, 2, 3].map(i => (state.wallSeat - i + 4) % 4)
    const kept = state.breakStacks * 2
    const expectedArr = [0, 0, 0, 0]
    expectedArr[order[0]] = kept
    expectedArr[order[1]] = 15 - kept
    expectedArr[order[2]] = 34
    expectedArr[order[3]] = 34
    const actual = [0, 1, 2, 3].map(seat => state.piles[seat].length).join(',')
    check(`${label}：牌墙按一条连续队列消耗`, actual, expectedArr.join(','))
    check(`${label}：动画抓牌张数 = 53`, trace.length, 53)
  }
}

/* ------------------------------------------------------------------ */
console.log('\n' + '='.repeat(72))
console.log('2. 缺门：有缺门牌必须先打缺门牌')
console.log('='.repeat(72))
{
  const hands: Tile[][] = [
    ['1万', '2万', '3万', '1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '1条', '2条'],
    ['1万', '1万', '2万', '2万', '3万', '3万', '4万', '4万', '5万', '5万', '6万', '6万', '7万'],
    ['1条', '1条', '2条', '2条', '3条', '3条', '4条', '4条', '5条', '5条', '6条', '6条', '7条'],
    ['1筒', '1筒', '2筒', '2筒', '3筒', '3筒', '4筒', '4筒', '6筒', '6筒', '7筒', '7筒', '8筒']
  ]
  const piles: Tile[][] = [['9筒'], ['1条'], ['1条'], ['1条']]
  let state = ready(hands, piles, ['万', '条', '万', '条'])
  check('选完缺门后轮到东家摸牌', `${state.phase}/${state.turn}`, 'draw/0')

  state = applyAction(state, { type: 'draw', seat: 0 })
  check('摸牌后阶段是打牌', state.phase, 'discard')
  check('只能打缺门牌', legalDiscards(state, 0).join(','), '1万,2万,3万')
}

/* ------------------------------------------------------------------ */
console.log('\n' + '='.repeat(72))
console.log('3. 碰：接走别家的牌，牌河移除，碰完立即打牌')
console.log('='.repeat(72))
{
  const hands: Tile[][] = [
    ['1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '1条', '1条', '2条', '2条', '3条'],
    ['5筒', '5筒', '1万', '1万', '2万', '2万', '3万', '3万', '4万', '4万', '6万', '6万', '7万'],
    ['1条', '1条', '2条', '2条', '3条', '3条', '4条', '4条', '5条', '5条', '6条', '6条', '7条'],
    ['1条', '1条', '2条', '2条', '3条', '3条', '4条', '4条', '5条', '5条', '6条', '6条', '7条']
  ]
  const piles: Tile[][] = [['9筒'], ['1条'], ['1条'], ['1条']]
  let state = ready(hands, piles, ['万', '条', '万', '筒'])
  state = applyAction(state, { type: 'draw', seat: 0 }) // 摸到 9筒
  state = applyAction(state, { type: 'discard', seat: 0, tile: '5筒' })
  check('进入接牌阶段', state.phase, 'claim')
  check('只有座位 1 能接', state.pendingClaims.join(','), '1')
  check('座位 1 的选项', legalActions(state, 1).map(action => action.type === 'claim' ? action.claim : action.type).join(','), '碰,pass')

  state = applyAction(state, { type: 'claim', seat: 1, claim: '碰' })
  check('碰后手牌 13-2=11 张', state.players[1].hand.length, 11)
  check('副露 1 组', state.players[1].melds.length, 1)
  check('被碰的牌从牌河移除', state.players[0].discards.includes('5筒'), false)
  check('碰完轮到座位 1 打牌', `${state.phase}/${state.turn}`, 'discard/1')
}

/* ------------------------------------------------------------------ */
console.log('\n' + '='.repeat(72))
console.log('4. 杠：从牌尾补牌，且进入杠后状态')
console.log('='.repeat(72))
{
  const hands: Tile[][] = [
    ['1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '1条', '1条', '2条', '2条', '3条'],
    ['5筒', '5筒', '5筒', '1万', '1万', '2万', '2万', '3万', '3万', '4万', '4万', '6万', '6万'],
    ['1条', '1条', '2条', '2条', '3条', '3条', '4条', '4条', '5条', '5条', '6条', '6条', '7条'],
    ['1筒', '1筒', '2筒', '2筒', '3筒', '3筒', '4筒', '4筒', '6筒', '6筒', '7筒', '7筒', '8筒']
  ]
  const piles: Tile[][] = [['9筒'], ['8筒'], ['1条'], ['1条']]
  let state = ready(hands, piles, ['万', '条', '万', '条'])
  state = applyAction(state, { type: 'draw', seat: 0 })
  state = applyAction(state, { type: 'discard', seat: 0, tile: '5筒' })
  state = applyAction(state, { type: 'claim', seat: 1, claim: '杠' })
  check('杠后手牌 13-3+1=11 张', state.players[1].hand.length, 11)
  check('杠从牌墙尾巴补牌（留墩那一头）', state.players[1].hand.includes('8筒'), true)
  check('标记为杠后', state.afterKong, true)
  check('杠后轮到座位 1 打牌', `${state.phase}/${state.turn}`, 'discard/1')
}

/* ------------------------------------------------------------------ */
console.log('\n' + '='.repeat(72))
console.log('5. 接牌成牌：点数、摸子与结算')
console.log('='.repeat(72))
{
  const hands: Tile[][] = [
    ['1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '2条', '2条', '2条', '5条'],
    ['5条', '1筒', '1筒', '2筒', '2筒', '3筒', '3筒', '4条', '4条', '6条', '6条', '7条', '8条'],
    ['1条', '1条', '2条', '2条', '3条', '3条', '4条', '4条', '5条', '5条', '6条', '6条', '7条'],
    ['1筒', '1筒', '2筒', '2筒', '3筒', '3筒', '4筒', '4筒', '6筒', '6筒', '7筒', '7筒', '8筒']
  ]
  const piles: Tile[][] = [['8条'], ['9条'], ['1条'], ['1条']]
  let state = ready(hands, piles, ['万', '万', '万', '万'])

  state = applyAction(state, { type: 'draw', seat: 0 })
  state = applyAction(state, { type: 'discard', seat: 0, tile: '8条' })
  check('座位 1 摸牌', state.phase, 'draw')
  state = applyAction(state, { type: 'draw', seat: 1 })
  state = applyAction(state, { type: 'discard', seat: 1, tile: '5条' })
  check('座位 0 可以成牌', state.pendingClaims.includes(0), true)

  state = applyAction(state, { type: 'claim', seat: 0, claim: '成' })
  check('成牌后阶段结束', state.phase, 'over')
  check('成牌方式为接牌', state.winner?.selfDraw, false)
  check('成牌点数', state.winner?.score.points.total, 34)
  check('单吊算 1 个大摸子', state.winner?.score.mozi.big, 1)

  const settlement = settleHand(state)
  check('点数变化（0 号位 +102）', settlement?.pointDelta.join(','), '102,-34,-34,-34')
  check('金额变化（0 号位 +75，按 5 元取整）', settlement?.moneyDelta.join(','), '75,-25,-25,-25')
  check('本局还没结束', settlement?.gameOver, false)
  // 一把的进出必须配平：点数可能被「付完为止」截断，但金额不能凭空多出来
  const sum = (list: number[]) => Number(list.reduce((a, b) => a + b, 0).toFixed(1))
  check('金额四家合计为 0', sum(settlement?.moneyDelta ?? []), 0)
  check('点数四家合计为 0', sum(settlement?.pointDelta ?? []), 0)
}

/* ------------------------------------------------------------------ */
console.log('\n' + '='.repeat(72))
console.log('6. 自摸成牌：点数翻倍，达到 50 点即大拿')
console.log('='.repeat(72))
{
  const hands: Tile[][] = [
    ['1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '2条', '2条', '2条', '5条'],
    ['1条', '1条', '2条', '2条', '3条', '3条', '4条', '4条', '5条', '5条', '6条', '6条', '7条'],
    ['1万', '1万', '2万', '2万', '3万', '3万', '4万', '4万', '5万', '5万', '6万', '6万', '7万'],
    ['1筒', '1筒', '2筒', '2筒', '3筒', '3筒', '4筒', '4筒', '6筒', '6筒', '7筒', '7筒', '8筒']
  ]
  const piles: Tile[][] = [['5条'], ['1条'], ['1条'], ['1条']]
  let state = ready(hands, piles, ['万', '万', '万', '万'])
  state = applyAction(state, { type: 'draw', seat: 0 }) // 摸到 5条 正好成牌

  const actions = legalActions(state, 0)
  check('摸到成牌张后可自摸', actions.some(action => action.type === 'win'), true)

  state = applyAction(state, { type: 'win', seat: 0 })
  check('自摸标记', state.winner?.selfDraw, true)
  check('自摸点数 34×2=68', state.winner?.score.points.total, 68)
  check('68 点 ≥ 50 → 大拿', state.winner?.score.bigWin.isBigWin, true)

  const settlement = settleHand(state)
  check('大拿：三家点数清零', settlement?.pointDelta.join(','), '150,-50,-50,-50')
  check('大拿：本局结束', settlement?.gameOver, true)
}

/* ------------------------------------------------------------------ */
console.log('\n' + '='.repeat(72))
console.log('6b. 三打一：三家缺同一门时不缺的那家明牌成牌 +5 点 + 1 小摸子')
console.log('='.repeat(72))
{
  const hands: Tile[][] = [
    ['1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '2条', '2条', '2条', '5条'],
    ['1条', '1条', '2条', '2条', '3条', '3条', '4条', '4条', '5条', '5条', '6条', '6条', '7条'],
    ['1万', '1万', '2万', '2万', '3万', '3万', '4万', '4万', '5万', '5万', '6万', '6万', '7万'],
    ['1筒', '1筒', '2筒', '2筒', '3筒', '3筒', '4筒', '4筒', '6筒', '6筒', '7筒', '7筒', '8筒']
  ]
  const piles: Tile[][] = [['5条'], ['1条'], ['1条'], ['1条']]
  // 座位 1/2/3 都缺条，座位 0 缺万 → 座位 0 是明牌的那家
  let state = ready(hands, piles, ['万', '条', '条', '条'])
  state = applyAction(state, { type: 'draw', seat: 0 })
  state = applyAction(state, { type: 'win', seat: 0 })

  const items = state.winner?.score.points.items ?? []
  check('命中三打一', items.some(item => item.name === '三打一' && item.points === 5), true)
  check('点数 39×2=78', state.winner?.score.points.total, 78)
}

/* ------------------------------------------------------------------ */
console.log('\n' + '='.repeat(72))
console.log('7. 流局：牌墙摸完')
console.log('='.repeat(72))
{
  const state = ready(
    [
      ['1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '1条', '2条', '3条', '4条'],
      ['1条', '1条', '2条', '2条', '3条', '3条', '4条', '4条', '5条', '5条', '6条', '6条', '7条'],
      ['1万', '1万', '2万', '2万', '3万', '3万', '4万', '4万', '5万', '5万', '6万', '6万', '7万'],
      ['1筒', '1筒', '2筒', '2筒', '3筒', '3筒', '4筒', '4筒', '6筒', '6筒', '7筒', '7筒', '8筒']
    ],
    [[], [], [], []],
    ['万', '条', '条', '条']
  )
  const after = applyAction(state, { type: 'draw', seat: 0 })
  check('牌墙空 → 流局', after.result, 'exhausted')
  check('流局后阶段结束', after.phase, 'over')
  check('流局没有赢家', after.winner, null)
}

/* ------------------------------------------------------------------ */
console.log('\n' + '='.repeat(72))
console.log('8. 大吊车禁打')
console.log('='.repeat(72))
{
  const hands: Tile[][] = [
    ['1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '1条', '2条', '3条', '4条'],
    ['5万', '5万', '1条', '2条', '3条', '4条', '5条', '6条', '7条', '8条', '9条', '1万', '2万'],
    ['3万', '4万', '5万', '6万', '7万', '1条', '2条', '3条', '4条', '5条', '6条', '7条', '8条'],
    ['1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '1条', '2条', '3条', '4条']
  ]
  const piles: Tile[][] = [['9筒'], ['1条'], ['1条'], ['1条']]
  let state = ready(hands, piles, ['条', '筒', '条', '万'])

  // 把座位 1 造成大吊车局面：四组碰 + 手里一对
  state.players[1].melds = [
    { kind: '碰', tile: '1筒' },
    { kind: '碰', tile: '2筒' },
    { kind: '碰', tile: '3筒' },
    { kind: '碰', tile: '4筒' }
  ]
  state.players[1].hand = ['5万', '5万']
  state.phase = 'discard'
  state.turn = 1
  state.drawnTile = '5万'
  check('大吊车局面判定', isDaLiaoChe(state.players[1]), false)

  state = applyAction(state, { type: 'discard', seat: 1, tile: '5万' })
  check('打完一张后进入大吊车', isDaLiaoChe(state.players[1]), true)
  check('生成禁打范围', state.bans.length, 1)
  check(
    '打 5 万 → 禁 3~7 万',
    forbiddenDiscardsFor(state, 2).join(','),
    '3万,4万,5万,6万,7万'
  )
  check('缺万的人不受限', forbiddenDiscardsFor(state, 3).length, 0)

  // 手里已经四张 6 万 → 6 万绝对安全
  const safe = { ...state, players: state.players.map(player => ({ ...player, hand: [...player.hand] })) }
  safe.players[2].hand = ['6万', '6万', '6万', '6万']
  check('手里四张 6 万 → 6 万可打', forbiddenDiscardsFor(safe, 2).includes('6万'), false)
  check('其余仍在禁打范围', forbiddenDiscardsFor(safe, 2).join(','), '3万,4万,5万,7万')

  // 大吊车玩家换掉最后一支牌 → 解除
  state.players[1].hand = ['8条']
  check('换掉最后一支牌后解除禁打', forbiddenDiscardsFor(state, 2).length, 0)
}

/* ------------------------------------------------------------------ */
console.log('\n' + '='.repeat(72))
console.log('9. 大吊车禁打点炮：一人赔三家')
console.log('='.repeat(72))
{
  const hands: Tile[][] = [
    ['5万', '5万', '1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '1条', '2条'],
    ['1条', '1条', '2条', '2条', '3条', '3条', '4条', '4条', '5条', '5条', '6条', '6条', '7条'],
    ['3万', '4万', '5万', '6万', '7万', '1条', '2条', '3条', '4条', '5条', '6条', '7条', '8条'],
    ['1筒', '1筒', '2筒', '2筒', '3筒', '3筒', '4筒', '4筒', '6筒', '6筒', '7筒', '7筒', '8筒']
  ]
  const piles: Tile[][] = [['9筒'], ['1条'], ['1条'], ['1条']]
  let state = ready(hands, piles, ['条', '筒', '筒', '条'])

  // 座位 0 大吊车：四组碰 + 单吊 5 万
  state.players[0].melds = [
    { kind: '碰', tile: '1筒' },
    { kind: '碰', tile: '2筒' },
    { kind: '碰', tile: '3筒' },
    { kind: '碰', tile: '4筒' }
  ]
  state.players[0].hand = ['5万', '5万']
  state.phase = 'discard'
  state.turn = 0
  state.drawnTile = '5万'
  state = applyAction(state, { type: 'discard', seat: 0, tile: '5万' })
  check('座位 0 进入大吊车', state.bans.some(ban => ban.seat === 0), true)

  // 座位 1 打出禁牌 5 万 → 点炮
  state.players[1].hand = ['5万', '1条', '1条', '2条', '2条', '3条', '3条', '4条', '4条', '6条', '6条', '7条', '8条']
  state.phase = 'discard'
  state.turn = 1
  state.drawnTile = '8条'
  state = applyAction(state, { type: 'discard', seat: 1, tile: '5万' })

  const win = legalActions(state, 0).find(action => action.type === 'claim' && action.claim === '成')
  check('座位 0 能成禁打牌', !!win, true)
  state = applyAction(state, { type: 'claim', seat: 0, claim: '成' })
  check('成大吊车即大拿', state.winner?.score.bigWin.isBigWin, true)
  check('记录单人承担座位', state.singlePayerSeat, 1)
  const settlement = settleHand(state)
  check('只由座位 1 出钱', settlement?.moneyDelta[1], -150)
  check('其他两家不付钱', `${settlement?.moneyDelta[2]},${settlement?.moneyDelta[3]}`, '0,0')
  check('赢家收到三家金额', settlement?.moneyDelta[0], 150)
}

/* ------------------------------------------------------------------ */
console.log('\n' + '='.repeat(72))
console.log('10. 局流程：点数转移、局末清算、四局调圈')
console.log('='.repeat(72))

/** 把动作作用到 match.current 上 */
const act = (match: MatchState, action: RoundAction): MatchState => ({
  ...match,
  current: applyAction(match.current as HandState, action)
})

/** 构造一个结算结果，用于直接测局流程 */
const fakeSettlement = (winnerSeat: number): HandSettlement => {
  const score = scoreHand({ concealed: ['1筒', '2筒', '3筒'] , melds: [], winTile: '3筒' })
  return {
    winnerSeat,
    selfDraw: true,
    score,
    pointDelta: [150, -50, -50, -50],
    moneyDelta: [135, -45, -45, -45],
    gameOver: true
  }
}

{
  let match = createMatch()
  check('新局：4 家各 50 点', match.points.join(','), '50,50,50,50')
  check('新局：第 1 局、0 把', `${match.roundIndex}/${match.hands}`, '1/0')

  // 用第 5 组那手牌跑一把真实的接牌成牌
  const hands: Tile[][] = [
    ['1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '2条', '2条', '2条', '5条'],
    ['5条', '1筒', '1筒', '2筒', '2筒', '3筒', '3筒', '4条', '4条', '6条', '6条', '7条', '8条'],
    ['1条', '1条', '2条', '2条', '3条', '3条', '4条', '4条', '5条', '5条', '6条', '6条', '7条'],
    ['1筒', '1筒', '2筒', '2筒', '3筒', '3筒', '4筒', '4筒', '6筒', '6筒', '7筒', '7筒', '8筒']
  ]
  const piles: Tile[][] = [['8条'], ['9条'], ['1条'], ['1条']]
  match = startHand(match, 1, 4, { hands, piles })
  check('开局带上本局点数', match.current?.players[0].points, 50)
  check('本局第 1 把算首牌', match.current?.isFirstHand, true)

  match = act(match, { type: 'chooseShortage', seat: 0, suit: '万' })
  match = act(match, { type: 'chooseShortage', seat: 1, suit: '万' })
  match = act(match, { type: 'chooseShortage', seat: 2, suit: '万' })
  match = act(match, { type: 'chooseShortage', seat: 3, suit: '万' })
  match = act(match, { type: 'draw', seat: 0 })
  match = act(match, { type: 'discard', seat: 0, tile: '8条' })
  match = act(match, { type: 'draw', seat: 1 })
  match = act(match, { type: 'discard', seat: 1, tile: '5条' })
  match = act(match, { type: 'claim', seat: 0, claim: '成' })

  match = endHand(match)
  check('本把点数转移', match.points.join(','), '152,16,16,16')
  check('赢家获得下把掷骰权', match.rollerSeat, 0)
  check('本局继续（没人被付完）', match.roundIndex, 1)
  check('本局已打 1 把', match.hands, 1)
  check('本局金额记录（按 5 元取整）', match.money.join(','), '75,-25,-25,-25')
  const second = startHand(match, 1, 4, { hands, piles })
  check('第二把不再是首牌', second.current?.isFirstHand, false)
  // 点数要一把一把往下滚，第二把开局带的是上把结算后的点数
  check('第二把带着上把之后的点数开局', second.current?.players[0].points, 152)

  // 有人点数被付完 → 本局结束、下一局恢复 50 点
  let after = applyHandSettlement({ ...createMatch(), hands: 1 }, fakeSettlement(0))
  check('局末：进入第 2 局', after.roundIndex, 2)
  check('局末：点数恢复 50', after.points.join(','), '50,50,50,50')
  check('局末：本局金额清零', after.money.join(','), '0,0,0,0')
  check('局末：累计金额保留', after.totalMoney.join(','), '135,-45,-45,-45')
  check('局末：把数重置', after.hands, 0)
  check('局末：留下总账记录', after.history.length, 1)

  // 打满 4 局 → 调圈
  let threw = false
  try {
    applyHandSettlement({ ...createMatch(), roundIndex: 4 }, fakeSettlement(2))
  } catch {
    threw = true
  }
  check('打满 4 局缺少调圈骰子 → 报错', threw, true)

  const circled = applyHandSettlement({ ...createMatch(), roundIndex: 4 }, fakeSettlement(2), { circleDiceSum: 7 })
  check('调圈后局数继续往上加（第 5 局）', circled.roundIndex, 5)
  check('调圈：骰子指向的座位 0 不动', circled.seats[0], 0)
  check('调圈：座位重排', circled.seats.join(','), '0,3,1,2')

  // 单人演示不调圈：座位不动，局数照样往上加
  const fixed = applyHandSettlement({ ...createMatch(), roundIndex: 4 }, fakeSettlement(2), { rotate: false })
  check('不调圈：座位不动', fixed.seats.join(','), '0,1,2,3')
  check('不调圈：局数照样 +1', fixed.roundIndex, 5)
  check('不调圈：累计金额照记', fixed.totalMoney.join(','), '135,-45,-45,-45')
}

/* ------------------------------------------------------------------ */
console.log('\n' + '='.repeat(72))
console.log('10. 枯只压：自己碰出去的也算「场上最后一张」')
console.log('='.repeat(72))
{
  // 用户反馈：碰了 2 万，手里 1 万 3 万 卡 2 万，成的就是最后一张 2 万。
  // 另外两个顺子 + 南南 做将，缺条，手牌合法。
  const others: Tile[][] = [
    [],
    ['1筒', '1筒', '6条', '6条', '西', '西', '北', '北', '1条', '2条', '3条', '4万', '4万'],
    ['5万', '5万', '6万', '6万', '7万', '7万', '2条', '2条', '3条', '3条', '发', '发', '白'],
    ['5条', '5条', '6条', '6条', '7条', '7条', '2筒', '2筒', '3筒', '3筒', '中', '中', '白']
  ]
  const concealed = ['1万', '3万', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '南', '南']

  /** 摆好「碰 2 万 + 1 万 3 万 等 2 万」的局面；selfDraw 时 2 万 在手里 */
  const setup = (selfDraw: boolean): HandState => {
    const state = createHand({
      diceA: 3,
      diceB: 3,
      hands: [concealed, others[1], others[2], others[3]],
      piles: [['9筒'], ['9筒'], ['9筒'], ['9筒']],
      aiSeats: []
    })
    state.players[0].shortage = '条'
    state.players[0].melds = [{ kind: '碰', tile: '2万' }]
    state.players[0].hand = selfDraw ? [...concealed, '2万'] : [...concealed]
    state.phase = 'discard'
    state.turn = 0
    state.drawnTile = selfDraw ? '2万' : null
    return state
  }

  // 口径：只算别家 vs 连自己碰出去的一起算
  const probe = setup(true)
  check('visibleCount：只算别家时 2 万 是 0 张', visibleCount(probe, '2万', 0), 0)
  check('visibleCount：算上自己碰出的 3 张', visibleCount(probe, '2万', null), 3)

  // 自摸：2 万 是场上最后一张 → 枯只压 3 个大摸子
  const selfDrawn = applyAction(setup(true), { type: 'win', seat: 0 })
  const selfScore = selfDrawn.winner?.score
  check('自摸：成牌结构合法', selfScore?.isWinningHand, true)
  check('自摸：自己碰出去的 3 张也算已出 → 枯只压', selfScore?.mozi.items.some(i => i.name === '枯只压'), true)
  check('自摸枯只压 = 3 个大摸子', selfScore?.mozi.big, 3)
  // 枯只压点数是在压当之外额外加：底 4 + 碰 1 + 小连号 5 + 四活 10 + 压当 1 + 枯只压 21 = 42
  check('枯只压 +20 点（整十）', selfScore?.points.items.find(i => i.name === '枯只压')?.points, 20)
  check('枯只压照算压当的 1 点', selfScore?.points.items.find(i => i.name === '压当')?.points, 1)
  check('自摸枯只压 = 41 × 2 = 82 点', selfScore?.points.total, 82)
  // 84 点 ≥ 大拿线 50，所以自摸枯只压必是大拿：40 元/家 + 摸子 30 元/家
  check('自摸枯只压按大拿结算', selfScore?.bigWin.isBigWin, true)
  check('自摸枯只压每家 70 元（大拿 40 + 摸子 30）', selfScore?.money.perOpponentTotal, 70)

  // 接牌：别家打出最后一张 2 万，同样算枯只压（1 大 + 1 小）
  const claimed = setup(false)
  // 座位 1 缺筒、手里没筒，才能自由打 2 万
  claimed.players[1].shortage = '筒'
  claimed.players[1].hand = ['6条', '6条', '西', '西', '北', '北', '1条', '2条', '2万', '4万', '4万', '5万', '5万']
  claimed.phase = 'discard'
  claimed.turn = 1
  claimed.drawnTile = '2万'
  const afterDiscard = applyAction(claimed, { type: 'discard', seat: 1, tile: '2万' })
  check('接牌：座位 0 进入待表态', afterDiscard.pendingClaims.includes(0), true)
  const claimedWin = applyAction(afterDiscard, { type: 'claim', seat: 0, claim: '成' })
  const claimScore = claimedWin.winner?.score
  check('接牌：同样算枯只压', claimScore?.mozi.items.some(i => i.name === '枯只压'), true)
  check('枯只压接牌 = 1 个大摸子', `${claimScore?.mozi.big} 大 + ${claimScore?.mozi.small} 小`, '1 大 + 0 小')
  // 接牌不乘自摸倍数：42 点，还没到大拿线
  check('接牌枯只压 = 41 点', claimScore?.points.total, 41)
  check('接牌枯只压不是大拿', claimScore?.bigWin.isBigWin, false)
  check('接牌每家 30 元（点数 20 + 摸子 10）', claimScore?.money.perOpponentTotal, 30)

  // 边界：自己的碰不是 2 万、外面只出了 2 张 → 不是枯只压（还是普通压当）
  const few = setup(true)
  few.players[0].melds = [{ kind: '碰', tile: '1筒' }]
  few.players[0].hand = ['1万', '3万', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '南', '南', '2万']
  few.players[1].discards = ['2万', '2万']
  const fewScore = applyAction(few, { type: 'win', seat: 0 }).winner?.score
  check('外面只出 2 张 → 不算枯只压', fewScore?.mozi.items.some(i => i.name === '枯只压'), false)
  check('外面只出 2 张 → 仍是压当 1 个大摸子', fewScore?.mozi.big, 1)
}

/* ------------------------------------------------------------------ */
console.log('\n' + '='.repeat(72))
console.log('11. 抢杠是接牌：不继承上一杠的杠后赛花')
console.log('='.repeat(72))
{
  // 座位 1 碰了 2 万、手里第四张准备加杠；他上一杠刚补摸完（afterKong 还没被出牌清掉）。
  // 座位 0 对倒 2 万，抢杠成牌——抢杠是接牌，不能算杠开/杠后赛花，也不能把摸子翻倍。
  const state = createHand({
    diceA: 3,
    diceB: 3,
    hands: [
      ['2万', '2万', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '1条', '2条', '3条', '南', '南'],
      ['2万', '1条', '4条', '5条', '6条', '7条', '8条', '西', '西', '西', '北', '北', '白'],
      ['5万', '5万', '6万', '6万', '7万', '7万', '2条', '2条', '3条', '3条', '发', '发', '白'],
      ['5条', '5条', '6条', '6条', '7条', '7条', '2筒', '2筒', '3筒', '3筒', '中', '中', '白']
    ],
    piles: [['9筒'], ['9筒'], ['9筒'], ['9筒']],
    aiSeats: []
  })
  for (const player of state.players) player.shortage = null as any
  state.players[1].melds = [{ kind: '碰', tile: '2万' }]
  state.players[1].hand = ['2万', '1条', '4条', '5条', '6条', '7条', '8条', '西', '西', '西', '北', '北', '白']
  state.phase = 'discard'
  state.turn = 1
  state.drawnTile = '2万'
  state.afterKong = true // 上一杠刚补摸完，还没出牌

  const robbed = applyAction(state, { type: 'kong', seat: 1, kind: '加杠', tile: '2万' } as RoundAction)
  check('加杠被抢 → 进入抢杠阶段', robbed.phase, 'rob-kong')
  check('抢杠候选是座位 0', robbed.robKong?.pending.join(','), '0')

  const won = applyAction(robbed, { type: 'win', seat: 0, robKong: true } as RoundAction)
  const score = won.winner!.score
  check('抢杠成牌是接牌', won.winner!.selfDraw, false)
  check('成牌张凑成刻子 → 借牌按碰算', score.points.items.some(item => (item.detail ?? '').includes('借牌')), true)
  check('抢杠不算杠开', score.points.items.some(item => item.name === '杠开'), false)
  check('抢杠摸子不翻倍', score.mozi.multiplier, 1)
  check('抢杠不显示杠后赛花', score.details.some(line => line.includes('杠后赛花')), false)
}

/* ------------------------------------------------------------------ */
console.log('\n' + '='.repeat(72))
console.log(`${checks - failures}/${checks} 项通过${failures ? `，${failures} 项失败` : ''}`)
console.log('='.repeat(72))

if (failures) process.exitCode = 1
