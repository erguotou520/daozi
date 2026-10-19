/**
 * 倒子麻将 · 桌位与局数流程
 *
 * 负责：掷骰定东家/开牌墙、发牌顺序、每局头家轮转、四把调圈。
 * 纯函数、无依赖，可直接配合 `scoreHand` 搭对局状态机。
 */

export const SEAT_COUNT = 4

/** 打满几局后调圈 */
export const ROUNDS_PER_CIRCLE = 4

/* ------------------------------------------------------------------ *
 * 掷骰
 * ------------------------------------------------------------------ */

/**
 * 两颗骰子的和值 → 相对掷骰者的座位偏移。
 * 5=自己、6=下家、7=对面、8=上家，之后循环（9 又回到自己）。
 */
export function seatOffsetFromDice(sum: number): number {
  return (((sum - 5) % SEAT_COUNT) + SEAT_COUNT) % SEAT_COUNT
}

/** 骰子指向的绝对座位（相对于掷骰者） */
export function seatFromDice(rollerSeat: number, sum: number): number {
  return (rollerSeat + seatOffsetFromDice(sum)) % SEAT_COUNT
}

export interface OpeningRoll {
  diceA: number
  diceB: number
  sum: number
  /** 东家，同时也是头家 */
  dealerSeat: number
  /** 开牌墙：从这家门前开始抓牌 */
  wallSeat: number
  /** 留墩数：取两颗骰子里较小的点数 */
  breakStacks: number
}

/** 掷两颗骰子开局 */
export function rollOpening(rollerSeat: number, diceA: number, diceB: number): OpeningRoll {
  const sum = diceA + diceB
  const seat = seatFromDice(rollerSeat, sum)
  return {
    diceA,
    diceB,
    sum,
    dealerSeat: seat,
    wallSeat: seat,
    breakStacks: Math.min(diceA, diceB)
  }
}

/* ------------------------------------------------------------------ *
 * 发牌
 * ------------------------------------------------------------------ */

/** 发牌顺序：东家起，依次下家、对面、上家 */
export function dealOrder(dealerSeat: number): number[] {
  return Array.from({ length: SEAT_COUNT }, (_, index) => (dealerSeat + index) % SEAT_COUNT)
}

export interface DealStep {
  seat: number
  count: number
  /**
   * 抓牌前先跳过的牌数（庄家跳牌用，按「张」算）。
   * 被跳过的牌留在墙上，之后照常被摸到——所以墙上会留一个看得见的缺口。
   */
  skip?: number
}

/** 一面墙的墩数：17 墩 × 上下两层 */
export const STACKS_PER_SIDE = 17
/** 一面墙的牌数 */
export const TILES_PER_SIDE = STACKS_PER_SIDE * 2

/**
 * 发牌计划：谁、第几手拿几张。牌一律从同一条牌墙的墙头连续取。
 *
 * 1. 3 轮 × 每人 4 张（一次抓 2 摞），从东家起；
 * 2. 庄家跳牌：先抓 1 张，跳过下面那张、直接拿下一墩的上层（凑到 14 张）；
 * 3. 其余三家各补 1 张，凑到 13 张。
 *
 * 一共 53 张，从开牌墙那段开始一路抓下去，抓完这段接下一段——
 * 所以整圈牌墙只在「抓到哪儿」这一个地方变短，不是四面各缺一段。
 * 第 2 步跳过的那张留在墙上，之后摸牌摸到那里时才会被摸走。
 */
export function dealPlan(dealerSeat: number): DealStep[] {
  const order = dealOrder(dealerSeat)
  const steps: DealStep[] = []
  for (let round = 0; round < 3; round += 1) {
    for (const seat of order) steps.push({ seat, count: 4 })
  }
  steps.push({ seat: dealerSeat, count: 1 })
  // 跳牌：跳过这一墩的下层，直接拿下一墩的上层
  steps.push({ seat: dealerSeat, count: 1, skip: 1 })
  for (const seat of order.slice(1)) steps.push({ seat, count: 1 })
  return steps
}

/** 发牌动画的一帧：这张牌给谁、从哪面墙的第几墩第几层抓、这一手是「4 张一把」还是「单张」 */
export interface DealTraceItem {
  /** 这张牌进谁的手 */
  seat: number
  /** 这张牌原本在哪面墙上（牌墙是一条连续的牌，抓的人和墙不是一家） */
  from: number
  col: number
  layer: number
  bulk: boolean
}

/**
 * 把发牌计划摊成逐张的抓牌顺序，同时算出每张牌来自哪面墙的第几墩哪一层。
 *
 * 牌墙是**一条连续的牌**：从开牌墙那段（`wallSeat`）的墙头抓起，抓完接着
 * 下一段，顺时针绕一圈（自己 → 左手边 → 对面 → 右手边）。
 * 每段墙都是**从右往左**抓，所以第 g 张落在该段的第 `16 - floor(g / 2)` 墩、
 * 第 `g % 2` 层。开牌墙最右的 `breakStacks` 摞是留墩，挪到这段末尾最后才抓。
 * 庄家跳牌跳过的那张留在墙头，因此不会出现在 trace 里（后面摸牌才会摸到）。
 */
