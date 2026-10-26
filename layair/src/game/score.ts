/**
 * 倒子麻将 · 结算引擎
 *
 * 独立、无依赖、纯函数的规则模块：输入一手成牌（手牌 + 副露 + 成牌上下文），
 * 输出点数明细、大拿判定、摸子数量与金额结算。
 *
 * 规则来源与口径见 `docs/倒子麻将-规则与结算.md`；术语见 `CONTEXT.md`。
 * 凡规则尚未与用户确认一致的地方，都在 `Rules` 配置里显式暴露，并标 `待确认`。
 */

/* ------------------------------------------------------------------ *
 * 1. 牌
 * ------------------------------------------------------------------ */

export const HONORS = ['东', '南', '西', '北', '中', '发', '白'] as const
export const NUMBER_SUITS = ['万', '筒', '条'] as const

export type Honor = (typeof HONORS)[number]
export type NumberSuit = (typeof NUMBER_SUITS)[number]
export type Suit = NumberSuit | '字'
/** 牌面字串：`1万`…`9万` / `1筒`… / `1条`… / `东`…`白` */
export type Tile = string

export interface TileInfo {
  tile: Tile
  suit: Suit
  rank: number
}

const TILE_RE = /^([1-9])([万筒条])$/

export function parseTile(tile: Tile): TileInfo {
  const honor = HONORS.indexOf(tile as Honor)
  if (honor >= 0) return { tile, suit: '字', rank: honor + 1 }
  const matched = TILE_RE.exec(tile)
  if (!matched) throw new Error(`非法牌面: ${tile}`)
  return { tile, suit: matched[2] as NumberSuit, rank: Number(matched[1]) }
}

export function isHonor(tile: Tile): boolean {
  return parseTile(tile).suit === '字'
}

/** 取某门某个数字的牌面 */
export function tileOf(suit: NumberSuit, rank: number): Tile {
  return `${rank}${suit}`
}

/** 生成某门的 1–9 牌面 */
export function suitTiles(suit: NumberSuit, ranks?: number[]): Tile[] {
  return (ranks ?? [1, 2, 3, 4, 5, 6, 7, 8, 9]).map(rank => tileOf(suit, rank))
}

export function tileOrder(a: Tile, b: Tile): number {
  const ia = parseTile(a)
  const ib = parseTile(b)
  const sa = ia.suit === '字' ? 3 : NUMBER_SUITS.indexOf(ia.suit)
  const sb = ib.suit === '字' ? 3 : NUMBER_SUITS.indexOf(ib.suit)
  return sa - sb || ia.rank - ib.rank
}

export function countsOf(tiles: Tile[]): Map<Tile, number> {
  const result = new Map<Tile, number>()
  for (const tile of tiles) result.set(tile, (result.get(tile) ?? 0) + 1)
  return result
}

/* ------------------------------------------------------------------ *
 * 2. 副露
 * ------------------------------------------------------------------ */

export type MeldKind = '碰' | '明杠' | '暗杠'

export interface Meld {
  kind: MeldKind
  tile: Tile
}

export const MELD_TILE_COUNT: Record<MeldKind, number> = {
  碰: 3,
  明杠: 4,
  暗杠: 4
}

export const isKong = (meld: Meld): boolean => meld.kind === '明杠' || meld.kind === '暗杠'

/** 副露的牌面展开成实际张数 */
export function meldTiles(meld: Meld): Tile[] {
  return Array.from({ length: MELD_TILE_COUNT[meld.kind] }, () => meld.tile)
}

/** 全部牌（手牌 + 副露展开） */
export function allTiles(concealed: Tile[], melds: Meld[]): Tile[] {
  return [...concealed, ...melds.flatMap(meldTiles)]
}

/* ------------------------------------------------------------------ *
 * 3. 规则配置
 * ------------------------------------------------------------------ */

export interface Rules {
  /** 任何成牌都有的底点 */
  basePoints: number
  /** 自家三张（暗刻） */
  concealedTripletPoints: number
  /** 碰（明刻） */
  pungPoints: number
  /** 杠（明杠 / 暗杠同分） */
  kongPoints: number
  /** 只子：同一门 ≥ min 张后每多一张加点，上限 max */
  zhizi: { min: number; max: number }
  /** 通：同一数字跨花色 ≥ min 张，按张数加点，上限 max */
  tong: { min: number; max: number }
  /** 加点子分值 */
  patternPoints: {
    压当: number
    单吊: number
    小连号: number
    大连号: number
    棒棒: number
    四活: number
    不动手: number
    草一色: number
    对对胡: number
    七对: number
    大吊车: number
    老小对: number
    三打一: number
    杠开: number
    /** 枯只压：压当且成牌张是场上最后一张（整十的 20 点，压当那 1 点另算） */
    枯只压: number
    /** 三大坎：三组刻子/杠（数字牌、字牌都算） */
    三大坎: number
  }
  /** 大拿：直接命中即大拿的牌型名 */
  bigWinPatterns: string[]
  /** 大拿：两个大牌型（点数）同时命中即大拿，如 [31, 10] */
  bigWinPairs: Array<[number, number]>
  /** 大拿：一把成牌把其他三家的点数全部清零即大拿（需要传入各家剩余点数） */
  bigWinZeroesOpponents: boolean
  /** 大拿每家支付金额（元） */
  bigWinMoneyPerPlayer: number
  /** 普通成牌：每 1 点折合金额（元） */
  pointYuan: number
  /** 摸子金额（元） */
  moziYuan: { big: number; small: number }
  /** 杠开本身视作自摸，本牌点数按其翻倍（默认是） */
  kongOpenCountsAsSelfDraw: boolean
  /** 杠开是否在自摸翻倍之外「再」翻一倍（计算器里杠开自带 ×2，因此默认否） 待确认 */
  kongOpenDoublesPoints: boolean
  /** 杠后赛花：摸子总额翻倍 */
  kongOpenDoublesMozi: boolean
  /** 杠开是否额外计 1 个大摸子（计算器口径为是，用户口述为否）待确认 */
  kongOpenAddsBigMozi: boolean
  /** 暗杠是否算「不动手」：暗杠不算碰过/杠过牌，算不动手（用户确认） */
  anGangCountsAsBuDongShou: boolean
  /** 枯只压摸子：接牌 / 自摸 */
  kuZhiYaMozi: { deal: number; selfDraw: number }
  /** 清水（首牌大拿）额外摸子：1 个大摸子 + 1 个小摸子 = 1.5（用户确认） */
  qingShuiMozi: number
  /** 清一色自带摸子（用户确认 1 个大摸子，和自摸/压当叠加） */
  qingYiSeMozi: number
  /** 只子是否把副露张数算进该门张数 */
  zhiziIncludesMelds: boolean
  /** 老小对：同花色 1 和 9 都成坎（至少 3 张，碰/杠也算，不能被顺子拆用） */
  laoXiaoDuiEnabled: boolean
  /** 双连号逢2加1：≥2 门小连号时每 2 门加 1 门小连号的分（用户确认） */
  doubleRunBonusEnabled: boolean
}

