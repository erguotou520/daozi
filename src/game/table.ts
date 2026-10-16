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
}

/**
 * 发牌计划：3 轮 × 每人 4 张，再每人 1 张，最后东家补 1 张。
 * 一共 53 张，东家 14 张、其余各家 13 张。
 */
export function dealPlan(dealerSeat: number): DealStep[] {
  const order = dealOrder(dealerSeat)
  const steps: DealStep[] = []
  for (let round = 0; round < 3; round += 1) {
    for (const seat of order) steps.push({ seat, count: 4 })
  }
  for (const seat of order) steps.push({ seat, count: 1 })
  steps.push({ seat: dealerSeat, count: 1 })
  return steps
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
