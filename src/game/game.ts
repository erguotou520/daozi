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
  countsOf,
  decompose,
  isHonor,
  meldTiles,
  parseTile,
  scoreHand,
  tileOf,
  tileOrder,
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
export type KongKind = '暗杠' | '加杠'

export interface KongOption {
  tile: Tile
  kind: KongKind
}

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

export type Phase = 'choose-shortage' | 'draw' | 'discard' | 'claim' | 'rob-kong' | 'over'

export type RoundAction =
  | { type: 'chooseShortage'; seat: number; suit: NumberSuit }
  | { type: 'draw'; seat: number }
  | { type: 'discard'; seat: number; tile: Tile }
  | { type: 'win'; seat: number; robKong?: boolean }
  | { type: 'kong'; seat: number; tile: Tile; kind: KongKind }
  | { type: 'claim'; seat: number; claim: ClaimKind }
  | { type: 'pass'; seat: number }

/** 加杠后等待别家抢杠的状态 */
export interface RobKongState {
  /** 杠牌的人 */
  seat: number
  /** 被加杠的牌 */
  tile: Tile
  /** 还能表态的人，按顺序 */
  pending: number[]
}

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
  /** 加杠后被抢杠的等待状态 */
  robKong: RobKongState | null
  /** 刚摸到的牌 */
  drawnTile: Tile | null
  /** 是否杠后补牌成牌（杠开） */
  afterKong: boolean
  /** 是否本局首牌（清水判定） */
  isFirstHand: boolean
  /**
   * 三打一：四家定缺后三家缺同一门、另一家缺另一门时，
   * 缺另一门的那一家（明牌家）；不是 3:1 则为 null。
   */
  threeToOneSeat: number | null
  /** 三打一：另外三家共同缺的那一门——只把这一门的牌翻开，其余手牌不亮 */
  threeToOneSuit: NumberSuit | null
  bans: DaLiaoCheBan[]
  /** 最近一次「打出禁打牌」的违规记录（成牌时算点炮） */
  banViolation: { seat: number; tile: Tile } | null
  winner: { seat: number; selfDraw: boolean; score: ScoreResult; winTile: Tile | null } | null
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
  /** 掷骰子的人，同时是东家（上一把成牌的人） */
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

/**
 * 一段牌墙排成摸牌顺序：**一墩一墩地抓，每墩先上层再下层**。
 * 所以顺序是「1墩上、1墩下、2墩上、2墩下……」——不是把整面墙的上层先抓完。
 *
 * **方向：从右往左**（墩号 16 → 0）。牌桌上的牌墙是从自己牌面右边开始、
 * 一墩一墩往左抓的；顺时针绕一圈，所以每段墙的抓牌端都是它的「右端」
 * （竖着的两面墙就是下端）。墩号只表示画在哪儿，抓牌顺序由这里决定。
 */
function buildWallSide(raw: Tile[]): { pile: Tile[]; meta: WallEntry[] } {
  const pile: Tile[] = []
  const meta: WallEntry[] = []
  for (let col = STACKS_PER_WALL - 1; col >= 0; col -= 1) {
    const top = raw[col]
    const bottom = raw[col + STACKS_PER_WALL]
    if (top !== undefined) {
      pile.push(top)
      meta.push({ col, layer: 0 })
    }
    if (bottom !== undefined) {
      pile.push(bottom)
      meta.push({ col, layer: 1 })
    }
  }
  return { pile, meta }
}

/**
 * 四面墙各 17 墩 34 张，排成摸牌顺序；四段首尾相接就是整条牌墙。
 *
 * 每段墙都是**从右往左**排（墩号 16 → 0），所以数组开头就是抓牌端。
 * 开牌那面墙最右的几摞是**留墩**：它们留在数组开头不动，抓牌时跳过，
 * 等整圈抓完才轮到（见 `takeWallTile`）——墙上任何时刻都不会中段空档。
 */