export const DEFAULT_RULES: Rules = {
  basePoints: 4,
  concealedTripletPoints: 2,
  pungPoints: 1,
  kongPoints: 2,
  zhizi: { min: 8, max: 5 },
  tong: { min: 5, max: 8 },
  patternPoints: {
    压当: 1,
    单吊: 1,
    小连号: 5,
    大连号: 20,
    棒棒: 5,
    四活: 10,
    不动手: 5,
    草一色: 10,
    对对胡: 10,
    七对: 30,
    大吊车: 30,
    老小对: 5,
    三打一: 5,
    杠开: 5,
    枯只压: 20,
    三大坎: 10
  },
  // 七对本身不是大拿，七对 + 四活 由 bigWinPairs（30 + 10）触发；双连号、双杠已不再是大拿
  bigWinPatterns: [
    '清一色',
    '双棒棒',
    '双通',
    '双四活',
    '一一九',
    '三杠',
    '三大坎+同门2张',
    '乱分',
    '自摸大连号',
    '大吊车'
  ],
  bigWinPairs: [[30, 10]],
  bigWinZeroesOpponents: true,
  bigWinMoneyPerPlayer: 40,
  pointYuan: 0.5,
  moziYuan: { big: 10, small: 5 },
  kongOpenCountsAsSelfDraw: true,
  kongOpenDoublesPoints: false,
  kongOpenDoublesMozi: true,
  kongOpenAddsBigMozi: false,
  anGangCountsAsBuDongShou: true,
  kuZhiYaMozi: { deal: 1, selfDraw: 3 },
  qingShuiMozi: 1.5,
  qingYiSeMozi: 1,
  zhiziIncludesMelds: true,
  laoXiaoDuiEnabled: true,
  doubleRunBonusEnabled: true
}

/** 结算范围内的成牌上下文 */
export interface ScoreInput {
  /** 手牌（不含副露），成牌时应为 3n+2 张 */
  concealed: Tile[]
  /** 副露 */
  melds?: Meld[]
  /** 成牌张；不传则不判定压当 / 单吊 / 大吊车这类与成牌张相关的规则 */
  winTile?: Tile | null
  /** 是否自摸 */
  selfDraw?: boolean
  /** 成牌张在别家已公开出现的张数（用于枯只压） */
  visibleWinTileCount?: number
  /** 是否首牌（用于清水） */
  isFirstHand?: boolean
  /** 是否杠开 / 杠后赛花（杠后补摸成牌） */
  isAfterKong?: boolean
  /** 三打一：三家缺同一门、自己明牌成牌 */
  threeToOne?: boolean
  /** 其他三家当前剩余点数（用于「吸光三家点数即大拿」） */
  opponentsPoints?: number[]
  /**
   * 由一人承担三家的金额。大吊车被禁打点炮时，打出禁牌的人要付三家的大拿钱。
   */
  singlePayer?: boolean
  /** 显式禁用某些加点子（回归基线用，例如只验证基础口径时禁用不动手等） */
  disabledPatterns?: string[]
  /** 覆盖规则配置 */
  rules?: Partial<Rules>
}

export interface ScoreItem {
  name: string
  points: number
  count: number
  detail: string
}

export interface MoziItem {
  name: string
  /** 以「大摸子」为 1 单位，小摸子为 0.5 */
  units: number
  detail: string
}

export interface BigWinReason {
  name: string
  detail: string
}

export interface ScoreResult {
  /** 是否构成合法成牌结构 */
  isWinningHand: boolean
  problems: string[]
  /** 命中的牌型 -> 是否命中（用于调试与 UI） */
  patterns: Record<string, boolean>
  points: {
    base: number
    items: ScoreItem[]
    subtotal: number
    multipliers: number[]
    multiplier: number
    total: number
  }
  bigWin: {
    isBigWin: boolean
    reasons: BigWinReason[]
  }
  mozi: {
    items: MoziItem[]
    units: number
    multiplier: number
    big: number
    small: number
    money: number
  }
  money: {
    /** 普通点数折算：每家应付 */
    pointMoneyPerOpponent: number
    /** 摸子：每家应付 */
    moziMoneyPerOpponent: number
    /** 大拿：每家应付 */
    bigWinMoneyPerOpponent: number
    /** 每家应付合计（一份） */
    perOpponentTotal: number
    /** 份数，固定 3 份 */
    shares: number
    /** 需要付款的人数：正常 3；大吊车被禁打点炮时由一人承担 → 1 */
    payerCount: number
    /** 每位付款者实际支付：正常等于一份，单人承担时为三份 */
    amountPerPayer: number
    /** 本牌赢家收到的总金额 */
    total: number
  }
  details: string[]
}

/* ------------------------------------------------------------------ *
 * 4. 成牌结构
 * ------------------------------------------------------------------ */

export interface Decomposition {
  sets: Array<{ kind: 'run' | 'triplet'; tiles: Tile[] }>
  pair: Tile[]
}

const MAX_DECOMPOSITIONS = 60

