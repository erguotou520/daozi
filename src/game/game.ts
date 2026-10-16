/**
 * 倒子麻将 · 对局状态机（单把）
 *
 * 负责一手牌从发牌到结束的全过程：选缺门 → 摸牌 → 打牌 → 碰/杠/成 → 结算。
 * 纯逻辑、无 UI：`legalActions` 给出合法动作，`applyAction` 推进一步，供页面或 AI 驱动。
 * 规则口径见 `docs/倒子麻将-规则与结算.md`。
 */

import {
  HONORS,
  NUMBER_SUITS,
  isHonor,
  meldTiles,
  parseTile,
  scoreHand,
  tileOf,
  type Meld,
  type MeldKind,
  type NumberSuit,
  type ScoreResult,
  type Tile
} from './score'
import { SEAT_COUNT, dealPlan, rollOpening } from './table'

export const TOTAL_TILES = 136
export const STACKS_PER_WALL = 17
const TILES_PER_SEAT_WALL = 34

export type ClaimKind = '碰' | '杠' | '成'

export interface PlayerState {
  seat: number
  hand: Tile[]
  melds: Meld[]
  discards: Tile[]
  shortage: NumberSuit | null
  /** 本局剩余点数 */
  points: number
  isAI: boolean
}

/** 大吊车禁打：某家进入大吊车局面后产生的禁打范围，直到他换掉最后一支牌才解除 */
export interface DaLiaoCheBan {
  seat: number
  discardTile: Tile
  /** 触发禁打时手里的最后一支牌（等成对的那张） */
  waitTile: Tile
  forbidden: Tile[]
}

export type Phase = 'choose-shortage' | 'draw' | 'discard' | 'claim' | 'over'

export type RoundAction =
  | { type: 'chooseShortage'; seat: number; suit: NumberSuit }
  | { type: 'draw'; seat: number }
  | { type: 'discard'; seat: number; tile: Tile }
  | { type: 'win'; seat: number }
  | { type: 'claim'; seat: number; claim: ClaimKind }
  | { type: 'pass'; seat: number }

export interface HandState {
  /** 座位号 → 玩家 id */
  seats: number[]
  /** 按座位号索引 */
  players: PlayerState[]
  /** 每家门前的牌墙，index 0 是先摸到的牌 */
  piles: Tile[][]
  /** 与 piles 一一对应：这张牌出自第几墩、上层还是下层（画牌山用） */
  pileMeta: Array<Array<{ col: number; layer: number }>>
  wallSeat: number
  drawSeat: number
  /** 本把留墩数 */
  breakStacks: number
  dealerSeat: number
  phase: Phase
  /** 当前该行动的人；claim 阶段是当前表态的人 */
  turn: number
  lastDiscard: { tile: Tile; seat: number } | null
  /** 桌面上最后打出的那张牌（不会被碰杠清掉，给界面做标记用） */
  lastPlayed: { tile: Tile; seat: number } | null
  /** 待表态的座位，按「成 > 杠 > 碰，再按离打出者的远近」排序 */
  pendingClaims: number[]
  /** 刚摸到的牌 */
  drawnTile: Tile | null
  /** 是否杠后补牌成牌（杠开） */
  afterKong: boolean
  /** 是否本局首牌（清水判定） */
  isFirstHand: boolean
  bans: DaLiaoCheBan[]
  /** 最近一次「打出禁打牌」的违规记录（成牌时算点炮） */
  banViolation: { seat: number; tile: Tile } | null
  winner: { seat: number; selfDraw: boolean; score: ScoreResult } | null
  /** 大吊车禁打点炮：由这一家独自承担三家 */
  singlePayerSeat: number | null
  result: 'win' | 'exhausted' | null
  logs: string[]
}