export function dealTrace(dealerSeat: number, wallSeat = 0, breakStacks = 0): DealTraceItem[] {
  // 整圈牌按抓牌顺序排好：开牌墙 → 左手边 → 对面 → 右手边（顺时针）
  const slots: Array<Omit<DealTraceItem, 'seat' | 'bulk'>> = []
  for (let side = 0; side < SEAT_COUNT; side += 1) {
    const from = (wallSeat - side + SEAT_COUNT) % SEAT_COUNT
    for (let index = 0; index < TILES_PER_SIDE; index += 1) {
      slots.push({ from, col: STACKS_PER_SIDE - 1 - Math.floor(index / 2), layer: index % 2 })
    }
  }
  // 留墩：开牌墙最右的几摞留在原地不动，抓牌从再往左一摞开始；
  // 它们要等整圈都抓完才轮到，所以排在**整条牌墙**的末尾（不是这一段的末尾）
  const kept = Math.min(breakStacks * 2, TILES_PER_SIDE - 2)
  if (kept > 0) {
    const opening = slots.slice(0, TILES_PER_SIDE)
    const rest = slots.slice(TILES_PER_SIDE)
    slots.length = 0
    slots.push(...opening.slice(kept), ...rest, ...opening.slice(0, kept))
  }
  const trace: DealTraceItem[] = []
  for (const step of dealPlan(dealerSeat)) {
    for (let index = 0; index < step.count; index += 1) {
      const skip = index === 0 ? (step.skip ?? 0) : 0
      const [item] = slots.splice(skip, 1)
      if (item) trace.push({ ...item, seat: step.seat, bulk: step.count === 4 })
    }
  }
  return trace
}

/** 本局该座位的手牌张数 */
export function handSize(seat: number, dealerSeat: number): number {
  return seat === dealerSeat ? 14 : 13
}

/* ------------------------------------------------------------------ *
 * 四把调圈
 * ------------------------------------------------------------------ */

/**
 * 四把调圈：最后成牌的人掷骰子，点数指向的人**方位不动**，其余三人依次调换。
 *
 * 实现口径（若与实际不符很容易反过来）：自由座位按座位号升序循环后移一位。
 * 例：`seats = [0,1,2,3]`，掷骰指向座位 2 → 座位 2 不动，自由座位 [0,1,3]，
 * 结果是 `[3,0,2,1]`（座位 0 换成原来的 3 号，座位 1 换成原来的 0 号，座位 3 换成原来的 1 号）。
 *
 * @param seats 座位号 → 玩家 id
 * @param rollerSeat 掷骰子的人（最后成牌的人）
 * @param diceSum 骰子点数和
 */
export function rotateSeatsAfterRound(seats: number[], rollerSeat: number, diceSum: number): number[] {
  if (seats.length !== SEAT_COUNT) throw new Error(`座位数应为 ${SEAT_COUNT}`)
  const fixedSeat = seatFromDice(rollerSeat, diceSum)
  const freeSeats = seats.map((_, seat) => seat).filter(seat => seat !== fixedSeat)
  const occupants = freeSeats.map(seat => seats[seat])
  const next = [...seats]
  freeSeats.forEach((seat, index) => {
    next[seat] = occupants[(index - 1 + occupants.length) % occupants.length]
  })
  return next
}

/* ------------------------------------------------------------------ *
 * 局流程
 * ------------------------------------------------------------------ */

export interface MatchState {
  /** 座位号 → 玩家 id */
  seats: number[]
  /** 第几局，1 到 ROUNDS_PER_CIRCLE */
  round: number
  /** 本局掷骰子的人（头家） */
  rollerSeat: number
  /** 本局东家，-1 表示还没掷骰 */
  dealerSeat: number
  /** 本局开牌墙，-1 表示还没掷骰 */
  wallSeat: number
  /** 本局留墩数 */
  breakStacks: number
}

export function createMatch(seats: number[] = [0, 1, 2, 3], rollerSeat = 0): MatchState {
  return { seats: [...seats], round: 1, rollerSeat, dealerSeat: -1, wallSeat: -1, breakStacks: 0 }
}

/** 本局掷骰：由头家掷，决定东家与开牌墙 */
export function rollRound(state: MatchState, diceA: number, diceB: number): MatchState {
  const opening = rollOpening(state.rollerSeat, diceA, diceB)
  return {
    ...state,
    dealerSeat: opening.dealerSeat,
    wallSeat: opening.wallSeat,
    breakStacks: opening.breakStacks
  }
}

/** 是否已经打满一圈（该调圈了） */
export function isCircleEnd(state: MatchState): boolean {
  return state.round >= ROUNDS_PER_CIRCLE
}

/**
 * 一局结束：赢家获得下一局掷骰子权。
 *
 * 打满 `ROUNDS_PER_CIRCLE` 局时进入调圈：赢家掷骰子（传 `circleDiceSum`），
 * 点数指向的方位不动，其余人依次调换，局数重新从 1 开始。
 *
 * @param winnerSeat 本局成牌的人（没有成牌则传 -1，头家继续坐庄）
 */
export function settleRound(state: MatchState, winnerSeat: number, circleDiceSum?: number): MatchState {
  const rollerSeat = winnerSeat >= 0 ? winnerSeat : state.rollerSeat
  const base: MatchState = { ...state, rollerSeat, dealerSeat: -1, wallSeat: -1, breakStacks: 0 }
  if (!isCircleEnd(state)) return { ...base, round: state.round + 1 }
  if (circleDiceSum === undefined) {
    throw new Error(`打满 ${ROUNDS_PER_CIRCLE} 局需要传 circleDiceSum 才能调圈`)
  }
  return {
    ...base,
    round: 1,
    seats: rotateSeatsAfterRound(state.seats, rollerSeat, circleDiceSum)
  }
}