/** 把一组手牌拆成若干面子 + 一个将 */
export function decompose(counts: Map<Tile, number>): Decomposition[] {
  const results: Decomposition[] = []
  const work = new Map(counts)

  const rec = (pairUsed: boolean, sets: Decomposition['sets'], pair: Tile[], depth: number) => {
    if (results.length >= MAX_DECOMPOSITIONS || depth > 16) return
    const remaining = [...work.entries()].filter(([, n]) => n > 0).map(([tile]) => tile)
    if (!remaining.length) {
      if (pairUsed) results.push({ sets: sets.map(s => ({ kind: s.kind, tiles: [...s.tiles] })), pair: [...pair] })
      return
    }
    const first = remaining.sort(tileOrder)[0]
    const n = work.get(first) ?? 0
    const info = parseTile(first)

    if (n >= 3) {
      work.set(first, n - 3)
      sets.push({ kind: 'triplet', tiles: [first, first, first] })
      rec(pairUsed, sets, pair, depth + 1)
      sets.pop()
      work.set(first, n)
    }

    if (info.suit !== '字' && info.rank <= 7) {
      const second = tileOf(info.suit, info.rank + 1)
      const third = tileOf(info.suit, info.rank + 2)
      if ((work.get(second) ?? 0) > 0 && (work.get(third) ?? 0) > 0) {
        work.set(first, n - 1)
        work.set(second, (work.get(second) ?? 0) - 1)
        work.set(third, (work.get(third) ?? 0) - 1)
        sets.push({ kind: 'run', tiles: [first, second, third] })
        rec(pairUsed, sets, pair, depth + 1)
        sets.pop()
        work.set(first, n)
        work.set(second, (work.get(second) ?? 0) + 1)
        work.set(third, (work.get(third) ?? 0) + 1)
      }
    }

    if (!pairUsed && n >= 2) {
      work.set(first, n - 2)
      rec(true, sets, [first, first], depth + 1)
      work.set(first, n)
    }
  }

  rec(false, [], [], 0)
  return results
}

/** 全部 34 种牌面 */
const ALL_TILES: Tile[] = [...NUMBER_SUITS.flatMap(suit => suitTiles(suit)), ...HONORS]

/** 加进这一张后能不能成牌（4 组面子 + 1 对将，或七对） */
function isWinningWith(concealed: Tile[], melds: Meld[]): boolean {
  if (isSevenPairs(concealed, melds)) return true
  const needSets = 4 - melds.length
  return decompose(countsOf(concealed)).some(d => d.sets.length === needSets)
}

/**
 * 理论听口：13 张手牌（成牌张已拿走）还能成哪些牌。
 * 单吊 / 压当都要求「纯理论上只能成这一只」——两面听（23 等 1、4）有两种成牌张，不算。
 * 手里或副露已经有 4 张的牌不可能再成，跳过。
 */
function winTilesOf(concealed: Tile[], melds: Meld[]): Tile[] {
  const used = countsOf(allTiles(concealed, melds))
  const waits: Tile[] = []
  for (const tile of ALL_TILES) {
    if ((used.get(tile) ?? 0) >= 4) continue
    if (isWinningWith([...concealed, tile], melds)) waits.push(tile)
  }
  return waits
}

function isSevenPairs(concealed: Tile[], melds: Meld[]): boolean {
  if (melds.length || concealed.length !== 14) return false
  const counts = countsOf(concealed)
  const values = [...counts.values()]
  // 四张相同算两对，因此 1111 + 五对 也是七对（这正是「七对 + 四活」能同时成立的前提）
  return values.length > 0 && values.length <= 7 && values.every(n => n % 2 === 0)
}

/**
 * 某一种拆解里，这一门的 1 / 9 是不是一个刻子。
 * 老小对要求至少 3 张成坎，且不能被顺子拆用——11123 拆成 123 + 11 就没有 1 的刻子。
 */
function decompHasTriplet(decomp: Decomposition, suit: NumberSuit, rank: number): boolean {
  return decomp.sets.some(
    set =>
      set.kind === 'triplet' &&
      set.tiles.every(tile => {
        const info = parseTile(tile)
        return info.suit === suit && info.rank === rank
      })
  )
}

/* ------------------------------------------------------------------ *
 * 5. 各类牌型识别
 * ------------------------------------------------------------------ */

interface HandAnalysis {
  counts: Map<Tile, number>
  /** 每门数字花色的实际张数（含副露，取决于配置） */
  suitCounts: Record<NumberSuit, number>
  /** 每个数字跨万/筒/条的合计张数与门数 */
  rankCounts: Map<number, { count: number; suits: Set<NumberSuit> }>
  triplets: number
  kongs: number
  pungs: number
  runs: number
  /** 每门刻子/杠的组数（用于「三大坎 + 同门 2 张」） */
  tripletSuits: Map<Suit, number>
  /** 每门刻子/杠的数字（数字牌要判断「连着」，字牌不计） */
  tripletRanks: Map<Suit, number[]>
  /** 所有刻子/杠的牌面（判断「中发白」三坎用） */
  tripletTiles: Tile[]
  /** 将牌所在的花色 */
  pairSuit: Suit | null
  isAllTriplets: boolean
  isSevenPairs: boolean
  /** 有 4 张相同（未开杠）的牌面 */
  fourOfAKind: Tile[]
  /** 每门连续对子（棒棒） */
  bangBangSuits: NumberSuit[]
  /** 每门小连号 */
  smallRuns: NumberSuit[]
  /** 每门大连号 */
  bigRuns: NumberSuit[]
  /** 每门只子点数 */
  zhiziPoints: Record<NumberSuit, number>
  /** 每个数字的通点数 */
  tongPoints: Array<{ rank: number; points: number; count: number }>
  /** 每门数字花色里每个数字的实际张数（含副露） */
  perSuitRankCounts: Record<NumberSuit, Map<number, number>>
  /** 命中老小对的花色（同门 1、9 都成坎） */
  laoXiaoDuiSuit: NumberSuit | null
  numberSuitsInHand: Set<NumberSuit>
  hasHonor: boolean
  isAllHonors: boolean
  isOnlyOneNineAndHonors: boolean
  isFlush: boolean
  isGrassOneColor: boolean
  isBuDongShou: boolean
  winTileRole: 'pair' | 'middle' | 'edge' | 'none'
  /** 成牌张是「只能等这一张」的边张/卡张（12 等 3、89 等 7、46 等 5） */
  winTileOnlyWait: boolean
}