function buildWall(deck: Tile[]) {
  const piles: Tile[][] = []
  const meta: WallEntry[][] = []
  for (let seat = 0; seat < SEAT_COUNT; seat += 1) {
    const raw = deck.slice(seat * TILES_PER_SEAT_WALL, (seat + 1) * TILES_PER_SEAT_WALL)
    const side = buildWallSide(raw)
    piles.push(side.pile)
    meta.push(side.meta)
  }
  // 留墩就摆在开牌墙的最右端（数组开头），但**不先抓**——takeWallTile 会跳过它们，
  // 等整圈抓完才轮到（见 takeWallTile 的 kept 偏移）。
  // 四面墙只是同一圈牌的四段：抓牌从开牌墙那段抓起，抓完接着下一段，
  // 所以整圈只在「已经抓到哪儿」这一个地方变短，不会四面各缺一段。
  return { piles, meta }
}

/** 外部直接给牌墙时，按同样的「一墩上下交替」规则补出 meta */
function metaForPile(pile: Tile[]): WallEntry[] {
  const entries: WallEntry[] = []
  for (let index = 0; index < pile.length; index += 1) {
    entries.push({ col: Math.floor(index / 2), layer: index % 2 })
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
    robKong: null,
    drawnTile: null,
    afterKong: false,
    isFirstHand: options.isFirstHand ?? false,
    threeToOneSeat: null,
    threeToOneSuit: null,
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
      // 外部直接摆好的牌墙就是全部可抓的牌，没有留墩
      state.breakStacks = 0
    } else {
      const wall = buildWall(removeTiles(createDeck(), options.hands.flat()))
      state.piles = wall.piles
      state.pileMeta = wall.meta
    }
  } else {
    const wall = buildWall(deck)
    state.piles = wall.piles
    state.pileMeta = wall.meta
    for (const step of dealPlan(opening.dealerSeat)) {
      for (let i = 0; i < step.count; i += 1) {
        // 牌墙是一条连续的牌：谁抓都从墙头取，抓完接着往下走。
        // 庄家跳牌时这一手先跳过一张再取（跳过的那张留在墙上）。
        const skip = i === 0 ? (step.skip ?? 0) : 0
        const tile = takeWallTile(state, step.seat, skip)
        if (!tile) throw new Error('发牌时牌墙已空')
        state.players[step.seat].hand.push(tile)
      }
    }
  }

  state.logs.push(
    `掷骰子 ${options.diceA}+${options.diceB}=${opening.sum}：${opening.dealerSeat} 号位坐东，从 ${opening.wallSeat} 号位开牌，留 ${opening.breakStacks} 墩。`
  )
  return state
}

/**
 * 摸牌：牌墙是**一条连续的牌**，从骰子定的开牌墙开始，顺时针绕桌子一圈往下抓。
 *
 * 方向是**顺时针**：自己这面墙从右往左抓，抓到头接左手边那面（上家），
 * 再往上是对面、右手边（下家），最后绕回自己这面墙的留墩。
 * 发牌和打牌用的是同一条队列，所以墙上只会在「已经抓到哪儿」这一个地方出现空档，
 * 不会四面墙各缺一段。
 *
 * @param seat 摸牌的人（只影响日志，牌一律从墙头取）
 * @param skip 先跳过几张再取（庄家跳牌用）。被跳过的那张留在墙头，
 *             下一次摸牌就会摸到它——牌桌上因此会留一个缺口。
 */
export function takeWallTile(state: HandState, seat = state.turn, skip = 0): Tile | null {
  void seat
  // 留墩：整圈还没抓完之前先跳过开牌墙最右那几摞，等别的都抓光了才轮到它们
  const keptTotal = Math.min(state.breakStacks * 2, TILES_PER_SEAT_WALL - 2)
  const remaining = state.piles.reduce((sum, pile) => sum + pile.length, 0)
  const keepAside = remaining > keptTotal ? keptTotal : 0
  for (let step = 0; step < SEAT_COUNT; step += 1) {
    const from = (state.wallSeat - step + SEAT_COUNT) % SEAT_COUNT
    const pile = state.piles[from]
    const offset = skip + (from === state.wallSeat ? keepAside : 0)
    if (pile.length > offset) {
      const tile = pile.splice(offset, 1)[0] as Tile
      state.pileMeta[from].splice(offset, 1)
      return tile
    }
  }
  return null
}

