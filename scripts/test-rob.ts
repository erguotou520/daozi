import { applyAction, createHand, legalActions, type HandState } from '../src/game/game'
import type { Tile } from '../src/game/score'

const p0: Tile[] = ['1万','1万','3万','3万','4万','4万','5万','5万','6万','6万','7筒','7筒','2万']
const p1: Tile[] = ['2万','2万','2万','1筒','3筒','5筒','7筒','9筒','1条','3条','5条','7条','2万']
const p2: Tile[] = ['1万','2万','3万','4万','5万','6万','7万','8万','9万','1筒','2筒','3筒','4筒']
const p3: Tile[] = ['1条','2条','3条','4条','5条','6条','7条','8条','9条','1万','2万','3万','4万']
let state = createHand({ diceA: 1, diceB: 4, hands: [p0,p1,p2,p3], piles: [[],[],[],[]], aiSeats: [] })
for (const seat of [0,1,2,3]) {
  state = applyAction(state, { type:'chooseShortage', seat, suit:'条' } as any)
}
state.phase = 'discard'
state.turn = 1
state.drawnTile = '2万'
state.players[1].hand = ['2万','2万','2万','1筒','3筒','5筒','7筒','9筒','1条','3条','5条','7条','2万']
state.players[1].melds = [{ kind:'碰', tile:'2万' }]
console.log('kong options', legalActions(state,1).filter(a=>a.type==='kong'))
const afterKong = applyAction(state, { type:'kong', seat:1, tile:'2万', kind:'加杠' })
if (afterKong.phase !== 'rob-kong' || afterKong.robKong?.pending[0] !== 0) throw new Error('抢杠窗口未打开')
const robActions = legalActions(afterKong, 0)
if (!robActions.some(a => a.type === 'win' && a.robKong)) throw new Error('没有抢杠成牌按钮')
const win = applyAction(afterKong, { type:'win', seat:0, robKong:true })
if (win.phase !== 'over' || win.winner?.seat !== 0) throw new Error('抢杠成牌未结算')
console.log('✓ 碰后加杠可被抢杠，抢杠成牌结算成功')