function analyze(input: ScoreInput, rules: Rules): HandAnalysis {
  const concealed = input.concealed
  const melds = input.melds ?? []
  const concealedCounts = countsOf(concealed)
  const everyTile = allTiles(concealed, melds)
  const counts = countsOf(everyTile)

  const suitCounts: Record<NumberSuit, number> = { 万: 0, 筒: 0, 条: 0 }
  const perSuitRankCounts: Record<NumberSuit, Map<number, number>> = {
    万: new Map(),
    筒: new Map(),
    条: new Map()
  }
  const rankCounts = new Map<number, { count: number; suits: Set<NumberSuit> }>()
  let hasHonor = false
  for (const tile of everyTile) {
    const info = parseTile(tile)
    if (info.suit === '字') {
      hasHonor = true
      continue
    }
    suitCounts[info.suit] += 1
    const suitRanks = perSuitRankCounts[info.suit]
    suitRanks.set(info.rank, (suitRanks.get(info.rank) ?? 0) + 1)
    const entry = rankCounts.get(info.rank) ?? { count: 0, suits: new Set<NumberSuit>() }
    entry.count += 1
    entry.suits.add(info.suit)
    rankCounts.set(info.rank, entry)
  }
  if (!rules.zhiziIncludesMelds) {
    // 只子只数手上的牌时，扣掉副露张数
    for (const meld of melds) {
      const info = parseTile(meld.tile)
      if (info.suit !== '字') suitCounts[info.suit] -= MELD_TILE_COUNT[meld.kind]
    }
  }

  const needSets = 4 - melds.length
  const decomp = decompose(concealedCounts).filter(d => d.sets.length === needSets)
  const valid = decomp[0] ?? null

  const triplets = melds.length + (valid ? valid.sets.filter(s => s.kind === 'triplet').length : 0)
  const runs = valid ? valid.sets.filter(s => s.kind === 'run').length : 0
  const pungs = melds.filter(m => m.kind === '碰').length
  const kongs = melds.filter(isKong).length

  const tripletSuits = new Map<Suit, number>()
  const tripletRanks = new Map<Suit, number[]>()
  const tripletTiles: Tile[] = []
  const bumpTriplet = (tile: Tile) => {
    const info = parseTile(tile)
    tripletTiles.push(tile)
    tripletSuits.set(info.suit, (tripletSuits.get(info.suit) ?? 0) + 1)
    if (info.suit !== '字') {
      const ranks = tripletRanks.get(info.suit) ?? []
      ranks.push(info.rank)
      tripletRanks.set(info.suit, ranks)
    }
  }
  for (const meld of melds) bumpTriplet(meld.tile)
  if (valid) {
    for (const set of valid.sets) {
      if (set.kind === 'triplet') bumpTriplet(set.tiles[0])
    }
  }

  const isAllTriplets = !!valid && valid.sets.every(s => s.kind === 'triplet')

  // 四活：四张相同且没开杠。碰出的三张 + 手里第 4 张也算（例：碰 5 条 + 567 条里的 5 条）。
  // 明杠/暗杠的四张已经开杠，不算四活。
  const kongedTiles = new Set(melds.filter(isKong).map(meld => meld.tile))
  const fourOfAKind = [...counts.entries()]
    .filter(([tile, n]) => n === 4 && !kongedTiles.has(tile))
    .map(([tile]) => tile)

  const bangBangSuits: NumberSuit[] = []
  const smallRuns: NumberSuit[] = []
  const bigRuns: NumberSuit[] = []
  const zhiziPoints: Record<NumberSuit, number> = { 万: 0, 筒: 0, 条: 0 }
  const numberSuitsInHand = new Set<NumberSuit>()

  for (const suit of NUMBER_SUITS) {
    // 这一门整手（含副露）有没有牌——清一色/草一色按整手算
    const present = [...counts.keys()].some(tile => parseTile(tile).suit === suit)
    if (present) numberSuitsInHand.add(suit)

    if (suitCounts[suit] >= rules.zhizi.min) {
      zhiziPoints[suit] = Math.min(suitCounts[suit] - (rules.zhizi.min - 1), rules.zhizi.max)
    }

    // 连号只看**手上**的牌：副露已经亮在桌上，不参与「连续六张」。
    // 否则 234456 + 碰 7 万 会被拼成 2–7，看着像连号，其实手上根本没有六连。
    const ranks = new Set<number>()
    for (const [tile, n] of concealedCounts) {
      const info = parseTile(tile)
      if (info.suit !== suit || n <= 0) continue
      ranks.add(info.rank)
    }
    if (!ranks.size) continue

    const allNine = suitTiles(suit).every(tile => ranks.has(parseTile(tile).rank))
    if (allNine) bigRuns.push(suit)
    else {
      for (let start = 1; start <= 4; start++) {
        if ([0, 1, 2, 3, 4, 5].every(offset => ranks.has(start + offset))) {
          smallRuns.push(suit)
          break
        }
      }
    }

    const pairRanks = new Set<number>()
    for (const [tile, n] of counts) {
      const info = parseTile(tile)
      if (info.suit === suit && n >= 2) pairRanks.add(info.rank)
    }
    for (let start = 1; start <= 7; start++) {
      if ([0, 1, 2].every(offset => pairRanks.has(start + offset))) {
        bangBangSuits.push(suit)
        break
      }
    }
  }

  const tongPoints: HandAnalysis['tongPoints'] = []
  for (const [rank, entry] of [...rankCounts.entries()].sort((a, b) => a[0] - b[0])) {
    if (entry.count >= rules.tong.min && entry.suits.size >= 2) {
      tongPoints.push({ rank, count: entry.count, points: Math.min(entry.count, rules.tong.max) })
    }
  }

  const isAllHonors = everyTile.length > 0 && everyTile.every(tile => isHonor(tile))
  const isOnlyOneNineAndHonors = everyTile.every(tile => {
    const info = parseTile(tile)
    return info.suit === '字' || info.rank === 1 || info.rank === 9
  })
  const isFlush = numberSuitsInHand.size === 1 && !hasHonor && everyTile.length > 0
  const isGrassOneColor = numberSuitsInHand.size === 1 && hasHonor

  let isBuDongShou = melds.length === 0
  if (!isBuDongShou && rules.anGangCountsAsBuDongShou) {
    isBuDongShou = melds.every(m => m.kind === '暗杠')
  }

  // 成牌张在拆解中的角色：将牌（单吊）、顺子中张（压当·卡张）或顺子边张（压当·边张）
  let winTileRole: HandAnalysis['winTileRole'] = 'none'
  const winTile = input.winTile ?? null
  if (winTile) {
    for (const d of decomp) {
      if (d.pair.length === 2 && d.pair[0] === winTile) {
        winTileRole = 'pair'
        break
      }
      for (const set of d.sets) {
        if (set.kind !== 'run') continue
        const index = set.tiles.indexOf(winTile)
        if (index < 0) continue
        const ranks = set.tiles.map(tile => parseTile(tile).rank)
        if (index === 1) {
          // 卡张：成牌张补顺子中间
          winTileRole = 'middle'
        } else if (index === 2 && ranks[0] === 1 && winTileRole === 'none') {
          // 12 等 3：边张
          winTileRole = 'edge'
        } else if (index === 0 && ranks[2] === 9 && winTileRole === 'none') {
          // 89 等 7：边张
          winTileRole = 'edge'
        }
      }
      if (winTileRole === 'middle') break
    }
  }

  // 理论听口：单吊 / 压当都只在「除了这一只没有别的成牌张」时才算
  let winTileOnlyWait = false
  if (winTile) {
    const rest = [...concealed]
    const index = rest.indexOf(winTile)
    if (index >= 0) rest.splice(index, 1)
    const waits = winTilesOf(rest, melds)
    winTileOnlyWait = waits.length === 1 && waits[0] === winTile
  }

  // 老小对：同一门里 1 和 9 都要成坎（至少 3 张，碰/杠也算），
  // 且不能被顺子拆用——11123 拆成 123 + 11 当将就不算。
  // 1、9 可以一个来自碰/杠、一个来自手里的暗刻，但必须在同一种拆解里成立。
  let laoXiaoDuiSuit: NumberSuit | null = null
  if (rules.laoXiaoDuiEnabled) {
    for (const suit of NUMBER_SUITS) {
      const meldRanks = new Set(
        melds.map(meld => parseTile(meld.tile)).filter(info => info.suit === suit).map(info => info.rank)
      )
      const meldOne = meldRanks.has(1)
      const meldNine = meldRanks.has(9)
      const bothInMelds = meldOne && meldNine
      // 手里的 1、9 必须能在同一种拆解里各自成刻；一个来自碰/杠、一个来自暗刻也可以
      const bothInOneDecomp = decomp.some(
        d => (meldOne || decompHasTriplet(d, suit, 1)) && (meldNine || decompHasTriplet(d, suit, 9))
      )
      if (bothInMelds || bothInOneDecomp) {
        laoXiaoDuiSuit = suit
        break
      }
    }
  }

  return {
    counts,
    suitCounts,
    perSuitRankCounts,
    laoXiaoDuiSuit,
    rankCounts,
    triplets,
    kongs,
    pungs,
    runs,
    tripletSuits,
    tripletRanks,
    tripletTiles,
    pairSuit: valid?.pair.length ? parseTile(valid.pair[0]).suit : null,
    isAllTriplets,
    isSevenPairs: isSevenPairs(concealed, melds),
    fourOfAKind,
    bangBangSuits,
    smallRuns,
    bigRuns,
    zhiziPoints,
    tongPoints,
    numberSuitsInHand,
    hasHonor,
    isAllHonors,
    isOnlyOneNineAndHonors,
    isFlush,
    isGrassOneColor,
    isBuDongShou,
    winTileRole,
    winTileOnlyWait
  }
}