export interface CreateHandOptions {
  seats?: number[]
  /** 本局各家剩余点数（按座位索引） */
  points?: number[]
  aiSeats?: number[]
  /** 掷骰子的人（头家） */
  rollerSeat?: number
  diceA: number
  diceB: number
  /** 预设牌堆，按顺序切给四家；不传则用一副完整牌 */
  deck?: Tile[]
  seed?: number
  /** 是否本局首牌 */
  isFirstHand?: boolean
  /** 直接指定各家起手牌（测试/沙盒用），此时不再自动发牌 */
  hands?: Tile[][]
  /** 直接指定牌墙（测试用）；不给则用剩余牌补齐 */
  piles?: Tile[][]
}

/* ------------------------------------------------------------------ *
 * 牌堆
 * ------------------------------------------------------------------ */

export function createDeck(): Tile[] {
  const deck: Tile[] = []
  for (const suit of NUMBER_SUITS) {
    for (let rank = 1; rank <= 9; rank += 1) {
      for (let copy = 0; copy < 4; copy += 1) deck.push(tileOf(suit, rank))
    }
  }
  for (const honor of HONORS) {
    for (let copy = 0; copy < 4; copy += 1) deck.push(honor)
  }
  return deck
}

/** 可复现的伪随机数（mulberry32） */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffleDeck(deck: Tile[], random: () => number = Math.random): Tile[] {
  const result = [...deck]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const swap = result[i]
    result[i] = result[j]
    result[j] = swap
  }
  return result
}

function removeTiles(deck: Tile[], used: Tile[]): Tile[] {
  const pool = [...deck]
  for (const tile of used) {
    const index = pool.indexOf(tile)
    if (index >= 0) pool.splice(index, 1)
  }
  return pool
}

/* ------------------------------------------------------------------ *
 * 开局
 * ------------------------------------------------------------------ */

type WallEntry = { col: number; layer: number }

/** 一段牌墙按"先上层、再下层"排成摸牌顺序，同时记下每张牌属于哪一墩哪一层 */
function buildWallSide(raw: Tile[]): { pile: Tile[]; meta: WallEntry[] } {
  const top = raw.slice(0, STACKS_PER_WALL)
  const bottom = raw.slice(STACKS_PER_WALL)
  return {
    pile: [...top, ...bottom],
    meta: [
      ...top.map((_, col) => ({ col, layer: 0 })),
      ...bottom.map((_, col) => ({ col, layer: 1 }))
    ]
  }
}

/** 留墩：这 k 墩两层都留到最后才轮到 */
function rotateKeep<T>(list: T[], breakStacks: number): T[] {
  const top = list.slice(0, STACKS_PER_WALL)
  const bottom = list.slice(STACKS_PER_WALL)
  return [
    ...top.slice(breakStacks),
    ...bottom.slice(breakStacks),
    ...top.slice(0, breakStacks),
    ...bottom.slice(0, breakStacks)
  ]
}

function buildWall(deck: Tile[], wallSeat: number, breakStacks: number) {
  const piles: Tile[][] = []
  const meta: WallEntry[][] = []
  for (let seat = 0; seat < SEAT_COUNT; seat += 1) {
    const raw = deck.slice(seat * TILES_PER_SEAT_WALL, (seat + 1) * TILES_PER_SEAT_WALL)
    const side = buildWallSide(raw)
    piles.push(side.pile)
    meta.push(side.meta)
  }
  if (breakStacks > 0) {
    piles[wallSeat] = rotateKeep(piles[wallSeat], breakStacks)
    meta[wallSeat] = rotateKeep(meta[wallSeat], breakStacks)
  }
  return { piles, meta }
}

/** 外部直接给牌墙时，按同样的"先上层再下层"规则补出 meta */
function metaForPile(pile: Tile[]): WallEntry[] {
  const entries: WallEntry[] = []
  const topCount = Math.min(pile.length, STACKS_PER_WALL)
  for (let col = 0; col < topCount; col += 1) entries.push({ col, layer: 0 })
  for (let index = STACKS_PER_WALL; index < pile.length; index += 1) {
    entries.push({ col: index - STACKS_PER_WALL, layer: 1 })
  }
  return entries
}

