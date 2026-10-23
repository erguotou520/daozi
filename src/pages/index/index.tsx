import { computed, defineComponent, onUnmounted, ref, watchEffect } from 'vue'
import { useTitle } from '@/hooks'
import {
  applyAction,
  chooseAIAction,
  daLiaoCheWarning,
  forbiddenDiscardsFor,
  isTenpaiHand,
  legalActions,
  playableDiscards,
  remainingTiles,
  revealHandTiles,
  settleHand,
  shortageTiles,
  wallVisualOf,
  type HandSettlement,
  type HandState,
  type RoundAction
} from '@/game/game'
import { ROUNDS_PER_CIRCLE, dealTrace, seatFromDice } from '@/game/table'
import { STARTING_POINTS, createMatch, endHand, startHand, type MatchState } from '@/game/match'
import { tileOrder, type NumberSuit, type Tile } from '@/game/score'
import TileView, { WallLine } from './components/TileView'
import { Dice, DiscardLane, MeldRack, OpponentSeat } from './components/TableParts'

const SEAT_NAMES = ['自己', '下家', '对面', '上家']
const SHORTAGE_OPTIONS: NumberSuit[] = ['万', '筒', '条']
const STACKS = 17

/** 地址栏加 ?fast=1 把所有思考时间压到 12%，自动跑测试时用 */
const PACE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('fast') ? 0.12 : 1

type TablePhase = 'idle' | 'rolling' | 'dealing' | 'playing' | 'round-over'

/** 四局调圈的结果（只在第 4、8…局结束时出现） */
interface CircleSummary {
  diceA: number
  diceB: number
  /** 掷骰的人：最后成牌的人 */
  rollerSeat: number
  /** 位置不动的那家（换座后的座位号） */
  fixedSeat: number
}

/** 一局打完的总账 */
interface RoundSummary {
  roundIndex: number
  hands: number
  /** 本局各家输赢（元） */
  money: number[]
  /** 局末各家剩余点数（有人为 0） */
  points: number[]
  /** 跨局累计（元）；调圈前的结果，账目仍按这一局坐的位置显示 */
  total: number[]
  /** 四局调圈：谁掷的骰、谁位置不动 */
  circle?: CircleSummary
}

const money = (value: number) => `${value > 0 ? '+' : ''}${Number(value.toFixed(1))}`

