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
  type HandState,
  type RoundAction
} from '../src/game/game'
import { applyHandSettlement, createMatch, endHand, startHand, type MatchState } from '../src/game/match'
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

/* ------------------------------------------------------------------ */
console.log('='.repeat(72))
console.log('1. 开局：掷骰、留墩、发牌')
console.log('='.repeat(72))
{
  const state = createHand({ diceA: 2, diceB: 6, seed: 7 })
  check('2+6=8 → 上家（座位 3）做东', state.dealerSeat, 3)
  check('开牌墙也在座位 3', state.wallSeat, 3)
  check('留 2 墩', state.breakStacks, 2)
  check('东家 14 张', state.players[3].hand.length, 14)
  check('闲家各 13 张', [0, 1, 2].map(seat => state.players[seat].hand.length).join(','), '13,13,13')
  check('牌墙剩 136-53=83 张', remainingTiles(state), 83)
  check('开局阶段是选缺门', state.phase, 'choose-shortage')
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
  const piles: Tile[][] = [['9筒'], ['1条'], ['1条'], ['8筒']]
  let state = ready(hands, piles, ['万', '条', '万', '条'])
  state = applyAction(state, { type: 'draw', seat: 0 })
  state = applyAction(state, { type: 'discard', seat: 0, tile: '5筒' })
  state = applyAction(state, { type: 'claim', seat: 1, claim: '杠' })
  check('杠后手牌 13-3+1=11 张', state.players[1].hand.length, 11)
  check('杠从牌尾补到 8筒', state.players[1].hand.includes('8筒'), true)
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
  check('金额变化（0 号位 +81）', settlement?.moneyDelta.join(','), '81,-27,-27,-27')
  check('本局还没结束', settlement?.gameOver, false)
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
console.log('10. 局流程：点数转移、局末清算、四把调圈')
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
  check('本局金额记录', match.money.join(','), '81,-27,-27,-27')
  check('第二把不再是首牌', startHand(match, 1, 4, { hands, piles }).current?.isFirstHand, false)

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

  const circled = applyHandSettlement({ ...createMatch(), roundIndex: 4 }, fakeSettlement(2), 7)
  check('调圈后回到第 1 局', circled.roundIndex, 1)
  check('调圈：骰子指向的座位 0 不动', circled.seats[0], 0)
  check('调圈：座位重排', circled.seats.join(','), '0,3,1,2')
}

/* ------------------------------------------------------------------ */
console.log('\n' + '='.repeat(72))
console.log(`${checks - failures}/${checks} 项通过${failures ? `，${failures} 项失败` : ''}`)
console.log('='.repeat(72))

if (failures) process.exitCode = 1