export function createHand(options: CreateHandOptions): HandState {
  const seats = options.seats ?? [0, 1, 2, 3]
  const points = options.points ?? seats.map(() => 50)
  const aiSeats = new Set(options.aiSeats ?? [1, 2, 3])
  const rollerSeat = options.rollerSeat ?? 0
  const opening = rollOpening(rollerSeat, options.diceA, options.diceB)

  const baseDeck = options.deck ? [...options.deck] : createDeck()
  const deck = options.hands || options.deck
    ? baseDeck
    : options.seed !== undefined
      ? shuffleDeck(baseDeck, seededRandom(options.seed))
      : shuffleDeck(baseDeck)

  const state: HandState = {
    seats: [...seats],
    players: Array.from({ length: SEAT_COUNT }, (_, seat) => ({
      seat,
      hand: [],
      melds: [],
      discards: [],
      shortage: null,
      points: points[seat] ?? 50,
      isAI: aiSeats.has(seat)
    })),
    piles: [],
    pileMeta: [],
    wallSeat: opening.wallSeat,
    drawSeat: opening.wallSeat,
    breakStacks: opening.breakStacks,
    dealerSeat: opening.dealerSeat,
    phase: 'choose-shortage',
    turn: opening.dealerSeat,
    lastDiscard: null,
    lastPlayed: null,
    pendingClaims: [],
    drawnTile: null,
    afterKong: false,
    isFirstHand: options.isFirstHand ?? false,
    bans: [],
    banViolation: null,
    winner: null,
    singlePayerSeat: null,
    result: null,
    logs: []
  }

  if (options.hands) {
    options.hands.forEach((hand, seat) => {
      state.players[seat].hand = [...hand]
    })
    if (options.piles) {
      state.piles = options.piles.map(pile => [...pile])
      state.pileMeta = state.piles.map(metaForPile)
    } else {
      const wall = buildWall(removeTiles(createDeck(), options.hands.flat()), opening.wallSeat, opening.breakStacks)
      state.piles = wall.piles
      state.pileMeta = wall.meta
    }
  } else {
    const wall = buildWall(deck, opening.wallSeat, opening.breakStacks)
    state.piles = wall.piles
    state.pileMeta = wall.meta
    for (const step of dealPlan(opening.dealerSeat)) {
      for (let i = 0; i < step.count; i += 1) {
        const tile = takeWallTile(state)
        if (!tile) throw new Error('发牌时牌墙已空')
        state.players[step.seat].hand.push(tile)
      }
    }
  }

  state.logs.push(
    `掷骰子 ${options.diceA}+${options.diceB}=${opening.sum}：${opening.dealerSeat} 号位做东家，从 ${opening.wallSeat} 号位开牌，留 ${opening.breakStacks} 墩。`
  )
  return state
}

/** 正常摸牌：从开牌处接续，摸空一面墙就轮到下一家 */
export function takeWallTile(state: HandState): Tile | null {
  for (let pass = 0; pass < SEAT_COUNT; pass += 1) {
    const seat = state.drawSeat
    const pile = state.piles[seat]
    if (pile.length) {
      const tile = pile.shift() as Tile
      state.pileMeta[seat].shift()
      if (!pile.length) state.drawSeat = (seat + 1) % SEAT_COUNT
      return tile
    }
    state.drawSeat = (seat + 1) % SEAT_COUNT
  }
  return null
}

/** 杠后补牌：从牌尾摸 */
export function takeTailTile(state: HandState): Tile | null {
  for (let step = SEAT_COUNT - 1; step >= 0; step -= 1) {
    const seat = (state.wallSeat + step) % SEAT_COUNT
    const pile = state.piles[seat]
    if (pile.length) {
      state.pileMeta[seat].pop()
      return pile.pop() as Tile
    }
  }
  return null
}