/* ------------------------------------------------------------------ *
 * 6. 主结算
 * ------------------------------------------------------------------ */

function mergeRules(overrides?: Partial<Rules>): Rules {
  if (!overrides) return DEFAULT_RULES
  return {
    ...DEFAULT_RULES,
    ...overrides,
    zhizi: { ...DEFAULT_RULES.zhizi, ...overrides.zhizi },
    tong: { ...DEFAULT_RULES.tong, ...overrides.tong },
    patternPoints: { ...DEFAULT_RULES.patternPoints, ...overrides.patternPoints },
    moziYuan: { ...DEFAULT_RULES.moziYuan, ...overrides.moziYuan },
    kuZhiYaMozi: { ...DEFAULT_RULES.kuZhiYaMozi, ...overrides.kuZhiYaMozi }
  }
}

/** 金额最小单位是 5 元：点数折算的钱四舍五入到 5 元的整数倍，战绩里就不会出现 34.5 这种小数 */
export function roundMoneyToFive(value: number): number {
  return Math.round(value / 5) * 5
}

export function scoreHand(input: ScoreInput): ScoreResult {
  const rules = mergeRules(input.rules)
  const melds = input.melds ?? []
  const disabled = new Set(input.disabledPatterns ?? [])
  const enabled = (name: string) => !disabled.has(name)

  const a = analyze(input, rules)
  const problems: string[] = []

  const needSets = 4 - melds.length
  const structures = decompose(countsOf(input.concealed)).filter(d => d.sets.length === needSets)
  const isWinningHand = a.isSevenPairs || structures.length > 0
  if (!isWinningHand) problems.push('手牌无法拆成 4 组面子 + 1 对将，也不是七对')
  if (melds.length > 4) problems.push('副露数量超过 4 组')

  const items: ScoreItem[] = []
  const patterns: Record<string, boolean> = {}

  // 成牌底点
  items.push({ name: '成牌', points: rules.basePoints, count: 1, detail: '任何成牌的底点' })

  // 对子：自家三张（暗刻）——按成牌结构里真实存在的刻子计算；七对里没有刻子
  const structure = a.isSevenPairs ? null : structures[0]
  const concealedTripletsByTile = new Map<Tile, number>()
  if (structure) {
    for (const set of structure.sets) {
      if (set.kind === 'triplet') {
        concealedTripletsByTile.set(set.tiles[0], (concealedTripletsByTile.get(set.tiles[0]) ?? 0) + 1)
      }
    }
  } else if (!a.isSevenPairs) {
    for (const [tile, n] of countsOf(input.concealed)) {
      if (n >= 3) concealedTripletsByTile.set(tile, 1)
    }
  }

  // 接牌成刻：成牌张是别人打的，这个刻子相当于「借」一张凑成，只能按碰 1 点算。
  // 自摸的成牌张是自己摸进手里的，仍然是暗刻 2 点。
  let borrowedTripletTile: Tile | null = null
  if (!input.selfDraw && input.winTile && a.winTileRole !== 'pair' && structure) {
    for (const set of structure.sets) {
      if (set.kind === 'triplet' && set.tiles.includes(input.winTile)) {
        borrowedTripletTile = set.tiles[0]
        break
      }
    }
  }

  let concealedTriplets = 0
  for (const [tile, sets] of concealedTripletsByTile) {
    concealedTriplets += sets
    const borrowed = borrowedTripletTile === tile ? 1 : 0
    const concealedSets = sets - borrowed
    if (concealedSets > 0) {
      items.push({
        name: '自家三张',
        points: rules.concealedTripletPoints * concealedSets,
        count: concealedSets,
        detail: `${tile} 暗刻${concealedSets > 1 ? ` ×${concealedSets}` : ''}`
      })
    }
  }
  if (borrowedTripletTile) {
    items.push({
      name: '碰',
      points: rules.pungPoints,
      count: 1,
      detail: `借牌 ${borrowedTripletTile}（接牌成刻）`
    })
  }
  for (const meld of melds) {
    if (meld.kind === '碰') {
      items.push({ name: '碰', points: rules.pungPoints, count: 1, detail: `明碰 ${meld.tile}` })
    } else {
      items.push({ name: '杠', points: rules.kongPoints, count: 1, detail: `${meld.kind} ${meld.tile}` })
    }
  }

  // 三大坎：同一门里三组刻子/杠（暗刻、碰、杠都算）。
  // 数字牌要求三组坎的数字连着（333万 444万 555万）；字牌没有顺序，任意三组字坎都算。
  if (isSanDaKan(a) && enabled('三大坎')) {
    patterns['三大坎'] = true
    items.push({
      name: '三大坎',
      points: rules.patternPoints.三大坎,
      count: 1,
      detail: '同一门三组刻子/杠（数字牌要连着，字牌任意三组）'
    })
  }

  // 只子
  for (const suit of NUMBER_SUITS) {
    const points = a.zhiziPoints[suit]
    if (points > 0) {
      items.push({
        name: '只子',
        points,
        count: 1,
        detail: `${suit} 共 ${a.suitCounts[suit]} 张（超过 ${rules.zhizi.min - 1} 张，每张 1 点，上限 ${rules.zhizi.max}）`
      })
    }
  }

  // 通
  for (const tong of a.tongPoints) {
    items.push({
      name: '通',
      points: tong.points,
      count: 1,
      detail: `${tong.rank} 共 ${tong.count} 张跨 ${a.rankCounts.get(tong.rank)?.suits.size ?? 0} 门`
    })
  }

  // 连号
  for (const suit of a.bigRuns) {
    items.push({ name: '大连号', points: rules.patternPoints.大连号, count: 1, detail: `${suit} 1–9 齐张` })
  }
  for (const suit of a.smallRuns) {
    items.push({ name: '小连号', points: rules.patternPoints.小连号, count: 1, detail: `${suit} 连续六张` })
  }

  // 双连号：≥2 门小连号时「逢2加1」——每 2 门小连号多计 1 门小连号的分（用户确认）
  // 例：两门小连号 = 2×5 + 5 = 15 点；典型双连号把总点数抬到 24（底4 + 不动手5 + 15），
  // 有压当或 8 只再 +1 到 25；成牌张是字牌（无压当）则停在 24。
  if (rules.doubleRunBonusEnabled && enabled('双连号') && a.smallRuns.length >= 2) {
    const bonusUnits = Math.floor(a.smallRuns.length / 2)
    patterns['双连号'] = true
    items.push({
      name: '双连号',
      points: bonusUnits * rules.patternPoints.小连号,
      count: bonusUnits,
      detail: `${a.smallRuns.join('、')} 共 ${a.smallRuns.length} 门小连号，逢2加1 ×${bonusUnits}`
    })
  }

  // 棒棒
  for (const suit of a.bangBangSuits) {
    if (!enabled('棒棒')) break
    items.push({ name: '棒棒', points: rules.patternPoints.棒棒, count: 1, detail: `${suit} 连续三组对子` })
  }

  // 四活
  if (enabled('四活')) {
    for (const tile of a.fourOfAKind) {
      items.push({ name: '四活', points: rules.patternPoints.四活, count: 1, detail: `${tile} 四张未开杠` })
    }
  }

  // 不动手
  if (enabled('不动手') && a.isBuDongShou) {
    items.push({ name: '不动手', points: rules.patternPoints.不动手, count: 1, detail: '没有碰、杠' })
  }

  // 草一色 / 清一色
  if (a.isGrassOneColor && enabled('草一色')) {
    items.push({
      name: '草一色',
      points: rules.patternPoints.草一色,
      count: 1,
      detail: '只有一门数字花色 + 字牌'
    })
  }

  // 对对胡 / 七对 / 大吊车
  if (a.isSevenPairs && enabled('七对')) {
    items.push({ name: '七对', points: rules.patternPoints.七对, count: 1, detail: '七个对子' })
  }
  if (a.isAllTriplets && !a.isSevenPairs && enabled('对对胡')) {
    items.push({ name: '对对胡', points: rules.patternPoints.对对胡, count: 1, detail: '全刻子 + 一对将' })
  }

  const isDaDiaoChe =
    a.isAllTriplets &&
    a.winTileRole === 'pair' &&
    melds.length + concealedTriplets === 4 &&
    enabled('大吊车')
  if (isDaDiaoChe) {
    items.push({ name: '大吊车', points: rules.patternPoints.大吊车, count: 1, detail: '对对胡 + 手把一独单吊' })
  }

  // 压当 / 单吊
  // 都要求「纯理论上只能成这一只」：压当＝补顺子的唯一缺口（卡张/边张），
  // 单吊＝唯一成牌张正好是补将牌。两面听（23 等 1、4）两种都能成，不算。
  const isYaDang = a.winTileOnlyWait && (a.winTileRole === 'middle' || a.winTileRole === 'edge')
  const isDanDiao = a.winTileOnlyWait && a.winTileRole === 'pair'
  // 枯只压 = 压当 + 成牌张是场上最后一张（另外三张都已亮在桌上）。
  // 点数 = 牌型 20 点（整十）+ 压当那 1 点；自摸 ×2 后最小一手
  // (4 + 20 + 1) × 2 = 50 点，正好压到大拿线。
  const isKuZhiYa = isYaDang && (input.visibleWinTileCount ?? 0) >= 3
  if (isYaDang) patterns['压当'] = true
  if (isDanDiao) patterns['单吊'] = true
  if (isYaDang && enabled('压当')) {
    items.push({
      name: '压当',
      points: rules.patternPoints.压当,
      count: 1,
      detail: a.winTileRole === 'edge' ? '成牌张补顺子边张' : '成牌张补顺子中张'
    })
  }
  if (isDanDiao && enabled('单吊')) {
    items.push({ name: '单吊', points: rules.patternPoints.单吊, count: 1, detail: '成牌张补将牌' })
  }
  if (isKuZhiYa && enabled('枯只压')) {
    items.push({
      name: '枯只压',
      points: rules.patternPoints.枯只压,
      count: 1,
      detail: '只等这一张，且该牌另外三张都已亮在桌上'
    })
  }

  // 老小对：同一门里 1 和 9 都成坎
  if (enabled('老小对') && a.laoXiaoDuiSuit) {
    items.push({
      name: '老小对',
      points: rules.patternPoints.老小对,
      count: 1,
      detail: `${a.laoXiaoDuiSuit} 有 1、9 的刻子`
    })
  }

  // 三打一
  if (input.threeToOne && enabled('三打一')) {
    items.push({ name: '三打一', points: rules.patternPoints.三打一, count: 1, detail: '三家缺同一门，明牌成牌' })
  }

  // 杠开
  if (input.isAfterKong && enabled('杠开')) {
    items.push({ name: '杠开', points: rules.patternPoints.杠开, count: 1, detail: '杠后补摸成牌' })
  }

  const subtotal = items.reduce((sum, item) => sum + item.points, 0)

  // 倍数：自摸翻倍；杠开按自摸处理（计算器里杠开的 ×2 就是自摸翻倍）
  const multipliers: number[] = []
  if (input.selfDraw || (input.isAfterKong && rules.kongOpenCountsAsSelfDraw)) multipliers.push(2)
  if (input.isAfterKong && rules.kongOpenDoublesPoints) multipliers.push(2)
  const multiplier = multipliers.reduce((product, value) => product * value, 1)
  const total = subtotal * multiplier

  // —— 大拿 ——
  const bigWinReasons: BigWinReason[] = []
  const patternFlags: Record<string, boolean> = {
    清一色: a.isFlush,
    七对: a.isSevenPairs,
    双棒棒: a.bangBangSuits.length >= 2,
    双通: a.tongPoints.length >= 2,
    双四活: a.fourOfAKind.length >= 2,
    一一九: a.isOnlyOneNineAndHonors,
    三杠: a.kongs >= 3,
    '三大坎+同门2张': hasThreeBigKans(a),
    乱分: a.isAllHonors,
    自摸大连号: !!input.selfDraw && a.bigRuns.length >= 1,
    大吊车: isDaDiaoChe
  }
  Object.assign(patterns, patternFlags)

  for (const name of rules.bigWinPatterns) {
    if (patternFlags[name]) bigWinReasons.push({ name, detail: `命中大拿牌型「${name}」` })
  }
  const itemPoints = new Set(items.map(item => item.points))
  for (const [a1, b1] of rules.bigWinPairs) {
    if (itemPoints.has(a1) && itemPoints.has(b1)) {
      bigWinReasons.push({
        name: '两个大牌型',
        detail: `同时命中 ${a1} 点与 ${b1} 点牌型`
      })
    }
  }
  if (rules.bigWinZeroesOpponents && input.opponentsPoints?.length) {
    const allZeroed = input.opponentsPoints.every(points => points > 0 && points <= total)
    if (allZeroed) {
      bigWinReasons.push({
        name: '一把吸光三家点数',
        detail: `成牌 ${total} 点 ≥ 三家剩余点数 ${input.opponentsPoints.join(' / ')}`
      })
    }
  }
  const isBigWin = bigWinReasons.length > 0

  // —— 摸子 ——
  const moziItems: MoziItem[] = []
  if (isKuZhiYa && enabled('枯只压')) {
    const units = input.selfDraw ? rules.kuZhiYaMozi.selfDraw : rules.kuZhiYaMozi.deal
    moziItems.push({
      name: '枯只压',
      units,
      detail: `只等这一张且该牌另外三张都已亮在桌上，${input.selfDraw ? '自摸 3 个大摸子' : '接牌 1 个大摸子'}`
    })
  } else if (isYaDang && enabled('压当')) {
    moziItems.push({ name: '压当', units: 1, detail: '压当成牌，1 个大摸子' })
  } else if (isDanDiao && enabled('单吊')) {
    moziItems.push({ name: '单吊', units: 1, detail: '单吊成牌，1 个大摸子' })
  } else if (input.selfDraw) {
    moziItems.push({ name: '自摸（小）', units: 0.5, detail: '普通自摸，1 个小摸子' })
  }
  if (input.threeToOne) {
    moziItems.push({ name: '三打一', units: 0.5, detail: '明牌成牌，1 个小摸子' })
  }
  // 清一色自带 1 个大摸子（大拿也照算，和自摸/压当叠加）
  if (a.isFlush && rules.qingYiSeMozi > 0) {
    moziItems.push({ name: '清一色', units: rules.qingYiSeMozi, detail: `清一色成牌，${rules.qingYiSeMozi} 个大摸子` })
  }
  if (input.isFirstHand && isBigWin) {
    moziItems.push({ name: '清水', units: rules.qingShuiMozi, detail: '首牌大拿' })
  }
  if (input.isAfterKong && rules.kongOpenAddsBigMozi) {
    moziItems.push({ name: '杠开', units: 1, detail: '杠开附 1 个大摸子（计算器口径）' })
  }
  const moziMultiplier = input.isAfterKong && rules.kongOpenDoublesMozi ? 2 : 1
  const moziUnits = moziItems.reduce((sum, item) => sum + item.units, 0) * moziMultiplier
  const moziBig = Math.floor(moziUnits)
  const moziSmall = Math.round((moziUnits - moziBig) * 2)
  const moziMoney = moziBig * rules.moziYuan.big + moziSmall * rules.moziYuan.small

  // —— 金额 ——
  const pointMoneyPerOpponent = isBigWin ? rules.bigWinMoneyPerPlayer : roundMoneyToFive(total * rules.pointYuan)
  const bigWinMoneyPerOpponent = isBigWin ? rules.bigWinMoneyPerPlayer : 0
  const moziMoneyPerOpponent = moziMoney
  const perOpponentTotal = isBigWin
    ? bigWinMoneyPerOpponent + moziMoneyPerOpponent
    : pointMoneyPerOpponent + moziMoneyPerOpponent
  // 大吊车被禁打点炮：由打出禁牌的一人承担三家的金额（份数不变，付款人从 3 变 1）
  const shares = 3
  const payerCount = input.singlePayer ? 1 : shares
  const moneyTotal = perOpponentTotal * shares
  const amountPerPayer = moneyTotal / payerCount

  const details: string[] = []
  if (isBigWin) {
    // 大拿按每家固定 40 元结算，普通点子全部不算，明细里也不列点数
    details.push(`大拿：${bigWinReasons.map(reason => reason.name).join('、')}；普通点子不再计算，按每家 ${rules.bigWinMoneyPerPlayer} 元 + 摸子结算`)
  } else {
    details.push(`成牌底点 ${rules.basePoints} 点`)
    for (const item of items.slice(1)) details.push(`${item.name} +${item.points}（${item.detail}）`)
    details.push(`点数小计 ${subtotal} 点${multiplier > 1 ? ` × ${multipliers.join(' × ')}` : ''} = ${total} 点`)
    details.push(`点数结算：每家 ${pointMoneyPerOpponent} 元（1 点 = ${rules.pointYuan} 元，按 5 元取整）`)
  }
  if (moziUnits > 0) {
    details.push(
      `摸子：${moziBig} 个大摸子 + ${moziSmall} 个小摸子${moziMultiplier > 1 ? `（杠后赛花 ×${moziMultiplier}）` : ''} = ${moziMoney} 元/家`
    )
  }
  details.push(
    input.singlePayer
      ? `由一人承担三家：该家付 ${amountPerPayer} 元（赢家收到 ${moneyTotal} 元）`
      : `每家应付 ${perOpponentTotal} 元，三家合计 ${moneyTotal} 元`
  )

  return {
    isWinningHand,
    problems,
    patterns,
    points: { base: rules.basePoints, items, subtotal, multipliers, multiplier, total },
    bigWin: { isBigWin, reasons: bigWinReasons },
    mozi: {
      items: moziItems,
      units: moziUnits,
      multiplier: moziMultiplier,
      big: moziBig,
      small: moziSmall,
      money: moziMoney
    },
    money: {
      pointMoneyPerOpponent,
      moziMoneyPerOpponent,
      bigWinMoneyPerOpponent,
      perOpponentTotal,
      shares,
      payerCount,
      amountPerPayer,
      total: moneyTotal
    },
    details
  }
}

