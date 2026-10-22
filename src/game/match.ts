/**
 * 倒子麻将 · 局流程
 *
 * 一「局」会连打若干「把」，直到某一家 50 点被付完为止；局末清算实际输赢，
 * 下一局各家恢复 50 点，赢家获得掷骰子权；打满 4 局调圈。
 *
 * 与 `game.ts`（单把状态机）、`table.ts`（座位与调圈）配合使用。
 */

import { SEAT_COUNT, ROUNDS_PER_CIRCLE, rotateSeatsAfterRound, seatFromDice, seatOfPlayer } from './table'
import {
  createHand,
  settleHand,
  type CreateHandOptions,
  type HandState,
  type HandSettlement
} from './game'

export const STARTING_POINTS = 50

export interface MatchOptions {
  /** 座位号 → 玩家 id */
  seats?: number[]
  aiSeats?: number[]
  startingPoints?: number
  /** 第一把谁掷骰子 */
  rollerSeat?: number
  /**
   * 本地单机里「自己」的玩家 id。调圈换座后整桌会按自己挪到的位置转回来，
   * 让自己始终坐在 0 号位（界面只认 0 号位是自己）。多人对局传各自的 id。
   */
  humanId?: number
}

export interface MatchState {
  seats: number[]
  aiSeats: number[]
  /** 「自己」的玩家 id（单机固定 0，调圈时用来把自己转回 0 号位） */
  humanId: number
  /** 第几局，1..ROUNDS_PER_CIRCLE */
  roundIndex: number
  /** 本局每家剩余点数（按座位索引） */
  points: number[]
  /** 本局每家金额（元，按座位索引） */
  money: number[]
  /** 跨局累计金额（元，按座位索引；调圈时跟着人一起换座） */
  totalMoney: number[]
  /** 本局已经打了几把 */
  hands: number
  /** 下一把该谁掷骰子（上把赢家；流局则不变） */
  rollerSeat: number
  /** 当前这把；null 表示还没开局或上一把已结算 */
  current: HandState | null
  /** 每局结束时记一笔总账 */
  history: Array<{ roundIndex: number; money: number[]; seats: number[] }>
  logs: string[]
}

export function createMatch(options: MatchOptions = {}): MatchState {
  const startingPoints = options.startingPoints ?? STARTING_POINTS
  return {
    seats: options.seats ? [...options.seats] : [0, 1, 2, 3],
    aiSeats: options.aiSeats ? [...options.aiSeats] : [1, 2, 3],
    humanId: options.humanId ?? 0,
    roundIndex: 1,
    points: Array.from({ length: SEAT_COUNT }, () => startingPoints),
    money: Array.from({ length: SEAT_COUNT }, () => 0),
    totalMoney: Array.from({ length: SEAT_COUNT }, () => 0),
    hands: 0,
    rollerSeat: options.rollerSeat ?? 0,
    current: null,
    history: [],
    logs: []
  }
}

/** 开一把：东家掷骰，只定开牌墙与留墩 */
export function startHand(
  match: MatchState,
  diceA: number,
  diceB: number,
  extra: Partial<CreateHandOptions> = {}
): MatchState {
  if (match.current) throw new Error('上一把还没结算')
  const hand = createHand({
    seats: match.seats,
    points: match.points,
    aiSeats: match.aiSeats,
    rollerSeat: match.rollerSeat,
    diceA,
    diceB,
    // 首牌＝本局刚开、各家都还是 50 点
    isFirstHand: match.hands === 0,
    ...extra
  })
  return {
    ...match,
    current: hand,
    logs: [...match.logs, `第 ${match.roundIndex} 局第 ${match.hands + 1} 把：${diceA}+${diceB}=${diceA + diceB}`]
  }
}

/**
 * 结算本把并推进。
 * - 有人成牌：点数按结算结果转移；赢家获得下一把掷骰子权；有人点数被付完则本局结束。
 * - 流局：本把无事发生，头家不变。
 *
 * @param options.circleDiceSum 打满一圈要调圈时的骰子点数和
 * @param options.rotate 是否调圈，默认 true；单人演示里座位固定，传 false
 */
export function endHand(match: MatchState, options: EndHandOptions = {}): MatchState {
  if (!match.current) throw new Error('当前没有进行中的牌局')
  const settlement = settleHand(match.current)
  if (settlement) return applyHandSettlement(match, settlement, options)
  return {
    ...match,
    hands: match.hands + 1,
    current: null,
    logs: [...match.logs, `第 ${match.hands + 1} 把流局`]
  }
}