/** 某一家牌山的可视状态：17 墩 × [上层还在, 下层还在] */
export function wallVisualOf(state: HandState, seat: number): Array<[boolean, boolean]> {
  const visual: Array<[boolean, boolean]> = Array.from({ length: STACKS_PER_WALL }, () => [false, false])
  for (const entry of state.pileMeta[seat] ?? []) {
    if (visual[entry.col]) visual[entry.col][entry.layer] = true
  }
  return visual
}

export function remainingTiles(state: HandState): number {
  return state.piles.reduce((sum, pile) => sum + pile.length, 0)
}

/* ------------------------------------------------------------------ *
 * 合法性判断
 * ------------------------------------------------------------------ */

export function isShortageTile(player: PlayerState, tile: Tile): boolean {
  const info = parseTile(tile)
  return player.shortage !== null && info.suit === player.shortage
}

/** 手上还没打完的缺门牌 */
export function shortageTiles(player: PlayerState): Tile[] {
  return player.hand.filter(tile => isShortageTile(player, tile))
}

/** 某张牌在别家已公开的张数（打出的 + 副露的） */
export function visibleCount(state: HandState, tile: Tile, excludeSeat: number): number {
  let count = 0
  for (const player of state.players) {
    if (player.seat === excludeSeat) continue
    count += player.discards.filter(item => item === tile).length
    for (const meld of player.melds) count += meldTiles(meld).filter(item => item === tile).length
  }
  return count
}

/** 大吊车局面：已碰/杠四组，手上只剩一张等成对 */
export function isDaLiaoChe(player: PlayerState): boolean {
  return player.melds.length === SEAT_COUNT && player.hand.length === 1
}

function forbiddenRange(tile: Tile): Tile[] {
  const info = parseTile(tile)
  if (info.suit === '字') return [tile]
  const from = Math.max(1, info.rank - 2)
  const to = Math.min(9, info.rank + 2)
  const tiles: Tile[] = []
  for (let rank = from; rank <= to; rank += 1) tiles.push(tileOf(info.suit, rank))
  return tiles
}

/** 该家当前被禁打的牌（只挡不缺该门的人；绝对安全的牌不算） */
export function forbiddenDiscardsFor(state: HandState, seat: number): Tile[] {
  const player = state.players[seat]
  const result: Tile[] = []
  for (const ban of state.bans) {
    if (ban.seat === seat) continue
    const owner = state.players[ban.seat]
    // 大吊车玩家换掉最后一支牌 → 解除
    if (!owner.hand.includes(ban.waitTile)) continue
    for (const tile of ban.forbidden) {
      const info = parseTile(tile)
      if (player.shortage !== null && info.suit === player.shortage) continue
      const visible = visibleCount(state, tile, seat)
      const own = player.hand.filter(item => item === tile).length
      if (visible >= 3 || visible + own >= 4) continue
      if (!result.includes(tile)) result.push(tile)
    }
  }
  return result
}

/** 规则上允许打出的牌：只受缺门约束（禁打牌物理上仍可打出，只是要赔） */
export function playableDiscards(state: HandState, seat: number): Tile[] {
  const player = state.players[seat]
  const mustDiscard = shortageTiles(player)
  return mustDiscard.length ? mustDiscard : [...player.hand]
}

/**
 * 推荐/合法打出的牌：有缺门牌必须先打缺门牌，再排除大吊车禁打。
 * UI 与 AI 用这个；玩家硬要打禁打牌时走 `applyAction`，会记一次违规并算点炮。
 */
export function legalDiscards(state: HandState, seat: number): Tile[] {
  const base = playableDiscards(state, seat)
  const forbidden = new Set(forbiddenDiscardsFor(state, seat))
  const filtered = base.filter(tile => !forbidden.has(tile))
  // 兜底：万一禁打把牌全禁住，仍然要出一张，避免流程卡死
  return filtered.length ? filtered : base
}