/** 一串数字里有没有 3 个连续数字（三大坎要求数字牌连着，比如 3/4/5 万三坎） */
function hasThreeConsecutiveRanks(ranks: number[]): boolean {
  const unique = [...new Set(ranks)].sort((x, y) => x - y)
  for (let i = 0; i + 2 < unique.length; i += 1) {
    if (unique[i + 1] === unique[i] + 1 && unique[i + 2] === unique[i] + 2) return true
  }
  return false
}

/**
 * 三大坎：同一门里三组刻子/杠（暗刻、碰、杠都算）。
 * - 万/筒/条：三组坎的数字必须**连着**，比如 333万 444万 555万；
 * - 字牌：字牌没有顺序，任意三组字坎都算（中中中发发发白白白）。
 */
export function isSanDaKan(a: HandAnalysis): boolean {
  if (a.triplets < 3) return false
  for (const [suit, count] of a.tripletSuits) {
    if (suit === '字') {
      if (count >= 3) return true
      continue
    }
    if (count >= 3 && hasThreeConsecutiveRanks(a.tripletRanks.get(suit) ?? [])) return true
  }
  return false
}

/** 中发白三种箭牌（只有这 3 种，凑三坎比风牌难得多） */
const DRAGON_TILES: Tile[] = ['中', '发', '白']

