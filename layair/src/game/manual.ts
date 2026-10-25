/**
 * 和县刀子 · 手动算分
 *
 * 计算器页面用的「牌型勾选 → 点数与金额」模型。
 * 所有分值都从 `DEFAULT_RULES` 取，避免页面里再写一份会过期的数字。
 * 口径遵循 `docs/倒子麻将-规则与结算.md`：**没有牌型互斥**，符合多少就加多少。
 */

import { DEFAULT_RULES, type Rules } from './score'

export interface ManualSelection {
  /** 对子点数（碰 1 / 暗刻 2 / 杠 2 的合计），1~4 */
  pairs: number | null
  /** 只子张数 8~12 */
  zhizi: number | null
  /** 通数 5~8 */
  tong: number | null
  /** 加点子 */
  extras: string[]
  /** 摸子 */
  mozi: string[]
  /** 大拿牌型 */
  bigWin: string[]
}

export const EMPTY_SELECTION: ManualSelection = {
  pairs: null,
  zhizi: null,
  tong: null,
  extras: [],
  mozi: [],
  bigWin: []
}

export interface ManualOption {
  name: string
  points: number
  hint: string
}

export const PAIR_OPTIONS = [1, 2, 3, 4]
export const ZHIZI_OPTIONS = [8, 9, 10, 11, 12]
export const TONG_OPTIONS = [5, 6, 7, 8]

/** 加点子：只加点数，不涉及摸子 */
export function extraOptions(rules: Rules = DEFAULT_RULES): ManualOption[] {
  const p = rules.patternPoints
  return [
    { name: '压当', points: p.压当, hint: '唯一成牌张补顺子缺口（卡张/边张）' },
    { name: '单吊', points: p.单吊, hint: '唯一成牌张补将牌' },
    { name: '小连号', points: p.小连号, hint: '同一门连续六张' },
    { name: '大连号', points: p.大连号, hint: '同一门 1–9 齐张' },
    { name: '棒棒', points: p.棒棒, hint: '同一门连续三组对子' },
    { name: '四活', points: p.四活, hint: '四张相同且未开杠' },
    { name: '三大坎', points: p.三大坎, hint: '三组刻子/杠（含三组字牌坎子）' },
    { name: '不动手', points: p.不动手, hint: '整把没碰过没杠过' },
    { name: '草一色', points: p.草一色, hint: '一门数字花色 + 分牌' },
    { name: '对对胡', points: p.对对胡, hint: '全刻子加一对将' },
    { name: '七对', points: p.七对, hint: '七个对子' },
    { name: '大吊车', points: p.大吊车, hint: '四组碰后单吊将' },
    { name: '老小对', points: p.老小对, hint: '同一门 1、9 都成坎（≥3 张，不能拆进顺子）' },
    { name: '杠开', points: p.杠开, hint: '杠后补摸成牌' }
  ]
}

export interface MoziOption {
  name: string
  /** 附带点数 */
  points: number
  /** 记几个摸子（1 = 大摸子，0.5 = 小摸子） */
  units: number
  /** 是否让本牌点数翻倍 */
  doublesPoints: boolean
  /** 是否让摸子总额翻倍（杠后赛花） */
  doublesMozi: boolean
  /** 与其他摸子互斥（同一手牌只能是一种自摸方式） */
  exclusiveGroup?: string
  hint: string
}

export function moziOptions(rules: Rules = DEFAULT_RULES): MoziOption[] {
  return [
    {
      name: '自摸',
      points: 0,
      units: 0.5,
      doublesPoints: true,
      doublesMozi: false,
      exclusiveGroup: 'win-style',
      hint: '本牌点数翻倍，算 1 个小摸子'
    },
    {
      name: '自摸压当/单吊',
      points: 0,
      units: 1,
      doublesPoints: true,
      doublesMozi: false,
      exclusiveGroup: 'win-style',
      hint: '本牌点数翻倍，算 1 个大摸子'
    },
    {
      name: '枯只压',
      points: rules.patternPoints.枯只压,
      units: rules.kuZhiYaMozi.selfDraw,
      doublesPoints: false,
      doublesMozi: false,
      exclusiveGroup: 'win-style',
      hint: '压当中张且外面已出 3 张；牌型 20 点（压当的 1 点另勾）；自摸 3 个大摸子、接牌 1 个'
    },
    {
      name: '三打一',
      points: rules.patternPoints.三打一,
      units: 0.5,
      doublesPoints: false,
      doublesMozi: false,
      hint: '三家缺同一门，明牌成牌，1 个小摸子'
    },
    {
      name: '杠后赛花',
      points: 0,
      units: 0,
      doublesPoints: false,
      doublesMozi: true,
      hint: '摸子总额翻倍'
    },
    {
      name: '清水',
      points: 0,
      units: rules.qingShuiMozi,
      doublesPoints: false,
      doublesMozi: false,
      hint: '首牌即大拿，1 大摸子 + 1 小摸子'
    }
  ]
}