/** 手上这 3n+2 张是否已经成牌 */
function isCompleteHand(state: HandState, seat: number, concealed: Tile[], winTile: Tile | null): boolean {
  const player = state.players[seat]
  return scoreHand({
    concealed,
    melds: player.melds,
    winTile: winTile ?? undefined
  }).isWinningHand
}

export function canWinHand(state: HandState, seat: number): boolean {
  const player = state.players[seat]
  return isCompleteHand(state, seat, player.hand, state.drawnTile)
}

/** 别家打出这张牌时该家能做什么 */
export function claimOptionsFor(state: HandState, seat: number, tile: Tile): ClaimKind[] {
  const player = state.players[seat]
  if (isShortageTile(player, tile)) return []
  const same = player.hand.filter(item => item === tile).length
  const options: ClaimKind[] = []
  if (isCompleteHand(state, seat, [...player.hand, tile], tile)) options.push('成')
  if (same >= 3) options.push('杠')
  if (same >= 2) options.push('碰')
  return options
}

const CLAIM_RANK: Record<ClaimKind, number> = { 成: 0, 杠: 1, 碰: 2 }

function buildPendingClaims(state: HandState, discardSeat: number, tile: Tile): number[] {
  const candidates: Array<{ seat: number; best: number; distance: number }> = []
  for (let step = 1; step < SEAT_COUNT; step += 1) {
    const seat = (discardSeat + step) % SEAT_COUNT
    const options = claimOptionsFor(state, seat, tile)
    if (!options.length) continue
    candidates.push({ seat, best: Math.min(...options.map(option => CLAIM_RANK[option])), distance: step })
  }
  candidates.sort((a, b) => a.best - b.best || a.distance - b.distance)
  return candidates.map(candidate => candidate.seat)
}

export function legalActions(state: HandState, seat: number): RoundAction[] {
  const player = state.players[seat]
  if (state.phase === 'choose-shortage') {
    if (player.shortage) return []
    return NUMBER_SUITS.map(suit => ({ type: 'chooseShortage', seat, suit }) as RoundAction)
  }
  if (state.phase === 'draw') {
    return state.turn === seat ? [{ type: 'draw', seat }] : []
  }
  if (state.phase === 'discard') {
    if (state.turn !== seat) return []
    const actions: RoundAction[] = legalDiscards(state, seat).map(
      tile => ({ type: 'discard', seat, tile }) as RoundAction
    )
    // 只有刚摸到牌（含杠后补牌）才能成牌；碰完必须打牌
    if (state.drawnTile && canWinHand(state, seat)) actions.unshift({ type: 'win', seat })
    return actions
  }
  if (state.phase === 'claim') {
    if (state.pendingClaims[0] !== seat || !state.lastDiscard) return []
    const options = claimOptionsFor(state, seat, state.lastDiscard.tile)
    const actions: RoundAction[] = options.map(claim => ({ type: 'claim', seat, claim }) as RoundAction)
    actions.push({ type: 'pass', seat })
    return actions
  }
  return []
}

/* ------------------------------------------------------------------ *
 * 推进
 * ------------------------------------------------------------------ */

function cloneHand(state: HandState): HandState {
  return {
    ...state,
    seats: [...state.seats],
    players: state.players.map(player => ({
      ...player,
      hand: [...player.hand],
      melds: player.melds.map(meld => ({ ...meld })),
      discards: [...player.discards]
    })),
    piles: state.piles.map(pile => [...pile]),
    pileMeta: state.pileMeta.map(entries => entries.map(entry => ({ ...entry }))),
    pendingClaims: [...state.pendingClaims],
    bans: state.bans.map(ban => ({ ...ban, forbidden: [...ban.forbidden] })),
    logs: [...state.logs]
  }
}