/**
 * 大拿：三大坎 + 同门 2 张。
 * - 数字牌：三组连着的同门坎 + 同门将（`111222333万 88万 …`）；
 * - 字牌「中发白」三坎：本身够难，**不需要再配一对字**，将牌随便；
 * - 其它字牌三坎（如 中/东/南）：必须再配**一对字牌**才算大拿（`中中中 东东东 南南南 西西`）。
 */
function hasThreeBigKans(a: HandAnalysis): boolean {
  if (!isSanDaKan(a)) return false
  const honorKans = a.tripletTiles.filter(tile => parseTile(tile).suit === '字')
  if (honorKans.length >= 3) {
    const isZhongFaBai = DRAGON_TILES.every(tile => a.tripletTiles.includes(tile))
    if (isZhongFaBai) return true
    return a.pairSuit === '字'
  }
  if (!a.pairSuit) return false
  if (a.pairSuit === '字') return false
  return (a.tripletSuits.get(a.pairSuit) ?? 0) >= 3
}

/** 便捷：只取点数合计 */
export function pointsOf(input: ScoreInput): number {
  return scoreHand(input).points.total
}

/* ------------------------------------------------------------------ *
 * 7. 大吊车禁打
 * ------------------------------------------------------------------ */

/**
 * 大吊车的禁打范围。
 *
 * 触发时机：大吊车玩家（已碰/杠四组、手里只剩一对）打出其中一张后开始禁打；
 * 只要他不换掉手上最后一支牌就一直禁，换掉了就解除。缺该门的人不受限制。
 * 字牌只禁该张字牌本身；数字牌禁该数字 ±2（如打 5 万 → 3~7 万）。
 */
export function daLiaoCheForbiddenTiles(discarded: Tile): Tile[] {
  const info = parseTile(discarded)
  if (info.suit === '字') return [discarded]
  const from = Math.max(1, info.rank - 2)
  const to = Math.min(9, info.rank + 2)
  const tiles: Tile[] = []
  for (let rank = from; rank <= to; rank += 1) tiles.push(tileOf(info.suit, rank))
  return tiles
}

/** 绝对安全：外面已有 3 张，或外面 + 自己手上共 4 张（此时没人能再成这张牌）。 */
export function isAbsolutelySafe(visibleCount: number, ownCount = 0): boolean {
  return visibleCount >= 3 || visibleCount + ownCount >= 4
}

/** 便捷：把结果格式化成多行文本 */
export function formatScore(result: ScoreResult): string {
  return result.details.join('\n')
}