export interface EndHandOptions {
  /** 打满一圈要调圈时的骰子点数和；不调圈则不需要 */
  circleDiceSum?: number
  /** 是否调圈（换座位），默认 true */
  rotate?: boolean
}

/** 把一把的结算结果落到局上；单测可以直接喂一个构造好的结算 */
export function applyHandSettlement(
  match: MatchState,
  settlement: HandSettlement,
  options: EndHandOptions = {}
): MatchState {
  const points = match.points.map((value, seat) => value + settlement.pointDelta[seat])
  const money = match.money.map((value, seat) => value + settlement.moneyDelta[seat])
  const rollerSeat = settlement.winnerSeat >= 0 ? settlement.winnerSeat : match.rollerSeat
  const hands = match.hands + 1
  const base: MatchState = { ...match, points, money, hands, rollerSeat, current: null }

  if (!settlement.gameOver) {
    return {
      ...base,
      logs: [...match.logs, `第 ${hands} 把 ${settlement.winnerSeat} 号位成牌，本局继续`]
    }
  }

  // 本局结束：清算实际输赢，下一局大家恢复点数
  const totalMoney = match.totalMoney.map((value, seat) => value + money[seat])
  const settled: MatchState = {
    ...base,
    totalMoney,
    history: [...match.history, { roundIndex: match.roundIndex, money: [...money], seats: [...match.seats] }]
  }

  const finishedRound = match.roundIndex
  const rotate = options.rotate !== false && finishedRound % ROUNDS_PER_CIRCLE === 0
  if (rotate && options.circleDiceSum === undefined) {
    throw new Error(`打满 ${ROUNDS_PER_CIRCLE} 局需要传 circleDiceSum 才能调圈`)
  }
  // 调圈：按规则换完座以后，再整桌转一次，让「自己」回到 0 号位（界面只认 0 号位是自己），
  // 三家电脑的相对位置、累计账目、AI 标记都跟着人一起换过去。
  const physical = rotate
    ? rotateSeatsAfterRound(match.seats, rollerSeat, options.circleDiceSum as number)
    : match.seats
  const mySeat = rotate ? Math.max(0, seatOfPlayer(physical, match.humanId ?? 0)) : 0
  const seats = rotate
    ? physical.map((_, seat) => physical[(seat + mySeat) % SEAT_COUNT])
    : match.seats
  const rotatedTotal = rotate
    ? seats.map(player => settled.totalMoney[seatOfPlayer(match.seats, player)])
    : settled.totalMoney
  const rotatedAi = rotate
    ? seats.flatMap((player, seat) => (match.aiSeats.includes(seatOfPlayer(match.seats, player)) ? [seat] : []))
    : match.aiSeats
  // 掷骰权（东家）也跟着成牌的人到新座位
  const movedSeat = rotate ? seatOfPlayer(seats, match.seats[rollerSeat]) : rollerSeat
  const fixedSeat = rotate ? seatFromDice(rollerSeat, options.circleDiceSum as number) : -1

  return {
    ...settled,
    seats,
    aiSeats: rotatedAi,
    totalMoney: rotatedTotal,
    rollerSeat: movedSeat >= 0 ? movedSeat : rollerSeat,
    // 局数一直往上加：调圈按「每 4 局一圈」判断，不再把局数折回 1
    roundIndex: finishedRound + 1,
    points: Array.from({ length: SEAT_COUNT }, () => STARTING_POINTS),
    money: Array.from({ length: SEAT_COUNT }, () => 0),
    hands: 0,
    logs: [
      ...settled.logs,
      `第 ${finishedRound} 局结束（${match.points
        .map((value, seat) => `${seat} 号位 ${value + settlement.pointDelta[seat]} 点`)
        .join('，')}）`,
      ...(rotate
        ? [`四局调圈：${rollerSeat} 号位掷 ${options.circleDiceSum} 点，${fixedSeat} 号位位置不动，其余三家按顺时针换位`]
        : [])
    ]
  }
}

/** 本局各家的实际输赢（元） */
export function roundMoney(match: MatchState): number[] {
  return [...match.money]
}

/** 跨局累计输赢（元） */
export function totalMoney(match: MatchState): number[] {
  return [...match.totalMoney]
}