export function applyAction(state: HandState, action: RoundAction): HandState {
  const next = cloneHand(state)
  const player = next.players[action.seat]

  if (action.type === 'chooseShortage') {
    if (next.phase !== 'choose-shortage') throw new Error('当前不是选缺门阶段')
    if (player.shortage) throw new Error('缺门不能更换')
    player.shortage = action.suit
    next.logs.push(`${action.seat} 号位缺${action.suit}`)
    if (next.players.every(item => item.shortage)) {
      next.phase = 'draw'
      next.turn = next.dealerSeat
    }
    return next
  }

  if (action.type === 'draw') {
    if (next.phase !== 'draw' || next.turn !== action.seat) throw new Error('当前不能摸牌')
    const tile = takeWallTile(next)
    if (!tile) {
      next.phase = 'over'
      next.result = 'exhausted'
      next.logs.push('牌墙摸完，本把流局')
      return next
    }
    player.hand.push(tile)
    next.drawnTile = tile
    next.afterKong = false
    next.phase = 'discard'
    next.logs.push(`${action.seat} 号位摸牌`)
    return next
  }

  if (action.type === 'win') {
    if (next.phase !== 'discard' || next.turn !== action.seat || !next.drawnTile) {
      throw new Error('当前不能成牌')
    }
    return resolveWin(next, action.seat, true, next.drawnTile, null)
  }

  if (action.type === 'discard') {
    if (next.phase !== 'discard' || next.turn !== action.seat) throw new Error('当前不能打牌')
    if (!playableDiscards(next, action.seat).includes(action.tile)) throw new Error(`不能打出 ${action.tile}`)
    const violation = forbiddenDiscardsFor(next, action.seat).includes(action.tile)
    const index = player.hand.indexOf(action.tile)
    player.hand.splice(index, 1)
    player.discards.push(action.tile)
    next.lastDiscard = { tile: action.tile, seat: action.seat }
    next.lastPlayed = { tile: action.tile, seat: action.seat }
    next.drawnTile = null
    next.afterKong = false
    next.banViolation = violation ? { seat: action.seat, tile: action.tile } : null
    next.logs.push(`${action.seat} 号位打出 ${action.tile}${isShortageTile(player, action.tile) ? '（缺门）' : ''}`)
    if (violation) next.logs.push(`${action.seat} 号位打出禁打牌 ${action.tile}，成牌算点炮`)

    updateBan(next, action.seat, action.tile)

    const pending = buildPendingClaims(next, action.seat, action.tile)
    if (pending.length) {
      next.pendingClaims = pending
      next.phase = 'claim'
      next.turn = pending[0]
      return next
    }
    next.pendingClaims = []
    next.phase = 'draw'
    next.turn = (action.seat + 1) % SEAT_COUNT
    return next
  }

  if (action.type === 'claim') {
    if (next.phase !== 'claim' || !next.lastDiscard) throw new Error('当前没有可接的牌')
    const discard = next.lastDiscard
    if (!claimOptionsFor(next, action.seat, discard.tile).includes(action.claim)) {
      throw new Error(`不能${action.claim} ${discard.tile}`)
    }
    return resolveClaim(next, action.seat, action.claim)
  }

  if (action.type === 'pass') {
    if (next.phase !== 'claim') throw new Error('当前不是接牌阶段')
    return advanceClaim(next)
  }

  throw new Error('未知动作')
}

function updateBan(state: HandState, seat: number, discardTile: Tile) {
  const player = state.players[seat]
  // 换掉最后一支牌 → 解除自己身上的禁打
  state.bans = state.bans.filter(ban => ban.seat !== seat || player.hand.includes(ban.waitTile))
  if (!isDaLiaoChe(player)) return
  if (state.bans.some(ban => ban.seat === seat)) return
  const waitTile = player.hand[0]
  state.bans.push({ seat, discardTile, waitTile, forbidden: forbiddenRange(discardTile) })
  state.logs.push(
    `${seat} 号位进入大吊车，打出 ${discardTile} 后 ${isHonor(discardTile) ? `只禁 ${discardTile}` : `禁 ${forbiddenRange(discardTile).join('/')}`}`
  )
}

