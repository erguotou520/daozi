import { computed, defineComponent, onUnmounted, ref, watchEffect } from 'vue'
import { useTitle } from '@/hooks'
import {
  applyAction,
  chooseAIAction,
  createHand,
  forbiddenDiscardsFor,
  legalActions,
  playableDiscards,
  remainingTiles,
  settleHand,
  shortageTiles,
  wallVisualOf,
  type HandState,
  type RoundAction
} from '@/game/game'
import { tileOrder, type NumberSuit, type Tile } from '@/game/score'
import TileView, { WallLine } from './components/TileView'
import { DiscardLane, MeldRack, OpponentSeat } from './components/TableParts'

const SEAT_NAMES = ['自己', '下家', '对面', '上家']
const SHORTAGE_OPTIONS: NumberSuit[] = ['万', '筒', '条']

const TablePage = defineComponent({
  name: 'TablePage',
  setup() {
    useTitle('牌桌')

    const state = ref<HandState | null>(null)
    const dice = ref<{ a: number; b: number } | null>(null)
    let timer: number | undefined

    const clearTimer = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer)
        timer = undefined
      }
    }

    const currentActor = (hand: HandState): number | null => {
      if (hand.phase === 'over') return null
      if (hand.phase === 'claim') return hand.pendingClaims[0] ?? null
      return hand.turn
    }

    // AI 连续行动；轮到人就停下来等操作
    const tick = () => {
      const hand = state.value
      if (!hand || hand.phase === 'over') return

      // 选缺门阶段四家并行，不能只看 turn 那一家
      if (hand.phase === 'choose-shortage') {
        const pending = hand.players.find(player => !player.shortage && player.isAI)
        if (pending) {
          const action = chooseAIAction(hand, pending.seat)
          if (action) {
            state.value = applyAction(hand, action)
            schedule(220)
          }
        }
        return
      }

      const seat = currentActor(hand)
      if (seat === null || !hand.players[seat].isAI) return
      const action = chooseAIAction(hand, seat)
      if (!action) return
      state.value = applyAction(hand, action)
      schedule()
    }

    // AI 出牌节奏：跟原型一样加一点随机延迟，别一下甩完
    const schedule = (delay = 300 + Math.random() * 1200) => {
      clearTimer()
      timer = window.setTimeout(tick, delay)
    }

    const act = (action: RoundAction, delay = 220) => {
      const hand = state.value
      if (!hand) return
      try {
        state.value = applyAction(hand, action)
      } catch {
        return
      }
      schedule(delay)
    }

    const start = () => {
      clearTimer()
      const a = 1 + Math.floor(Math.random() * 6)
      const b = 1 + Math.floor(Math.random() * 6)
      dice.value = { a, b }
      state.value = createHand({ diceA: a, diceB: b, aiSeats: [1, 2, 3] })
    }

    const quit = () => {
      clearTimer()
      state.value = null
    }

    // 牌桌按容器量出来：占满可用区域，所有牌的尺寸按 --bw 取比例
    const wrapRef = ref<HTMLElement | null>(null)
    const surfaceRef = ref<HTMLElement | null>(null)
    let observer: ResizeObserver | undefined

    const measure = () => {
      const wrap = wrapRef.value
      const surface = surfaceRef.value
      if (!wrap || !surface) return
      const width = wrap.clientWidth
      const height = wrap.clientHeight
      if (width < 80 || height < 80) return
      // 手牌那一行横向约 0.78 个基准宽、整桌纵向约 0.90 个基准高，取两边都放得下的值
      const base = Math.min(width / 0.78, height / 0.9)
      surface.style.setProperty('--bw', `${Math.round(base)}px`)
      // 牌桌高度按比例给，多余的毡面留在四周，看起来才像一张摆在桌上的牌桌
      surface.style.height = `${Math.round(base * 0.9)}px`
    }

    watchEffect(() => {
      const wrap = wrapRef.value
      observer?.disconnect()
      observer = undefined
      if (!wrap || typeof ResizeObserver === 'undefined') return
      observer = new ResizeObserver(() => measure())
      observer.observe(wrap)
      measure()
    })

    onUnmounted(() => {
      clearTimer()
      observer?.disconnect()
    })

    const me = computed(() => state.value?.players[0] ?? null)
    const isMyTurn = computed(() => {
      const hand = state.value
      if (!hand || hand.phase === 'over') return false
      return currentActor(hand) === 0
    })

    const myActions = computed(() => (state.value && isMyTurn.value ? legalActions(state.value, 0) : []))
    const myClaims = computed(() => myActions.value.filter(action => action.type === 'claim' || action.type === 'pass'))

    const playable = computed(() => {
      const hand = state.value
      return new Set(hand ? playableDiscards(hand, 0) : [])
    })
    const forbidden = computed(() => {
      const hand = state.value
      return new Set(hand ? forbiddenDiscardsFor(hand, 0) : [])
    })

    /** 手里还有缺门牌时，只有缺门牌能打——这些牌要高亮 */
    const mustPlayShortage = computed(() => {
      const hand = state.value
      return hand ? shortageTiles(hand.players[0]).length > 0 : false
    })

    /** 手牌：排序后把刚摸到的那张单独放到最右，跟手牌区隔开 */
    const handTiles = computed(() => {
      const hand = state.value
      if (!hand) return [] as Tile[]
      const drawn = hand.drawnTile
      const tiles = [...hand.players[0].hand]
      if (drawn) {
        const index = tiles.indexOf(drawn)
        if (index >= 0) tiles.splice(index, 1)
      }
      tiles.sort(tileOrder)
      return drawn ? [...tiles, drawn] : tiles
    })

    const settlement = computed(() => {
      const hand = state.value
      if (!hand || hand.phase !== 'over' || !hand.winner) return null
      return settleHand(hand)
    })

    return () => {
      const hand = state.value

      if (!hand || !me.value) {
        return (
          <div class="flex flex-1 flex-col items-center justify-center gap-8 px-6">
            <div class="text-center">
              <div class="font-serif text-[1.7rem] tracking-[0.24em] text-ivory">开始一把</div>
              <p class="mt-4 text-[12px] leading-6 text-mist">
                三家电脑陪你打。
                <br />
                掷骰子定东家，再选缺门。
              </p>
            </div>
            <button
              type="button"
              class="tile-face tile-press rounded-2xl px-9 py-4 font-serif text-[15px] tracking-[0.28em] text-ink"
              onClick={start}
            >
              掷骰子
            </button>
          </div>
        )
      }

      const winnerSeat = hand.winner?.seat ?? -1
      const actor = currentActor(hand)
      const isOver = hand.phase === 'over'
      const self = hand.players[0]

      return (
        <div class="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2 pt-1">
          <div ref={wrapRef} class="flex min-h-0 flex-1 items-center justify-center">
            <div ref={surfaceRef} class="table-surface flex w-full shrink-0 flex-col justify-between gap-1">
            {/* 对面：手牌 + 牌河 */}
            <div class="flex items-start justify-center">
              <OpponentSeat
                player={hand.players[2]}
                name={SEAT_NAMES[2]}
                side="top"
                active={actor === 2}
                dealer={hand.dealerSeat === 2}
                reveal={isOver && winnerSeat === 2}
              />
            </div>
            <DiscardLane discards={hand.players[2].discards} markLast={hand.lastPlayed?.seat === 2} seq={hand.logs.length} />

            {/* 中间一圈：上家 · 牌山内圈 · 下家 */}
            <div class="flex min-h-0 flex-1 items-stretch justify-center gap-1">
              {/* 左右两组同宽，中间的牌圈才会正中对齐 */}
              <div class="flex shrink-0 items-center justify-center gap-1" style={{ width: 'calc(var(--bw) * 0.11)' }}>
                <OpponentSeat
                  player={hand.players[3]}
                  name={SEAT_NAMES[3]}
                  side="left"
                  active={actor === 3}
                  dealer={hand.dealerSeat === 3}
                  reveal={isOver && winnerSeat === 3}
                />
                <DiscardLane vertical rotate={90} discards={hand.players[3].discards} markLast={hand.lastPlayed?.seat === 3} seq={hand.logs.length} />
              </div>

              {/* 牌山内圈 + 中央信息 */}
              <div class="flex min-h-0 shrink-0 items-center justify-center">
              <div class="flex flex-col items-center justify-center gap-1" style={{ width: 'var(--ring)' }}>
                <WallLine stacks={wallVisualOf(hand, 2)} />
                <div class="flex w-full items-center gap-1">
                  <WallLine flat stacks={wallVisualOf(hand, 3)} />

                  <div
                    class="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1.5 py-1.5 text-center"
                    style={{
                      background: 'rgba(7, 28, 23, 0.72)',
                      border: '1px solid rgba(217, 180, 95, 0.28)',
                      boxShadow: 'inset 0 0 24px rgba(0, 0, 0, 0.4)'
                    }}
                  >
                    <div class="font-serif text-[13px] tracking-[0.2em] text-brass">倒 子</div>
                    <div class="text-[10px] leading-4 text-mist">
                      牌山 {remainingTiles(hand)}
                      {dice.value ? ` · 骰 ${dice.value.a}+${dice.value.b}` : ''}
                    </div>
                    <div class="text-[10px] leading-4 text-ivory">
                      {isOver
                        ? hand.result === 'exhausted'
                          ? '本把流局'
                          : `${SEAT_NAMES[winnerSeat]}成牌`
                        : isMyTurn.value
                          ? '轮到你'
                          : `轮到${SEAT_NAMES[actor ?? 0]}`}
                    </div>

                    {hand.lastPlayed && (
                      <div class="flex items-center gap-1 text-[10px] leading-none text-mist">
                        <span>刚打</span>
                        <TileView tile={hand.lastPlayed.tile} size="seat" marked />
                        <span>{SEAT_NAMES[hand.lastPlayed.seat]}</span>
                      </div>
                    )}

                    {/* 接牌按钮（原型也放在中间） */}
                    {hand.phase === 'claim' && isMyTurn.value && (
                      <div class="mt-0.5 flex flex-wrap justify-center gap-1">
                        {myClaims.value.map(action => {
                          if (action.type === 'pass') {
                            return (
                              <button
                                key="pass"
                                type="button"
                                class="chip tile-press claim-in rounded-lg px-2.5 py-1 font-serif text-[12px]"
                                onClick={() => act(action)}
                              >
                                过
                              </button>
                            )
                          }
                          if (action.type === 'claim') {
                            return (
                              <button
                                key={action.claim}
                                type="button"
                                class="tile-face-sm tile-press claim-in rounded-lg px-2.5 py-1 font-serif text-[12px] text-ink"
                                onClick={() => act(action)}
                              >
                                {action.claim}
                              </button>
                            )
                          }
                          return null
                        })}
                      </div>
                    )}

                    {/* 结算：半透明铺在中间 */}
                    {isOver && (
                      <div class="fade-in mt-1 w-[13rem] text-left text-[10px] leading-4 text-ivory" style={{ opacity: 0.9 }}>
                        {hand.winner ? (
                          <>
                            <div class="mb-0.5 flex items-baseline gap-1">
                              <span class="font-serif text-[15px] text-brass">{hand.winner.score.points.total}</span>
                              <span class="text-mist">点</span>
                              {hand.winner.score.bigWin.isBigWin && (
                                <span class="rounded-[3px] bg-vermillion px-1 text-[9px] leading-4">大拿</span>
                              )}
                              <span class="ml-auto text-mist">
                                {hand.winner.score.money.perOpponentTotal} 元/家
                              </span>
                            </div>
                            <div class="space-y-0.5 text-mist">
                              {hand.winner.score.details.slice(0, 6).map((line, index) => (
                                <div key={index}>{line}</div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div class="text-mist">牌山摸完，本把不算输赢。</div>
                        )}
                      </div>
                    )}
                  </div>

                  <WallLine flat stacks={wallVisualOf(hand, 1)} />
                </div>
                <WallLine stacks={wallVisualOf(hand, 0)} />
              </div>
              </div>

              <div class="flex shrink-0 items-center justify-center gap-1" style={{ width: 'calc(var(--bw) * 0.11)' }}>
                <DiscardLane vertical rotate={-90} discards={hand.players[1].discards} markLast={hand.lastPlayed?.seat === 1} seq={hand.logs.length} />
                <OpponentSeat
                  player={hand.players[1]}
                  name={SEAT_NAMES[1]}
                  side="right"
                  active={actor === 1}
                  dealer={hand.dealerSeat === 1}
                  reveal={isOver && winnerSeat === 1}
                />
              </div>
            </div>

            {/* 自己的牌河 */}
            <DiscardLane discards={self.discards} markLast={hand.lastPlayed?.seat === 0} seq={hand.logs.length} />

            {/* 自己：手牌 + 副露放右手侧 */}
            <div class="flex flex-col gap-1.5">
              <div class="flex items-baseline gap-2 text-[10px] leading-none">
                <span class="text-ivory">{SEAT_NAMES[0]}</span>
                {hand.dealerSeat === 0 && <span class="rounded-[3px] bg-brass px-1 text-[9px] leading-4 text-ink">东</span>}
                <span class="text-mist">{self.shortage ? `缺${self.shortage}` : '待选缺门'}</span>
                <span class="text-mist">
                  {self.hand.length} 张
                  {hand.phase === 'discard' && isMyTurn.value ? (mustPlayShortage.value ? ' · 必须打缺门牌' : ' · 点手牌打出') : ''}
                </span>
              </div>

              <div class="flex items-end justify-between gap-3">
                <div class="flex flex-wrap gap-[3px]">
                  {handTiles.value.map((tile, index) => {
                    const isDrawn = hand.drawnTile !== null && index === handTiles.value.length - 1
                    const canPlay = hand.phase === 'discard' && isMyTurn.value && playable.value.has(tile)
                    const isForbidden = forbidden.value.has(tile)
                    // 手里有缺门牌时，缺门牌高亮、其余一律不能打
                    const mustPlay = canPlay && mustPlayShortage.value
                    return (
                      <button
                        key={isDrawn ? `drawn-${hand.logs.length}` : `${tile}-${index}`}
                        type="button"
                        disabled={!canPlay}
                        class={[
                          'hand-tile rounded-[4px]',
                          isDrawn ? 'is-drawn' : '',
                          canPlay ? '' : 'cursor-not-allowed opacity-30'
                        ]}
                        style={{
                          outline: mustPlay
                            ? '2px solid var(--brass)'
                            : isForbidden
                              ? '1.5px solid rgba(200, 69, 47, 0.9)'
                              : undefined,
                          outlineOffset: mustPlay ? '0px' : undefined,
                          boxShadow: mustPlay ? '0 0 12px rgba(217, 180, 95, 0.45)' : undefined
                        }}
                        onClick={() => act({ type: 'discard', seat: 0, tile })}
                      >
                        <TileView tile={tile} size="hand" enter={isDrawn} />
                      </button>
                    )
                  })}
                </div>

                {self.melds.length > 0 && <MeldRack melds={self.melds} />}
              </div>
            </div>
            </div>
          </div>

          {/* 操作条 */}
          <div class="flex shrink-0 items-center gap-2">
            {hand.phase === 'choose-shortage' && !self.shortage ? (
              <>
                <span class="text-[11px] text-mist">选缺门</span>
                {SHORTAGE_OPTIONS.map(suit => (
                  <button
                    key={suit}
                    type="button"
                    class="chip h-11 flex-1 rounded-xl text-[13px]"
                    onClick={() => act({ type: 'chooseShortage', seat: 0, suit })}
                  >
                    缺{suit}
                  </button>
                ))}
              </>
            ) : hand.phase === 'draw' && isMyTurn.value ? (
              <button
                type="button"
                class="tile-face tile-press h-12 flex-1 rounded-xl font-serif text-[14px] tracking-[0.24em] text-ink"
                onClick={() => act({ type: 'draw', seat: 0 })}
              >
                摸牌
              </button>
            ) : isOver ? (
              <>
                <button
                  type="button"
                  class="tile-face tile-press h-12 flex-1 rounded-xl font-serif text-[14px] tracking-[0.24em] text-ink"
                  onClick={start}
                >
                  再来一把
                </button>
                <button type="button" class="chip h-12 rounded-xl px-4 text-[13px]" onClick={quit}>
                  退出
                </button>
              </>
            ) : (
              <>
                <span class="flex-1 text-[11px] text-mist">
                  {isMyTurn.value ? '选一张打出去' : `${SEAT_NAMES[actor ?? 0]}在出牌…`}
                </span>
                <button type="button" class="chip h-11 rounded-xl px-4 text-[12px]" onClick={quit}>
                  退出
                </button>
              </>
            )}
          </div>
        </div>
      )
    }
  }
})

export default TablePage