/** 大拿牌型：直接命中即大拿 */
export function bigWinOptions(rules: Rules = DEFAULT_RULES): string[] {
  return [...rules.bigWinPatterns, '七对+四活']
}

export interface ManualItem {
  name: string
  points: number
  group: string
}

export interface ManualResult {
  items: ManualItem[]
  subtotal: number
  multiplier: number
  total: number
  isBigWin: boolean
  bigWinReasons: string[]
  moziUnits: number
  moziMultiplier: number
  moziBig: number
  moziSmall: number
  moziMoney: number
  /** 每个对手应付（元） */
  perOpponent: number
  /** 三家合计（元） */
  moneyTotal: number
  lines: string[]
}

export function scoreManualSelection(
  selection: ManualSelection,
  rules: Rules = DEFAULT_RULES
): ManualResult {
  const items: ManualItem[] = []
  const lines: string[] = []

  const add = (name: string, points: number, group: string, detail?: string) => {
    if (points <= 0) return
    items.push({ name, points, group })
    lines.push(`${name} +${points}${detail ? `（${detail}）` : ''}`)
  }

  add('成牌底点', rules.basePoints, 'base')
  if (selection.pairs) add('对子', selection.pairs, 'pairs', `${selection.pairs} 个对子`)
  if (selection.zhizi) add('只子', selection.zhizi - (rules.zhizi.min - 1), 'zhizi', `${selection.zhizi} 张`)
  if (selection.tong) add('通', Math.min(selection.tong, rules.tong.max), 'tong', `${selection.tong} 通`)

  const extras = extraOptions(rules)
  for (const name of selection.extras) {
    const option = extras.find(item => item.name === name)
    if (option) add(option.name, option.points, 'extras', option.hint)
  }

  const moziTable = moziOptions(rules)
  const selectedMozi = moziTable.filter(option => selection.mozi.includes(option.name))
  for (const option of selectedMozi) add(option.name, option.points, 'mozi', option.hint)

  // 清一色自带 1 个大摸子（和自摸/压当叠加）
  const flushMozi = selection.bigWin.includes('清一色') ? rules.qingYiSeMozi : 0
  if (flushMozi > 0) add('清一色', 0, 'mozi', `清一色自带 ${flushMozi} 个大摸子`)

  const subtotal = items.reduce((sum, item) => sum + item.points, 0)
  const multiplier = selectedMozi.some(option => option.doublesPoints) ? 2 : 1
  const total = subtotal * multiplier

  // —— 大拿 ——
  const bigWinReasons: string[] = []
  for (const name of selection.bigWin) bigWinReasons.push(`命中大拿牌型「${name}」`)
  const values = new Set(items.map(item => item.points))
  if (values.has(30) && values.has(10)) bigWinReasons.push('两个大牌型（30 点 + 10 点），即七对 + 四活')
  if (total >= rules.bigWinThreshold) bigWinReasons.push(`${total} 点 ≥ ${rules.bigWinThreshold} 点`)
  const isBigWin = bigWinReasons.length > 0

  // —— 摸子 ——
  const rawUnits = selectedMozi.reduce((sum, option) => sum + option.units, 0) + flushMozi
  const moziMultiplier = selectedMozi.some(option => option.doublesMozi) ? 2 : 1
  const moziUnits = rawUnits * moziMultiplier
  const moziBig = Math.floor(moziUnits)
  const moziSmall = Math.round((moziUnits - moziBig) * 2)
  const moziMoney = moziBig * rules.moziYuan.big + moziSmall * rules.moziYuan.small

  const perOpponent = isBigWin ? rules.bigWinMoneyPerPlayer : total * rules.pointYuan
  const moneyTotal = (perOpponent + moziMoney) * 3

  lines.push(`小计 ${subtotal} 点${multiplier > 1 ? ' × 2' : ''} = ${total} 点`)
  if (isBigWin) lines.push(`大拿：${bigWinReasons.map(reason => reason.replace(/^命中大拿牌型「|」$/g, '')).join('、')}`)
  if (moziUnits > 0) {
    lines.push(`摸子 ${moziBig} 大 + ${moziSmall} 小 = ${moziMoney} 元/家`)
  }
  lines.push(`每家 ${perOpponent + moziMoney} 元，三家合计 ${moneyTotal} 元`)

  return {
    items,
    subtotal,
    multiplier,
    total,
    isBigWin,
    bigWinReasons,
    moziUnits,
    moziMultiplier,
    moziBig,
    moziSmall,
    moziMoney,
    perOpponent: perOpponent + moziMoney,
    moneyTotal,
    lines
  }
}