const TablePage = defineComponent({
  name: 'TablePage',
  setup() {
    useTitle('和县刀子')

    /** 局：50 点一局，打完再算钱 */
    const board = ref<MatchState | null>(null)
    /** 当前这把 */
    const state = ref<HandState | null>(null)
    /** 自摸成牌后玩家选择「打」，先收起成牌提示 */
    const declinedWin = ref(false)
    const phase = ref<TablePhase>('idle')
    const dice = ref<{ a: number; b: number } | null>(null)
    const shownDice = ref<{ a: number; b: number }>({ a: 1, b: 1 })
    /** 发牌进度：已经发出去多少张 */
    const dealProgress = ref(0)
    /** 已经抓走的牌墙格子，键是 `座位-墩-层` */
    const consumedKeys = ref<string[]>([])
    /** 每家已经拿到多少张（发牌动画用） */
    const dealtCounts = ref<number[]>([0, 0, 0, 0])
    /** 一局结束的总账，等玩家点「开下一局」 */
    const roundSummary = ref<RoundSummary | null>(null)

    let timer: number | undefined
    let spinTimer: number | undefined
    let dealTimer: number | undefined

    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = undefined
    }

    const clearDeal = () => {
      if (spinTimer !== undefined) window.clearInterval(spinTimer)
      if (dealTimer !== undefined) window.clearTimeout(dealTimer)
      spinTimer = undefined
      dealTimer = undefined
    }

    const currentActor = (hand: HandState): number | null => {
      if (hand.phase === 'over') return null
      if (hand.phase === 'claim') return hand.pendingClaims[0] ?? null
      if (hand.phase === 'rob-kong') return hand.robKong?.pending[0] ?? null
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
            schedule(240 * PACE)
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

    // AI 出牌节奏：慢一点，别人才看得清这家打了什么
    const schedule = (delay = (900 + Math.random() * 900) * PACE) => {
      clearTimer()
      timer = window.setTimeout(tick, delay)
    }

    const act = (action: RoundAction, delay = 420 * PACE) => {
      const hand = state.value
      if (!hand) return
      if (action.type !== 'discard') declinedWin.value = false
      try {
        state.value = applyAction(hand, action)
      } catch {
        return
      }
      schedule(delay)
    }

    /* ---------------- 掷骰 → 发牌 ---------------- */

    const beginDealing = (hand: HandState) => {
      // 逐张的抓牌顺序：谁抓、从自己那面墙的第几墩第几层，都和引擎里的发牌完全一致
      const trace = dealTrace(hand.dealerSeat, hand.wallSeat, hand.breakStacks)
      let index = 0
      phase.value = 'dealing'
      dealProgress.value = 0
      consumedKeys.value = []
      dealtCounts.value = [0, 0, 0, 0]

      const step = () => {
        if (index >= trace.length) {
          phase.value = 'playing'
          schedule(320 * PACE)
          return
        }
        const item = trace[index]
        index += 1
        dealProgress.value += 1
        consumedKeys.value = [...consumedKeys.value, `${item.from}-${item.col}-${item.layer}`]
        dealtCounts.value = dealtCounts.value.map((n, seat) => (seat === item.seat ? n + 1 : n))
        // 4 张一把抓得快，跳牌/补张慢一点，能看清墙上留的缺口
        const pause = item.bulk ? (index % 4 === 0 ? 150 : 48) : 190
        dealTimer = window.setTimeout(step, pause)
      }
      step()
    }

    /** 掷骰子 + 发牌，开下一把 */
    const rollAndDeal = () => {
      clearTimer()
      clearDeal()
      phase.value = 'rolling'
      dice.value = null
      state.value = null
      dealProgress.value = 0
      consumedKeys.value = []
      dealtCounts.value = [0, 0, 0, 0]

      // 骰子在桌面中间颠，点数是滚动的
      spinTimer = window.setInterval(() => {
        shownDice.value = { a: 1 + Math.floor(Math.random() * 6), b: 1 + Math.floor(Math.random() * 6) }
      }, 70)

      window.setTimeout(() => {
        if (spinTimer !== undefined) window.clearInterval(spinTimer)
        spinTimer = undefined
        const a = 1 + Math.floor(Math.random() * 6)
        const b = 1 + Math.floor(Math.random() * 6)
        shownDice.value = { a, b }
        dice.value = { a, b }

        let match = board.value ?? createMatch({ rollerSeat: 0 })
        // 上一把还没结账（正常不会发生），先同步最新状态再结掉
        if (match.current) match = endHand({ ...match, current: state.value ?? match.current }, { rotate: false })
        const next = startHand(match, a, b)
        board.value = next
        const hand = next.current as HandState
        state.value = hand
        beginDealing(hand)
      }, 950)
    }

    const start = () => {
      declinedWin.value = false
      roundSummary.value = null
      rollAndDeal()
    }

    /** 本把结束：记点数、算钱，接着开下一把或收局 */
    const closeHand = () => {
      const match = board.value
      const hand = state.value
      // current 已经清掉说明这把结过账了——别让连点把同一把算两遍
      if (!match || !hand || !match.current) return
      const settlement = settleHand(hand)
      const roundIndex = match.roundIndex
      const hands = match.hands + 1
      const roundMoney = match.money.map((value, seat) => value + (settlement?.moneyDelta[seat] ?? 0))
      const finalPoints = hand.players.map((player, seat) => player.points + (settlement?.pointDelta[seat] ?? 0))

      // 四局调圈：第 4、8…局结束时，由最后成牌的人掷骰子。点数按 5=自己、6=下家、
      // 7=对面、8=上家 指向的那家位置不动，其余三家按顺时针换位。
      // 单机里自己会被转回 0 号位，所以看到的是三家电脑换位置、账目跟着人走。
      const circleNeeded = !!settlement && settlement.gameOver && match.roundIndex % ROUNDS_PER_CIRCLE === 0
      const circleDice = circleNeeded
        ? { a: 1 + Math.floor(Math.random() * 6), b: 1 + Math.floor(Math.random() * 6) }
        : null

      // 引擎每一步都返回新的 HandState，先把最新这把同步回局里再结账，
      // 否则 endHand 拿到的是发牌那一瞬间的旧对象（没有赢家），点数永远累不起来。
      const closed = endHand(
        { ...match, current: hand },
        circleDice ? { circleDiceSum: circleDice.a + circleDice.b } : { rotate: false }
      )
      board.value = closed

      // 有人点数被付完 → 这一局结束，先把总账摆出来
      if (settlement && settlement.gameOver) {
        const circle: CircleSummary | undefined =
          circleDice && settlement.winnerSeat >= 0
            ? {
                diceA: circleDice.a,
                diceB: circleDice.b,
                rollerSeat: settlement.winnerSeat,
                // 点数指向的那家（换座前看到的座位名）：换座时他家不动
                fixedSeat: seatFromDice(settlement.winnerSeat, circleDice.a + circleDice.b)
              }
            : undefined
        roundSummary.value = {
          roundIndex,
          hands,
          money: roundMoney,
          points: finalPoints,
          // 调圈前结账：累计按这一局坐的位置显示，换过来的账目带到下一局
          total: match.totalMoney.map((value, seat) => value + roundMoney[seat]),
          circle
        }
        phase.value = 'round-over'
        return
      }
      rollAndDeal()
    }

    const quit = () => {
      declinedWin.value = false
      clearTimer()
      clearDeal()
      state.value = null
      board.value = null
      phase.value = 'idle'
      dice.value = null
      dealProgress.value = 0
      consumedKeys.value = []
      dealtCounts.value = [0, 0, 0, 0]
      roundSummary.value = null
    }

    /* ---------------- 牌桌尺寸 ---------------- */

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
      // 桌沿和投影要有地方落：四周先留一圈空白，别顶死到窗口边上
      const margin = Math.round(Math.min(width, height) * 0.024)
      const availW = width - margin * 2
      const availH = height - margin * 2
      // 牌桌别拉成一条：接近真实牌桌的横宽比，竖屏也不占满整屏
      const boardWidth = Math.min(availW, Math.round(availH * 1.16))
      const boardHeight = Math.min(availH, Math.round(boardWidth * 1.5))
      // 手牌一行 14 张（加上间隙）要放得下，所以按 0.93 个基准宽算
      const base = Math.min(boardWidth / 0.93, boardHeight / 0.98)
      // 左右两家自己占掉一条，牌墙就贴着他们往里放；上下两面居中，四角自然空出来
      const sideSeat = base * 0.088
      const ringW = Math.round(Math.min(boardWidth - sideSeat * 2, boardHeight * 1.04))
      // 纵向 0.74 是操作条卡住的上限：再高牌墙就压到「摸牌 / 定缺」那一行了
      const ringH = Math.round(boardHeight * 0.74)
      surface.style.width = `${Math.round(boardWidth)}px`
      surface.style.height = `${boardHeight}px`
      surface.style.setProperty('--bw', `${Math.round(base)}px`)
      surface.style.setProperty('--ring-w', `${ringW}px`)
      surface.style.setProperty('--ring-h', `${ringH}px`)
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
      clearDeal()
      observer?.disconnect()
    })

    /* ---------------- 牌墙 ---------------- */

    /** 一面空墙：17 墩 × [上层, 下层] */
    const emptyVisual = (): Array<Array<[boolean, boolean]>> =>
      [0, 1, 2, 3].map(() => Array.from({ length: STACKS }, () => [false, false] as [boolean, boolean]))

    /**
     * 牌墙画什么：
     * - 打牌 / 收局阶段以引擎的牌墙为准（含杠后从牌尾补牌）；
     * - 掷骰 / 发牌阶段从整圈满墙开始，抓一张就少一格——每家只抓自己面前那面，
     *   所以四面墙是一起变短的，不会只剩两边。
     *
     * **不做压缩**：17 墩的格子全部按原位渲染，抓空的格子就是桌面。墙从抓牌的
     * 那一头越变越短，牌不会自己滑过去补位；留墩在牌尾（远端）自然最后才轮到，
     * 所以墙上从头到尾都不会出现中段空档。单墩（上层先被抓走）只露下层，
     * 出现在墙条抓牌的那一端，是自然的消耗前沿。
     */
    const wallVisual = computed(() => {
      const hand = state.value
      if (hand && (phase.value === 'playing' || phase.value === 'round-over')) {
        return [0, 1, 2, 3].map(seat => wallVisualOf(hand, seat))
      }
      const visual = emptyVisual()
      const used = new Set(consumedKeys.value)
      for (let seat = 0; seat < 4; seat += 1) {
        for (let col = 0; col < STACKS; col += 1) {
          for (let layer = 0; layer < 2; layer += 1) {
            if (!used.has(`${seat}-${col}-${layer}`)) visual[seat][col][layer] = true
          }
        }
      }
      return visual
    })

    /* ---------------- 我的操作 ---------------- */

    const me = computed(() => state.value?.players[0] ?? null)
    const isMyTurn = computed(() => {
      const hand = state.value
      if (!hand || hand.phase === 'over') return false
      return currentActor(hand) === 0
    })

    const myActions = computed(() => (state.value && isMyTurn.value ? legalActions(state.value, 0) : []))
    const myClaims = computed(() =>
      myActions.value.filter(action => action.type === 'claim' || action.type === 'pass' || (action.type === 'win' && action.robKong))
    )
    const myWin = computed(() =>
      myActions.value.find((action): action is Extract<RoundAction, { type: 'win' }> => action.type === 'win')
    )
    const myKongs = computed(() =>
      myActions.value.filter((action): action is Extract<RoundAction, { type: 'kong' }> => action.type === 'kong')
    )

    const playable = computed(() => {
      const hand = state.value
      return new Set(hand ? playableDiscards(hand, 0) : [])
    })
    const forbidden = computed(() => {
      const hand = state.value
      return new Set(hand ? forbiddenDiscardsFor(hand, 0) : [])
    })
    const banWarning = computed(() => {
      const hand = state.value
      return hand && hand.phase !== 'over' ? daLiaoCheWarning(hand, 0) : null
    })

    /** 手里还有缺门牌时，只有缺门牌能打——这些牌要高亮 */
    const mustPlayShortage = computed(() => {
      const hand = state.value
      return hand ? shortageTiles(hand.players[0]).length > 0 : false
    })

    /** 只有轮到自己、且正在打牌阶段，drawnTile 才是「我摸的那张」 */
    const myDrawn = computed(() => {
      const hand = state.value
      if (!hand || hand.phase !== 'discard' || hand.turn !== 0) return null
      return hand.drawnTile
    })

    /** 成牌后亮牌：按牌序排好，成牌张单独放在最右（自摸/接牌都补进来） */
    const revealTiles = (seat: number): Tile[] => {
      const hand = state.value
      return hand ? revealHandTiles(hand, seat) : []
    }

    /** 手牌：排序后把刚摸到的那张单独放到最右，跟手牌区隔开 */
    const handTiles = computed(() => {
      const hand = state.value
      if (!hand) return [] as Tile[]
      if (hand.phase === 'over') return revealTiles(0)
      const drawn = myDrawn.value
      const tiles = [...hand.players[0].hand]
      if (drawn) {
        const index = tiles.indexOf(drawn)
        if (index >= 0) tiles.splice(index, 1)
      }
      tiles.sort(tileOrder)
      return drawn ? [...tiles, drawn] : tiles
    })

    /** 发牌动画期间只露出已经发到手的张数 */
    const seatTiles = (seat: number): Tile[] => {
      const hand = state.value
      if (!hand) return []
      if (phase.value === 'dealing') return hand.players[seat].hand.slice(0, dealtCounts.value[seat] ?? 0)
      if ((hand.phase === 'over' && hand.winner?.seat === seat) || hand.threeToOneSeat === seat) return revealTiles(seat)
      return hand.players[seat].hand
    }

    const settlement = computed<HandSettlement | null>(() => {
      const hand = state.value
      if (!hand || hand.phase !== 'over' || !hand.winner) return null
      return settleHand(hand)
    })

    /** 这家现在还剩多少点（结算后按变化量算） */
    const seatPoints = (seat: number): number => {
      const hand = state.value
      if (!hand) return STARTING_POINTS
      const base = hand.players[seat].points
      const result = settlement.value
      return base + (result ? result.pointDelta[seat] : 0)
    }

    /** 东家首巡手里已经是 3n+2 张，不用再摸 */
    const needDraw = computed(() => {
      const hand = state.value
      if (!hand) return false
      return hand.players[0].hand.length % 3 !== 2
    })

    /** 三打一的明牌家是否听牌：红色「听」标记 */
    const threeToOneTenpai = computed(() => {
      const hand = state.value
      const seat = hand?.threeToOneSeat
      if (!hand || seat == null) return false
      return isTenpaiHand(hand.players[seat])
    })

    return () => {
      const hand = state.value
      const match = board.value
      const playing = (phase.value === 'playing' || phase.value === 'round-over') && !!hand
      const winnerSeat = hand?.winner?.seat ?? -1
      const actor = hand ? currentActor(hand) : null
      const isOver = hand?.phase === 'over'
      const win = hand?.winner ?? null
      const result = settlement.value
      const self = hand?.players[0] ?? null
      const wall = wallVisual.value
      const rolling = phase.value === 'rolling'

      const myHand = phase.value === 'dealing' ? seatTiles(0) : handTiles.value
      const summary = roundSummary.value

      return (
        <div class="flex min-h-0 flex-1 flex-col px-1 pb-1 pt-1">
          <div ref={wrapRef} class="flex min-h-0 flex-1 items-center justify-center">
            <div ref={surfaceRef} class="table-surface shrink-0">
              {/* ---------------- 中央方阵：牌墙 → 牌河 → 面板 ---------------- */}
              <div
                class="absolute left-1/2 top-1/2 z-10"
                style={{ width: 'var(--ring-w)', height: 'var(--ring-h)', transform: 'translate(-50%, -50%)' }}
              >
                {/* 牌墙四面（上下两面压住左右两面的角，围成一圈）。
                    抓牌是**顺时针**：自己这面墙从右往左抓，接左手边那面、对面、右手边。
                    所以每面墙的墩号 16 都摆在「上家那头的角」上，抓牌从这一端开始消耗 */}
                <div class="absolute left-1/2 top-0 z-[3]" style={{ transform: 'translateX(-50%)' }}>
                  <WallLine stacks={[...wall[2]].reverse()} />
                </div>
                <div class="absolute bottom-0 left-1/2 z-[3]" style={{ transform: 'translateX(-50%)' }}>
                  <WallLine stacks={wall[0]} />
                </div>
                <div class="absolute left-0 top-1/2 z-[2]" style={{ transform: 'translateY(-50%)' }}>
                  <WallLine flat flip stacks={wall[3]} />
                </div>
                <div class="absolute right-0 top-1/2 z-[2]" style={{ transform: 'translateY(-50%)' }}>
                  <WallLine flat stacks={[...wall[1]].reverse()} />
                </div>

                {/* 牌河：贴着墙内侧一圈 */}
                <div
                  class="absolute left-1/2 z-[1] flex justify-center"
                  style={{ top: 'var(--lane-inset)', width: 'var(--lane-len-x)', transform: 'translateX(-50%)' }}
                >
                  <DiscardLane
                    bounds
                    discards={hand?.players[2].discards ?? []}
                    markLast={hand?.lastPlayed?.seat === 2}
                    seq={hand?.logs.length ?? 0}
                  />
                </div>
                <div
                  class="absolute left-1/2 z-[1] flex justify-center"
                  style={{ bottom: 'var(--lane-inset)', width: 'var(--lane-len-x)', transform: 'translateX(-50%)' }}
                >
                  <DiscardLane
                    bounds
                    wrapReverse
                    discards={self?.discards ?? []}
                    markLast={hand?.lastPlayed?.seat === 0}
                    seq={hand?.logs.length ?? 0}
                  />
                </div>
                <div
                  class="absolute top-1/2 z-[1] flex items-center"
                  style={{ left: 'var(--lane-inset)', height: 'var(--lane-len-y)', transform: 'translateY(-50%)' }}
                >
                  <DiscardLane
                    bounds
                    vertical
                    rotate={90}
                    discards={hand?.players[3].discards ?? []}
                    markLast={hand?.lastPlayed?.seat === 3}
                    seq={hand?.logs.length ?? 0}
                  />
                </div>
                <div
                  class="absolute top-1/2 z-[1] flex items-center"
                  style={{ right: 'var(--lane-inset)', height: 'var(--lane-len-y)', transform: 'translateY(-50%)' }}
                >
                  <DiscardLane
                    bounds
                    vertical
                    wrapReverse
                    rotate={-90}
                    discards={hand?.players[1].discards ?? []}
                    markLast={hand?.lastPlayed?.seat === 1}
                    seq={hand?.logs.length ?? 0}
                  />
                </div>

                {/* 中央面板 */}
                <div
                  class="absolute left-1/2 top-1/2 z-10 flex flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-center"
                  style={{
                    transform: 'translate(-50%, -50%)',
                    display: isOver ? 'none' : undefined,
                    width: 'max(9rem, calc(var(--ring-h) * 0.46))',
                    maxHeight: 'calc(var(--ring-h) * 0.9)',
                    overflowY: 'auto',
                    background: 'rgba(7, 28, 23, 0.66)',
                    border: '1px solid rgba(217, 180, 95, 0.26)',
                    boxShadow: 'inset 0 0 24px rgba(0, 0, 0, 0.4), 0 6px 16px rgba(0, 0, 0, 0.35)'
                  }}
                >
                  {/* 骰子：掷完就缩小让位，点数已经不重要了 */}
                  <div class="flex items-center gap-1.5">
                    <Dice value={shownDice.value.a} rolling={rolling} size={rolling ? 'calc(var(--ring-h) * 0.105)' : 'calc(var(--ring-h) * 0.042)'} />
                    <Dice value={shownDice.value.b} rolling={rolling} size={rolling ? 'calc(var(--ring-h) * 0.105)' : 'calc(var(--ring-h) * 0.042)'} />
                    {!rolling && dice.value && (
                      <span class="font-serif text-[12px] leading-none text-brass">{dice.value.a + dice.value.b} 点</span>
                    )}
                  </div>

                  {/* 局/把：放在中央面板里，窄屏也不会跟座位标签打架 */}
                  {match && (
                    <div class="text-[11px] leading-4 text-mist">
                      第 <span class="text-ivory">{match.roundIndex}</span> 局 · 第{' '}
                      <span class="text-ivory">{match.hands + 1}</span> 把
                      {hand?.isFirstHand && <span class="ml-1 text-brass">首牌</span>}
                    </div>
                  )}

                  <div class="text-[11px] leading-4 text-mist">
                    {rolling
                      ? '掷骰…'
                      : phase.value === 'dealing'
                        ? `发牌 ${dealProgress.value}/53`
                        : hand
                          ? `牌山 ${remainingTiles(hand)}`
                          : '牌山 136'}
                  </div>

                  {phase.value === 'dealing' && dice.value && (
                    <div class="text-[11px] leading-4 text-brass">
                      {dice.value.a}+{dice.value.b}={dice.value.a + dice.value.b} · 开牌 {SEAT_NAMES[hand?.wallSeat ?? 0]}
                    </div>
                  )}

                  {playing && (
                    <div class="font-serif text-[15px] leading-5 tracking-[0.08em] text-ivory">
                      {isOver
                        ? hand!.result === 'exhausted'
                          ? '本把流局'
                          : `${SEAT_NAMES[winnerSeat]}成牌`
                        : hand!.phase === 'choose-shortage'
                          ? '选缺门'
                          : isMyTurn.value
                            ? '轮到你'
                            : `轮到${SEAT_NAMES[actor ?? 0]}`}
                    </div>
                  )}

                  {playing && hand?.threeToOneSeat != null && !isOver && (
                    <div class="flex items-center gap-1 text-[11px] leading-4 text-brass">
                      <span>
                        三打一 · {hand.threeToOneSeat === 0 ? '你' : SEAT_NAMES[hand.threeToOneSeat]}亮
                        {hand.threeToOneSuit ?? '牌'}
                      </span>
                      {threeToOneTenpai.value && (
                        <span class="rounded-[3px] border border-[#B03A26] bg-[#F7EEDA] px-1 text-[10px] font-bold leading-4 text-[#B03A26]">
                          听
                        </span>
                      )}
                    </div>
                  )}

                  {playing && !isOver && banWarning.value && (
                    <div class="max-w-[calc(var(--ring-h)*0.62)] break-words text-[10px] leading-4 text-vermillion">
                      {banWarning.value}
                    </div>
                  )}

                  {playing && hand?.lastPlayed && (
                    <div class="flex items-center gap-1 text-[11px] leading-none text-mist">
                      <span>刚打</span>
                      <TileView tile={hand.lastPlayed.tile} size="seat" marked />
                      <span>{SEAT_NAMES[hand.lastPlayed.seat]}</span>
                    </div>
                  )}

                  {/* 接牌按钮 */}
                  {playing && (hand?.phase === 'claim' || hand?.phase === 'rob-kong') && isMyTurn.value && (
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
                        if (action.type === 'win' && action.robKong) {
                          return (
                            <button
                              key="rob-kong-win"
                              type="button"
                              class="tile-face-sm tile-press claim-in rounded-lg px-3 py-1 font-serif text-[12px] text-ink"
                              onClick={() => act(action)}
                            >
                              成
                            </button>
                          )
                        }
                        return null
                      })}
                    </div>
                  )}

                  {/* 自摸成牌 / 自家杠 */}
                  {playing && hand?.phase === 'discard' && isMyTurn.value && (myWin.value || myKongs.value.length > 0) && (
                    <div class="mt-0.5 flex flex-wrap justify-center gap-1">
                      {myWin.value && !declinedWin.value ? (
                        <>
                          <button
                            type="button"
                            class="tile-face-sm tile-press claim-in rounded-lg px-3 py-1 font-serif text-[13px] text-ink"
                            onClick={() => act(myWin.value!)}
                          >
                            成
                          </button>
                          <button
                            type="button"
                            class="chip tile-press claim-in rounded-lg px-3 py-1 font-serif text-[12px]"
                            onClick={() => {
                              declinedWin.value = true
                            }}
                          >
                            打
                          </button>
                        </>
                      ) : (
                        myKongs.value.map(action => (
                          <button
                            key={`${action.kind}-${action.tile}`}
                            type="button"
                            class="chip tile-press claim-in rounded-lg px-2.5 py-1 font-serif text-[12px]"
                            onClick={() => act(action)}
                          >
                            杠{action.tile}
                          </button>
                        ))
                      )}
                    </div>
                  )}

                </div>

                {/* 本把结算：单独一张牌摊在桌心，字够大，也不跟牌河挤在一起 */}
                {playing && isOver && (
                  <div
                    class="absolute left-1/2 top-1/2 z-20"
                    style={{
                      transform: 'translate(-50%, -50%)',
                      width: 'max(14rem, calc(var(--ring-h) * 0.62))'
                    }}
                  >
                    <div
                      class="settle-in"
                      style={{
                        maxHeight: 'calc(var(--ring-h) * 0.78)',
                        overflowY: 'auto',
                        borderRadius: '0.9rem',
                        background: 'linear-gradient(180deg, rgba(16, 58, 46, 0.96) 0%, rgba(7, 28, 23, 0.97) 100%)',
                        border: '1px solid rgba(217, 180, 95, 0.34)',
                        boxShadow: '0 14px 32px rgba(0, 0, 0, 0.52), inset 0 0 30px rgba(0, 0, 0, 0.32)'
                      }}
                    >
                    {/* 结算是哪一局哪一把：局数一直往上加，把数每局从 1 数起 */}
                    {match && (
                      <div class="px-3 pt-2 text-[10px] leading-4 text-mist">
                        第 <span class="text-ivory">{match.roundIndex}</span> 局 · 第{' '}
                        <span class="text-ivory">{match.hands + 1}</span> 把
                      </div>
                    )}
                    {win ? (
                      <>
                        <div class="flex items-baseline gap-2 px-3 pt-1.5">
                          <span class="font-serif text-[15px] text-ivory">{SEAT_NAMES[winnerSeat]}</span>
                          <span class="text-[11px] text-mist">{win.selfDraw ? '自摸' : '接牌'}</span>
                          {hand!.isFirstHand && <span class="text-[10px] text-mist">首牌</span>}
                          <span class="ml-auto flex items-baseline gap-1">
                            <span class="font-serif text-[30px] leading-none text-brass">{win.score.points.total}</span>
                            <span class="text-[12px] text-mist">点</span>
                          </span>
                        </div>

                        <div class="mt-1.5 flex flex-wrap items-center gap-1 px-3">
                          {win.score.bigWin.isBigWin && (
                            <span class="rounded-[3px] bg-vermillion px-1.5 text-[11px] leading-5 text-ivory">大拿</span>
                          )}
                          {hand!.isFirstHand && win.score.bigWin.isBigWin && (
                            <span class="rounded-[3px] bg-brass px-1.5 text-[11px] leading-5 text-ink">清水</span>
                          )}
                          {win.score.points.items.some(item => item.name === '杠开') && (
                            <span class="rounded-[3px] bg-brass px-1.5 text-[11px] leading-5 text-ink">杠后赛花</span>
                          )}
                          {/* 本局没结束时只结算点数，不显示要付多少钱；点数付完（本局结束）才亮金额 */}
                          {result?.gameOver ? (
                            <span class="ml-auto text-[12px] text-brass">
                              {win.score.money.perOpponentTotal} 元/家 · 合计 {win.score.money.total} 元
                            </span>
                          ) : (
                            <span class="ml-auto text-[11px] text-mist">本局未结束 · 只结算点数</span>
                          )}
                        </div>

                        {/* 摸子：只要有就显示；本局没结束时先不折成钱 */}
                        {win.score.mozi.units > 0 && (
                          <div class="mt-1 px-3 text-[11px] leading-5 text-brass">
                            摸子 {win.score.mozi.big} 大 + {win.score.mozi.small} 小
                            {result?.gameOver ? ` · ${win.score.mozi.money} 元/家` : ''}
                          </div>
                        )}

                        {/* 四家点数变化 */}
                        <div class="mt-2 grid grid-cols-4 gap-1 px-3">
                          {[0, 1, 2, 3].map(seat => {
                            const delta = result?.pointDelta[seat] ?? 0
                            return (
                              <div key={seat} class="rounded-[5px] px-1 py-1 text-center" style={{ background: 'rgba(0, 0, 0, 0.24)' }}>
                                <div class="text-[10px] leading-4 text-mist">{SEAT_NAMES[seat]}</div>
                                <div class={['text-[15px] leading-5', delta > 0 ? 'text-brass' : delta < 0 ? 'text-[#e08a72]' : 'text-ivory'].join(' ')}>
                                  {seatPoints(seat)}
                                </div>
                                <div class="text-[10px] leading-4 text-mist">{delta === 0 ? '持平' : `${money(delta)} 点`}</div>
                              </div>
                            )
                          })}
                        </div>

                        <div class="mt-2 space-y-0.5 px-3 pb-2.5 text-[12px] leading-5 text-mist">
                          {win.score.details
                            .filter(line => result?.gameOver || !/元|应付/.test(line))
                            .map((line, index) => (
                              <div key={index}>{line}</div>
                            ))}
                        </div>
                      </>
                    ) : (
                      <div class="px-3 py-3 text-center text-[13px] text-mist">牌山摸完，本把不算输赢。</div>
                    )}
                    </div>
                  </div>
                )}
              </div>

              {/* ---------------- 四家 ---------------- */}

              {/* 对面：贴上桌边 */}
              <div class="absolute left-1/2 top-1 z-20" style={{ transform: 'translateX(-50%)' }}>
                <OpponentSeat
                  player={hand?.players[2] ?? null}
                  tiles={seatTiles(2)}
                  name={SEAT_NAMES[2]}
                  side="top"
                  points={playing ? seatPoints(2) : STARTING_POINTS}
                  active={playing && actor === 2}
                  dealer={hand?.dealerSeat === 2}
                  reveal={isOver && winnerSeat === 2}
                  open={hand?.threeToOneSeat === 2}
                  openSuit={hand?.threeToOneSeat === 2 ? hand.threeToOneSuit : null}
                  listen={threeToOneTenpai.value && hand?.threeToOneSeat === 2}
                  dealing={phase.value === 'dealing'}
                />
              </div>

              {/* 上家：贴左桌边 */}
              <div class="absolute left-1 top-1/2 z-20" style={{ transform: 'translateY(-50%)' }}>
                <OpponentSeat
                  player={hand?.players[3] ?? null}
                  tiles={seatTiles(3)}
                  name={SEAT_NAMES[3]}
                  side="left"
                  points={playing ? seatPoints(3) : STARTING_POINTS}
                  active={playing && actor === 3}
                  dealer={hand?.dealerSeat === 3}
                  reveal={isOver && winnerSeat === 3}
                  open={hand?.threeToOneSeat === 3}
                  openSuit={hand?.threeToOneSeat === 3 ? hand.threeToOneSuit : null}
                  listen={threeToOneTenpai.value && hand?.threeToOneSeat === 3}
                  dealing={phase.value === 'dealing'}
                />
              </div>

              {/* 下家：贴右桌边 */}
              <div class="absolute right-1 top-1/2 z-20" style={{ transform: 'translateY(-50%)' }}>
                <OpponentSeat
                  player={hand?.players[1] ?? null}
                  tiles={seatTiles(1)}
                  name={SEAT_NAMES[1]}
                  side="right"
                  points={playing ? seatPoints(1) : STARTING_POINTS}
                  active={playing && actor === 1}
                  dealer={hand?.dealerSeat === 1}
                  reveal={isOver && winnerSeat === 1}
                  open={hand?.threeToOneSeat === 1}
                  openSuit={hand?.threeToOneSeat === 1 ? hand.threeToOneSuit : null}
                  listen={threeToOneTenpai.value && hand?.threeToOneSeat === 1}
                  dealing={phase.value === 'dealing'}
                />
              </div>

              {/* 自己：手牌贴下桌边，副露在右手侧 */}
              {hand && (
                <div
                  class="absolute bottom-1 left-1/2 z-20 flex items-end justify-center gap-3"
                  style={{ transform: 'translateX(-50%)' }}
                >
                  <div class="relative flex">
                    {threeToOneTenpai.value && hand.threeToOneSeat === 0 && (
                      <span class="absolute -top-6 left-0 z-10 rounded-[3px] border border-[#B03A26] bg-[#F7EEDA] px-1.5 py-0.5 text-[12px] font-bold leading-none text-[#B03A26] shadow">
                        听
                      </span>
                    )}
                    {myHand.map((tile, index) => {
                      const isDrawn = !!myDrawn.value && index === myHand.length - 1
                      const canPlay =
                        hand.phase === 'discard' &&
                        isMyTurn.value &&
                        playable.value.has(tile) &&
                        !(myWin.value && !declinedWin.value)
                      const isForbidden = forbidden.value.has(tile)
                      const mustPlay = canPlay && mustPlayShortage.value
                      return (
                        <button
                          key={isDrawn ? `drawn-${hand.logs.length}` : `${tile}-${index}`}
                          type="button"
                          disabled={!canPlay}
                          class={[
                            'hand-tile rounded-[4px]',
                            isDrawn ? 'is-drawn' : '',
                            canPlay ? '' : 'cursor-not-allowed',
                            !canPlay && hand.phase === 'discard' && isMyTurn.value ? 'opacity-40' : ''
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
                          <TileView
                            tile={tile}
                            size="hand"
                            enter={phase.value === 'dealing' ? index === myHand.length - 1 : isDrawn}
                          />
                        </button>
                      )
                    })}
                  </div>

                  {self && self.melds.length > 0 && <MeldRack melds={self.melds} />}
                </div>
              )}

              {/* 桌面操作条：状态 + 定缺 / 摸牌 / 下一把，浮在手牌上方的桌面上 */}
              <div
                class="absolute left-1/2 z-30"
                style={{
                  bottom: 'calc(var(--t-hand) * 1.37 + 11px)',
                  transform: 'translateX(-50%)'
                }}
              >
                <div class="action-dock">
                  {hand && (
                    <span class="whitespace-nowrap pl-1 text-[10px] leading-none text-mist">
                      <span class="text-ivory">{SEAT_NAMES[0]}</span>
                      {hand.dealerSeat === 0 && (
                        <span class="ml-1 rounded-[3px] bg-brass px-1 text-[9px] leading-4 text-ink">东</span>
                      )}
                      {self?.shortage && <span class="ml-1.5">缺{self.shortage}</span>}
                      {hand.threeToOneSeat === 0 && hand.threeToOneSuit && (
                        <span class="ml-1.5 text-brass">亮{hand.threeToOneSuit}</span>
                      )}
                      <span class="ml-1.5 text-brass">{playing ? seatPoints(0) : STARTING_POINTS} 点</span>
                      <span class="ml-1.5">
                        {phase.value === 'dealing' ? dealtCounts.value[0] : myHand.length} 张
                      </span>
                    </span>
                  )}

                  {phase.value === 'idle' && (
                    <button
                      type="button"
                      class="tile-face tile-press rounded-lg px-5 py-1.5 font-serif text-[13px] tracking-[0.2em] text-ink"
                      onClick={start}
                    >
                      掷骰子
                    </button>
                  )}

                  {rolling && <span class="px-3 py-1 text-[11px] text-mist">掷骰…</span>}

                  {phase.value === 'dealing' && (
                    <span class="px-3 py-1 text-[11px] text-mist">发牌 {dealProgress.value}/53</span>
                  )}

                  {playing && hand!.phase === 'choose-shortage' && !self?.shortage && (
                    <>
                      <span class="pl-1 text-[11px] text-mist">定缺</span>
                      {SHORTAGE_OPTIONS.map(suit => (
                        <button
                          key={suit}
                          type="button"
                          class="chip tile-press rounded-lg px-3 py-1.5 text-[12px]"
                          onClick={() => act({ type: 'chooseShortage', seat: 0, suit })}
                        >
                          缺{suit}
                        </button>
                      ))}
                    </>
                  )}

                  {playing && hand!.phase === 'draw' && isMyTurn.value && (
                    <button
                      type="button"
                      class="tile-face tile-press rounded-lg px-5 py-1.5 font-serif text-[13px] tracking-[0.2em] text-ink"
                      onClick={() => act({ type: 'draw', seat: 0 })}
                    >
                      {needDraw.value ? '摸牌' : '出牌'}
                    </button>
                  )}

                  {phase.value === 'playing' && isOver && (
                    <>
                      <button
                        type="button"
                        class="tile-face tile-press rounded-lg px-4 py-1.5 font-serif text-[13px] tracking-[0.16em] text-ink"
                        onClick={closeHand}
                      >
                        {result?.gameOver ? '本局结束' : '下一把'}
                      </button>
                      <button type="button" class="chip tile-press rounded-lg px-3 py-1.5 text-[12px]" onClick={quit}>
                        退出
                      </button>
                    </>
                  )}

                  {playing && !isOver && hand!.phase !== 'choose-shortage' && !(hand!.phase === 'draw' && isMyTurn.value) && (
                    <span class="px-3 py-1 text-[11px] text-mist">
                      {isMyTurn.value
                        ? myWin.value && !declinedWin.value
                          ? '成牌！选 成 / 打'
                          : myKongs.value.length
                            ? '可以杠，或点手牌打出'
                            : mustPlayShortage.value
                              ? '必须打缺门牌'
                              : '点手牌打出'
                        : `${SEAT_NAMES[actor ?? 0]}在出牌…`}
                    </span>
                  )}
                </div>
              </div>

              {/* 退出：桌面右上角 */}
              {playing && !isOver && (
                <button
                  type="button"
                  class="ghost-btn absolute right-2 top-2 z-30 rounded-full px-2.5 py-1 text-[10px]"
                  onClick={quit}
                >
                  退出
                </button>
              )}

              {/* ---------------- 一局打完的总账 ---------------- */}
              {phase.value === 'round-over' && summary && (
                <div
                  class="absolute inset-0 z-40 flex items-center justify-center px-3"
                  style={{ background: 'rgba(4, 18, 14, 0.88)' }}
                >
                  <div
                    class="settle-in w-full max-w-[24rem] rounded-2xl px-4 py-3"
                    style={{
                      background: 'linear-gradient(180deg, rgba(20, 64, 50, 0.98) 0%, rgba(7, 28, 23, 0.98) 100%)',
                      border: '1px solid rgba(217, 180, 95, 0.38)',
                      boxShadow: '0 18px 40px rgba(0, 0, 0, 0.55), inset 0 0 30px rgba(0, 0, 0, 0.35)'
                    }}
                  >
                    <div class="text-center">
                      <div class="font-serif text-[17px] tracking-[0.22em] text-brass">第 {summary.roundIndex} 局结束</div>
                      <div class="mt-0.5 text-[11px] text-mist">
                        共 {summary.hands} 把 · 有人点数付完
                      </div>
                      {summary.circle && (
                        <div class="mt-1.5 rounded-lg px-2 py-1 text-[11px] leading-4" style={{ background: 'rgba(0, 0, 0, 0.26)' }}>
                          <div class="flex items-center justify-center gap-1.5 text-brass">
                            <Dice value={summary.circle.diceA} size="16px" />
                            <Dice value={summary.circle.diceB} size="16px" />
                            <span>
                              四局调圈 · {SEAT_NAMES[summary.circle.rollerSeat]}掷骰 {summary.circle.diceA}+
                              {summary.circle.diceB}={summary.circle.diceA + summary.circle.diceB}
                            </span>
                          </div>
                          <div class="mt-0.5 text-mist">
                            {SEAT_NAMES[summary.circle.fixedSeat]}位置不动，其余三家按顺时针换位
                          </div>
                        </div>
                      )}
                    </div>

                    <div class="mt-2.5 space-y-1">
                      <div class="grid grid-cols-[1fr_auto_auto] gap-x-3 px-1 text-[10px] text-mist">
                        <span />
                        <span class="text-right">本局</span>
                        <span class="w-14 text-right">累计</span>
                      </div>
                      {[0, 1, 2, 3].map(seat => (
                        <div
                          key={seat}
                          class="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3 rounded-md px-1.5 py-1 text-[13px]"
                          style={{ background: 'rgba(0, 0, 0, 0.22)' }}
                        >
                          <span class="flex items-baseline gap-1.5">
                            <span class="text-ivory">{SEAT_NAMES[seat]}</span>
                            <span class="text-[11px] text-mist">{summary.points[seat]} 点</span>
                          </span>
                          <span
                            class={[
                              'text-right font-serif',
                              summary.money[seat] > 0 ? 'text-brass' : summary.money[seat] < 0 ? 'text-[#e08a72]' : 'text-mist'
                            ].join(' ')}
                          >
                            {money(summary.money[seat])}
                          </span>
                          <span class="w-14 text-right text-[11px] text-mist">{money(summary.total[seat])}</span>
                        </div>
                      ))}
                    </div>

                    <div class="mt-3 flex items-center justify-center gap-2">
                      <button
                        type="button"
                        class="tile-face tile-press rounded-lg px-5 py-1.5 font-serif text-[13px] tracking-[0.16em] text-ink"
                        onClick={start}
                      >
                        开第 {summary.roundIndex + 1} 局
                      </button>
                      <button type="button" class="chip tile-press rounded-lg px-3 py-1.5 text-[12px]" onClick={quit}>
                        退出
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )
    }
  }
})

export default TablePage