function resolveClaim(state: HandState, seat: number, claim: ClaimKind): HandState {
  const player = state.players[seat]
  const discard = state.lastDiscard
  if (!discard) throw new Error('没有可接的牌')
  const tile = discard.tile

  if (claim === '成') return resolveWin(state, seat, false, tile, discard.seat)

  const needed = claim === '碰' ? 2 : 3
  for (let removed = 0; removed < needed; removed += 1) {
    const index = player.hand.indexOf(tile)
    if (index < 0) throw new Error('手牌不足，无法碰/杠')
    player.hand.splice(index, 1)
  }
  const kind: MeldKind = claim === '碰' ? '碰' : '明杠'
  player.melds.push({ kind, tile })
  // 被接走的牌从原打出者的牌河移除
  const discarder = state.players[discard.seat]
  const discardIndex = discarder.discards.lastIndexOf(tile)
  if (discardIndex >= 0) discarder.discards.splice(discardIndex, 1)

  state.lastDiscard = null
  state.pendingClaims = []
  state.turn = seat
  state.drawnTile = null

  if (claim === '碰') {
    state.phase = 'discard'
    state.logs.push(`${seat} 号位碰 ${tile}，需立即打出一张`)
    return state
  }

  state.logs.push(`${seat} 号位杠 ${tile}，从牌尾补牌`)
  const extra = takeTailTile(state)
  if (!extra) {
    state.phase = 'over'
    state.result = 'exhausted'
    state.logs.push('牌尾无牌可补，本把流局')
    return state
  }
  player.hand.push(extra)
  state.drawnTile = extra
  state.afterKong = true
  state.phase = 'discard'
  return state
}

function advanceClaim(state: HandState): HandState {
  const rest = state.pendingClaims.slice(1)
  if (rest.length) {
    state.pendingClaims = rest
    state.turn = rest[0]
    return state
  }
  const discardSeat = state.lastDiscard?.seat ?? state.turn
  state.pendingClaims = []
  state.lastDiscard = null
  state.phase = 'draw'
  state.turn = (discardSeat + 1) % SEAT_COUNT
  return state
}

/* ------------------------------------------------------------------ *
 * 成牌
 * ------------------------------------------------------------------ */

function resolveWin(
  state: HandState,
  seat: number,
  selfDraw: boolean,
  winTile: Tile | null,
  discardSeat: number | null
): HandState {
  const player = state.players[seat]

  // 先把手上的成牌张 / 被接走的牌从牌河移除，再统计可见张数
  if (!selfDraw && winTile && discardSeat !== null) {
    const discarder = state.players[discardSeat]
    const index = discarder.discards.lastIndexOf(winTile)
    if (index >= 0) discarder.discards.splice(index, 1)
  }

  const concealed = selfDraw ? [...player.hand] : winTile ? [...player.hand, winTile] : [...player.hand]
  const visible = winTile ? visibleCount(state, winTile, seat) : 0

  // 三打一：其他三家缺同一门，自己不缺那一门
  const others = state.players.filter(item => item.seat !== seat)
  const shared = others[0].shortage
  const threeToOne =
    shared !== null &&
    player.shortage !== null &&
    others.every(item => item.shortage === shared) &&
    player.shortage !== shared

  // 大吊车禁打点炮：自己正处大吊车，别人打出禁牌
  const ban = state.bans.find(item => item.seat === seat)
  const singlePayer =
    !selfDraw && discardSeat !== null && !!ban && !!winTile && ban.forbidden.includes(winTile)

  const score = scoreHand({
    concealed,
    melds: player.melds,
    winTile: winTile ?? undefined,
    selfDraw,
    visibleWinTileCount: visible,
    isFirstHand: state.isFirstHand,
    isAfterKong: state.afterKong,
    threeToOne,
    singlePayer
  })

  state.winner = { seat, selfDraw, score }
  state.singlePayerSeat = singlePayer ? discardSeat : null
  state.phase = 'over'
  state.result = 'win'
  state.lastDiscard = null
  state.logs.push(
    `${seat} 号位${selfDraw ? '自摸' : '接牌'}成牌，${score.points.total} 点${score.bigWin.isBigWin ? '（大拿）' : ''}`
  )
  return state
}