/** 杠后补牌：从牌墙的最尾巴摸（也就是这一圈最后才会轮到的那几张，即留墩） */
export function takeTailTile(state: HandState, seat = state.turn): Tile | null {
  void seat
  for (let step = 0; step < SEAT_COUNT; step += 1) {
    const from = (state.wallSeat + 1 + step) % SEAT_COUNT
    const pile = state.piles[from]
    if (pile.length) {
      state.pileMeta[from].pop()
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

/**
 * 三打一：三家缺同一门、剩下一家缺另一门时，那一家要把「三家缺的那门」翻开。
 * 返回明牌家 + 被翻开的花色；四家同缺或两两不同时返回 null。
 */
export function threeToOneOf(state: HandState): { seat: number; suit: NumberSuit } | null {
  const players = state.players
  if (players.some(player => player.shortage === null)) return null
  for (const player of players) {
    const others = players.filter(other => other.seat !== player.seat)
    const shared = others[0].shortage
    if (shared !== player.shortage && others.every(other => other.shortage === shared)) {
      return { seat: player.seat, suit: shared as NumberSuit }
    }
  }
  return null
}

/** 34 种牌面各一张，听牌判定时枚举进张用 */
const ALL_TILE_KINDS: Tile[] = [
  ...NUMBER_SUITS.flatMap(suit => Array.from({ length: 9 }, (_, index) => tileOf(suit, index + 1))),
  ...HONORS
]

/** 这手牌（含副露）是否已经成牌：4 组面子 + 1 对将，或七对 */
function isWinningConcealed(concealed: Tile[], melds: Meld[]): boolean {
  if (melds.length === 0 && concealed.length === 14) {
    const counts = [...countsOf(concealed).values()]
    if (counts.length > 0 && counts.length <= 7 && counts.every(n => n % 2 === 0)) return true
  }
  const needSets = 4 - melds.length
  if (needSets < 0 || concealed.length !== needSets * 3 + 2) return false
  return decompose(countsOf(concealed)).some(item => item.sets.length === needSets)
}

/** 当前 13 张（或副露后的等价张数）是否听牌：再进一张就能成牌 */
function hasWinningTile(player: PlayerState): boolean {
  const meldTilesAll = player.melds.flatMap(meld => meldTiles(meld))
  for (const candidate of ALL_TILE_KINDS) {
    if (player.shortage && parseTile(candidate).suit === player.shortage) continue
    const own = [...player.hand, ...meldTilesAll].filter(tile => tile === candidate).length
    if (own >= 4) continue
    if (isWinningConcealed([...player.hand, candidate], player.melds)) return true
  }
  return false
}

/**
 * 是否听牌。缺门牌没打完时不算；刚摸完牌（手牌 3n+2）时，
 * 只要有一种打法能打到听牌，也算听牌，标识不会在摸牌那一巡闪掉。
 */
export function isTenpaiHand(player: PlayerState): boolean {
  if (player.shortage && player.hand.some(tile => parseTile(tile).suit === player.shortage)) return false
  const rest = player.hand.length % 3
  if (rest === 1) return hasWinningTile(player)
  if (rest === 2) {
    const tried = new Set<Tile>()
    for (const tile of player.hand) {
      if (tried.has(tile)) continue
      tried.add(tile)
      const next = [...player.hand]
      next.splice(next.indexOf(tile), 1)
      if (hasWinningTile({ ...player, hand: next })) return true
    }
  }
  return false
}

/**
 * 某张牌在桌上已公开的张数（牌河里打出的 + 碰杠亮出的）。
 *
 * excludeSeat 传座位号时不计这一家——判断「别家已经出了几张」（禁打提示）用。
 * 传 null 时自己的也计入：枯只压看的是「成牌张是不是场上最后一张」，
 * 自己碰出去的、打出去的都是摆在桌面上的，同样算已经出过。
 * （用户反馈：碰了 2 万，手里 1 万 3 万 卡 2 万，成的就是最后一张 2 万，必须算枯只压。）
 */
export function visibleCount(state: HandState, tile: Tile, excludeSeat: number | null): number {
  let count = 0
  for (const player of state.players) {
    if (excludeSeat !== null && player.seat === excludeSeat) continue
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

/** 大吊车禁打提示：只在该家确实有禁打牌时返回，供界面提示文案使用 */
export function daLiaoCheWarning(state: HandState, seat: number): string | null {
  const forbidden = forbiddenDiscardsFor(state, seat)
  if (!forbidden.length) return null
  return `大吊车禁打：${forbidden.join('、')}（打出算点炮）`
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

/**
 * 自家可杠的牌：手里四张（暗杠）+ 已碰过的牌又摸到第四张（加杠）。
 * 缺门牌不能杠；只在该自己出牌的阶段可用。
 */
export function kongOptionsFor(state: HandState, seat: number): KongOption[] {
  const player = state.players[seat]
  if (state.phase !== 'discard' || state.turn !== seat) return []
  // 碰完必须立即打出一张，不能马上接杠；必须等下一次摸牌后再杠。
  if (!state.drawnTile) return []
  const options: KongOption[] = []
  for (const [tile, count] of countsOf(player.hand)) {
    if (count >= 4 && !isShortageTile(player, tile)) options.push({ tile, kind: '暗杠' })
  }
  for (const meld of player.melds) {
    if (meld.kind === '碰' && player.hand.includes(meld.tile) && !isShortageTile(player, meld.tile)) {
      options.push({ tile: meld.tile, kind: '加杠' })
    }
  }
  return options
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
    const actions: RoundAction[] = []
    // 只有刚摸到牌（含杠后补牌）才能成牌；碰完必须打牌
    if (state.drawnTile && canWinHand(state, seat)) actions.push({ type: 'win', seat })
    for (const option of kongOptionsFor(state, seat)) {
      actions.push({ type: 'kong', seat, tile: option.tile, kind: option.kind })
    }
    for (const tile of legalDiscards(state, seat)) actions.push({ type: 'discard', seat, tile })
    return actions
  }
  if (state.phase === 'claim') {
    if (state.pendingClaims[0] !== seat || !state.lastDiscard) return []
    const options = claimOptionsFor(state, seat, state.lastDiscard.tile)
    const actions: RoundAction[] = options.map(claim => ({ type: 'claim', seat, claim }) as RoundAction)
    actions.push({ type: 'pass', seat })
    return actions
  }
  if (state.phase === 'rob-kong') {
    if (state.robKong?.pending[0] !== seat) return []
    return [
      { type: 'win', seat, robKong: true },
      { type: 'pass', seat }
    ]
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
    robKong: state.robKong ? { ...state.robKong, pending: [...state.robKong.pending] } : null,
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
      const threeToOne = threeToOneOf(next)
      next.threeToOneSeat = threeToOne?.seat ?? null
      next.threeToOneSuit = threeToOne?.suit ?? null
      if (threeToOne) {
        next.logs.push(`${threeToOne.seat} 号位三打一，翻开${threeToOne.suit}子`)
      }
    }
    return next
  }

  if (action.type === 'draw') {
    if (next.phase !== 'draw' || next.turn !== action.seat) throw new Error('当前不能摸牌')
    // 东家首巡：发牌时已经多拿一张（3n+2），这一巡不摸牌，直接出牌。
    // 以前这里照常摸一张，东家就变成 15 张的大相公，永远成不了牌。
    if (player.hand.length % 3 === 2 && !next.drawnTile) {
      next.phase = 'discard'
      next.logs.push(`${action.seat} 号位（东家）首巡直接出牌`)
      return next
    }
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
    if (next.phase === 'rob-kong') {
      const rob = next.robKong
      if (!rob || action.seat !== rob.pending[0] || !action.robKong) throw new Error('当前不能抢杠')
      const kongPlayer = next.players[rob.seat]
      const index = kongPlayer.hand.indexOf(rob.tile)
      if (index >= 0) kongPlayer.hand.splice(index, 1)
      const result = resolveWin(next, action.seat, false, rob.tile, rob.seat, false)
      result.robKong = null
      result.logs.push(`${action.seat} 号位抢杠 ${rob.tile} 成牌`)
      return result
    }
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

  if (action.type === 'kong') {
    if (next.phase !== 'discard' || next.turn !== action.seat) throw new Error('当前不能杠')
    const legal = kongOptionsFor(next, action.seat).some(
      option => option.tile === action.tile && option.kind === action.kind
    )
    if (!legal) throw new Error(`不能${action.kind} ${action.tile}`)
    if (action.kind === '加杠' && beginRobKong(next, action.seat, action.tile)) {
      return next
    }
    if (action.kind === '暗杠') {
      let removed = 0
      for (let i = player.hand.length - 1; i >= 0 && removed < 4; i -= 1) {
        if (player.hand[i] === action.tile) {
          player.hand.splice(i, 1)
          removed += 1
        }
      }
      player.melds.push({ kind: '暗杠', tile: action.tile })
    } else {
      const index = player.hand.indexOf(action.tile)
      if (index >= 0) player.hand.splice(index, 1)
      const meld = player.melds.find(item => item.kind === '碰' && item.tile === action.tile)
      if (meld) meld.kind = '明杠'
    }
    const replacement = takeTailTile(next)
    if (!replacement) {
      next.phase = 'over'
      next.result = 'exhausted'
      next.logs.push('杠后无牌可补，本把流局')
      return next
    }
    player.hand.push(replacement)
    next.drawnTile = replacement
    next.afterKong = true
    next.phase = 'discard'
    next.turn = action.seat
    next.logs.push(`${action.seat} 号位${action.kind} ${action.tile}，补摸 ${replacement}`)
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
    if (next.phase === 'rob-kong') return advanceRobKong(next)
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

/** 加杠后检查是否有人能抢杠；有则挂起等待表态 */
function beginRobKong(state: HandState, kongSeat: number, tile: Tile): boolean {
  const pending: number[] = []
  for (let step = 1; step < SEAT_COUNT; step += 1) {
    const seat = (kongSeat + step) % SEAT_COUNT
    const player = state.players[seat]
    if (isShortageTile(player, tile)) continue
    if (isCompleteHand(state, seat, [...player.hand, tile], tile)) pending.push(seat)
  }
  if (!pending.length) return false
  state.robKong = { seat: kongSeat, tile, pending }
  state.phase = 'rob-kong'
  state.turn = pending[0]
  state.pendingClaims = []
  state.logs.push(`${kongSeat} 号位加杠 ${tile}，等待抢杠`)
  return true
}

/** 抢杠全部过掉后，才真正完成加杠并补牌 */
function finishRobbedKong(state: HandState, kongSeat: number, tile: Tile): HandState {
  const player = state.players[kongSeat]
  const index = player.hand.indexOf(tile)
  if (index >= 0) player.hand.splice(index, 1)
  const meld = player.melds.find(item => item.kind === '碰' && item.tile === tile)
  if (meld) meld.kind = '明杠'
  state.robKong = null
  state.pendingClaims = []

  const replacement = takeTailTile(state)
  if (!replacement) {
    state.phase = 'over'
    state.result = 'exhausted'
    state.logs.push('杠后无牌可补，本把流局')
    return state
  }
  player.hand.push(replacement)
  state.drawnTile = replacement
  state.afterKong = true
  state.phase = 'discard'
  state.turn = kongSeat
  state.logs.push(`${kongSeat} 号位明杠 ${tile}，补摸 ${replacement}`)
  return state
}

function advanceRobKong(state: HandState): HandState {
  const rob = state.robKong
  if (!rob) throw new Error('当前没有抢杠')
  const rest = rob.pending.slice(1)
  if (rest.length) {
    rob.pending = rest
    state.turn = rest[0]
    state.logs.push(`${rest[0]} 号位继续考虑抢杠`)
    return state
  }
  return finishRobbedKong(state, rob.seat, rob.tile)
}

function resolveWin(
  state: HandState,
  seat: number,
  selfDraw: boolean,
  winTile: Tile | null,
  discardSeat: number | null,
  removeDiscard = true
): HandState {
  const player = state.players[seat]

  // 先把手上的成牌张 / 被接走的牌从牌河移除，再统计可见张数
  if (removeDiscard && !selfDraw && winTile && discardSeat !== null) {
    const discarder = state.players[discardSeat]
    const index = discarder.discards.lastIndexOf(winTile)
    if (index >= 0) discarder.discards.splice(index, 1)
  }

  const concealed = selfDraw ? [...player.hand] : winTile ? [...player.hand, winTile] : [...player.hand]
  // 枯只压看「场上最后一张」：自己碰出去 / 打出去的也算已出，所以这里不排除自己
  const visible = winTile ? visibleCount(state, winTile, null) : 0

  // 三打一：三家缺同一门、自己缺另一门（定缺结束时已经标记，老存档则按缺门重算）
  const threeToOne = (state.threeToOneSeat ?? threeToOneOf(state)?.seat ?? null) === seat

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
    // 杠后赛花只认自摸（杠后补摸成牌）：抢杠是接牌，不能继承上一杠的 afterKong
    isAfterKong: state.afterKong && selfDraw,
    threeToOne,
    singlePayer,
    // 大拿规则：一把成牌的点数 ≥ 其他三家剩余点数时，三家全部清零
    opponentsPoints: state.players.filter(item => item.seat !== seat).map(item => item.points)
  })

  state.winner = { seat, selfDraw, score, winTile }
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
 * 亮牌
 * ------------------------------------------------------------------ */

/**
 * 亮牌用的手牌：按牌序排好，成牌张单独放到最后。
 *
 * 接牌成时，成牌张本来就在别人牌河里，不在赢家手上——直接 push 就行。
 * 只有自摸的成牌张已经在手里，才要先拿出来再放到最后。
 * 以前不分自摸/接牌，一律先 `indexOf` 删一张再 push：单吊、对倒这种
 * 等牌正好是手里已有的一张时，会把原有的那张删掉，亮出来永远少一张。
 */
export function revealHandTiles(hand: HandState, seat: number): Tile[] {
  const tiles = [...hand.players[seat].hand]
  const win = hand.winner
  if (win && win.seat === seat && win.winTile) {
    if (win.selfDraw) {
      const index = tiles.indexOf(win.winTile)
      if (index >= 0) tiles.splice(index, 1)
    }
    tiles.sort(tileOrder)
    tiles.push(win.winTile)
    return tiles
  }
  return tiles.sort(tileOrder)
}

/* ------------------------------------------------------------------ *
 * 简易 AI（确定性，便于复现）
 * 出牌启发式：优先清缺门；之后留搭子（对子、相邻张），先弃孤张、
 * 单张字牌、边张。能碰就碰（副露加点、加快成牌）。
 * ------------------------------------------------------------------ */

/** 一张牌留在手里的价值：越低越该打出去 */
function keepValue(hand: Tile[], tile: Tile): number {
  const info = parseTile(tile)
  const rest = [...hand]
  rest.splice(rest.indexOf(tile), 1)
  const copies = rest.filter(item => item === tile).length

  if (info.suit === '字') {
    // 字牌：有搭（对子以上）才留，孤张字牌最没价值
    return copies * 5
  }

  const ranks = rest
    .filter(item => parseTile(item).suit === info.suit)
    .map(item => parseTile(item).rank)
  const nearest = ranks.length ? Math.min(...ranks.map(rank => Math.abs(rank - info.rank))) : 9
  // 对子/刻子潜质 + 靠张潜质；中张（4-6）更容易进顺子
  const middleBonus = info.rank >= 4 && info.rank <= 6 ? 0.5 : 0
  return copies * 4 + (nearest === 0 ? 0 : nearest === 1 ? 2.5 : nearest === 2 ? 1 : 0) + middleBonus
}

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
  if (state.phase === 'rob-kong') {
    return actions.find(action => action.type === 'win') ?? { type: 'pass', seat }
  }
  if (state.phase === 'claim') {
    const win = actions.find(action => action.type === 'claim' && action.claim === '成')
    if (win) return win
    // 简单策略：能杠就杠，能碰就碰（副露记点、加快成牌），否则过
    const kong = actions.find(action => action.type === 'claim' && action.claim === '杠')
    if (kong) return kong
    const peng = actions.find(action => action.type === 'claim' && action.claim === '碰')
    if (peng) return peng
    return { type: 'pass', seat }
  }
  if (state.phase === 'discard') {
    const win = actions.find(action => action.type === 'win')
    if (win) return win
    const kong = actions.find(action => action.type === 'kong')
    if (kong) return kong
    const discards = actions.filter(
      (action): action is Extract<RoundAction, { type: 'discard' }> => action.type === 'discard'
    )
    if (!discards.length) return null
    const shortage = shortageTiles(player)
    const pool = shortage.length ? discards.filter(action => isShortageTile(player, action.tile)) : discards
    const candidates = pool.length ? pool : discards
    // 剩一张时没得选；多张时留价值最低的打出去（确定性：同分取先）
    if (candidates.length === 1) return candidates[0]
    return candidates.reduce((best, action) =>
      keepValue(player.hand, action.tile) < keepValue(player.hand, best.tile) ? action : best
    )
  }
  return null
}