export interface HandSettlement {
  winnerSeat: number
  selfDraw: boolean
  score: ScoreResult
  /** 按座位索引的点数变化 */
  pointDelta: number[]
  /** 按座位索引的金额变化（元） */
  moneyDelta: number[]
  /** 结算后本局是否结束（有人点数被付完） */
  gameOver: boolean
}

/**
 * 本把结算：
 * - 普通成牌：三家各付 min(成牌点数, 自己剩余点数)。
 * - 大拿：其他三家点数清零，另各付 40 元；摸子照算。
 * - 大吊车禁打点炮：由打出一人承担三份（金额与点数都由他一人出）。
 */
export function settleHand(state: HandState): HandSettlement | null {
  if (!state.winner) return null
  const { seat: winnerSeat, selfDraw, score } = state.winner
  const pointDelta = state.players.map(() => 0)
  const moneyDelta = state.players.map(() => 0)

  const singleSeat = selfDraw ? null : state.singlePayerSeat
  const payers = singleSeat === null
    ? state.players.filter(player => player.seat !== winnerSeat)
    : [state.players[singleSeat]]
  const shareFactor = singleSeat === null ? 1 : 3
  const perShare = score.money.perOpponentTotal

  for (const payer of payers) {
    const payPoints = score.bigWin.isBigWin
      ? payer.points
      : Math.min(score.points.total * shareFactor, payer.points)
    pointDelta[payer.seat] -= payPoints
    pointDelta[winnerSeat] += payPoints

    const payMoney = perShare * shareFactor
    moneyDelta[payer.seat] -= payMoney
    moneyDelta[winnerSeat] += payMoney
  }

  const after = state.players.map((player, seat) => player.points + pointDelta[seat])
  return {
    winnerSeat,
    selfDraw,
    score,
    pointDelta,
    moneyDelta,
    gameOver: after.some(points => points <= 0)
  }
}

/* ------------------------------------------------------------------ *
 * 简易 AI（确定性，便于复现）
 * ------------------------------------------------------------------ */

export function chooseAIAction(state: HandState, seat: number): RoundAction | null {
  const actions = legalActions(state, seat)
  if (!actions.length) return null
  const player = state.players[seat]

  if (state.phase === 'choose-shortage') {
    const count = (suit: NumberSuit) => player.hand.filter(tile => parseTile(tile).suit === suit).length
    const best = [...NUMBER_SUITS].sort((a, b) => count(a) - count(b))[0]
    return { type: 'chooseShortage', seat, suit: best }
  }
  if (state.phase === 'draw') return { type: 'draw', seat }
  if (state.phase === 'claim') {
    const win = actions.find(action => action.type === 'claim' && action.claim === '成')
    if (win) return win
    // 简单策略：能杠就杠，能碰且手里还有缺门牌就先碰（方便清缺门），否则过
    const kong = actions.find(action => action.type === 'claim' && action.claim === '杠')
    if (kong) return kong
    return { type: 'pass', seat }
  }
  if (state.phase === 'discard') {
    const win = actions.find(action => action.type === 'win')
    if (win) return win
    const discards = actions.filter(
      (action): action is Extract<RoundAction, { type: 'discard' }> => action.type === 'discard'
    )
    if (!discards.length) return null
    const shortage = shortageTiles(player)
    const pool = shortage.length ? discards.filter(action => isShortageTile(player, action.tile)) : discards
    return (pool.length ? pool : discards)[0]
  }
  return null
}
