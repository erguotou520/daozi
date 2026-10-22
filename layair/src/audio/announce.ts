/**
 * 倒子麻将 · 播报编排（纯逻辑，不依赖 LayaAir）
 *
 * 把一次成牌拆成「先喊什么、后喊什么」：
 * - 自摸永远第一个喊；杠后赛花顶掉自摸（这两个不组合）；
 * - 牌型按分量从大到小排，大拿压轴；
 * - 一整条播报共用一个情绪档位，避免「自摸」平播、「清一色」突然吼起来。
 *
 * 具体发音文件由 `voice.ts` 按 `<id>_<tier>.mp3` 取；没有高档位的牌名
 * 会自动回落到 1 档。
 */

import type { ScoreResult, Tile } from '../game/score'

export type VoiceTier = 1 | 2 | 3

export interface VoiceClip {
  /** 音频 id，对应 resources/audio/voice/<id>_<tier>.mp3 */
  id: string
  tier: VoiceTier
  /** 这条播完后再等多久接下一條（毫秒） */
  gapMs?: number
}

const TILE_VOICE: Record<string, string> = {}
for (const [suit, prefix] of [
  ['万', 'wan'],
  ['筒', 'tong'],
  ['条', 'tiao']
] as const) {
  for (let rank = 1; rank <= 9; rank += 1) TILE_VOICE[`${rank}${suit}`] = `${prefix}${rank}`
}
for (const [tile, id] of [
  ['东', 'east'],
  ['南', 'south'],
  ['西', 'west'],
  ['北', 'north'],
  ['中', 'red'],
  ['发', 'green'],
  ['白', 'white']
] as const) {
  TILE_VOICE[tile] = id
}

/** 牌名 → 语音 id；未知牌面退化成「胡」，至少不会没声音 */
export function tileVoice(tile: Tile): string {
  return TILE_VOICE[tile] ?? 'hu'
}

/** 打出一张牌时的播报 */
export function buildDiscardVoice(tile: Tile): VoiceClip[] {
  return [{ id: tileVoice(tile), tier: 1 }]
}

interface PatternRule {
  id: string
  weight: number
  match: (score: ScoreResult) => boolean
}

const hasItem = (score: ScoreResult, name: string): boolean =>
  score.points.items.some(item => item.name === name)
const hasMozi = (score: ScoreResult, name: string): boolean =>
  score.mozi.items.some(item => item.name === name)
const flag = (score: ScoreResult, name: string): boolean => score.patterns[name] === true

/**
 * 牌型播报的先后顺序。weight 只影响组合时的先后，不代表真实点数；
 * 清一色 / 七对 / 大吊车 这些大牌型排前面，压当 / 单吊这种小料排最后。
 */
const PATTERNS: PatternRule[] = [
  { id: 'qingyise', weight: 100, match: s => flag(s, '清一色') },
  { id: 'qidui', weight: 95, match: s => flag(s, '七对') },
  { id: 'dadiaoche', weight: 90, match: s => flag(s, '大吊车') || hasItem(s, '大吊车') },
  { id: 'duiduihu', weight: 80, match: s => hasItem(s, '对对胡') },
  { id: 'kuzhiya', weight: 75, match: s => hasMozi(s, '枯只压') },
  { id: 'yijiu', weight: 70, match: s => flag(s, '一一九') },
  { id: 'shuangtong', weight: 70, match: s => flag(s, '双通') },
  { id: 'shuangsihuo', weight: 70, match: s => flag(s, '双四活') },
  { id: 'sangang', weight: 70, match: s => flag(s, '三杠') },
  { id: 'sandakan', weight: 70, match: s => flag(s, '三大坎+同门2张') },
  { id: 'qingshui', weight: 65, match: s => hasMozi(s, '清水') },
  { id: 'sandayi', weight: 60, match: s => hasItem(s, '三打一') || hasMozi(s, '三打一') },
  { id: 'caoyise', weight: 50, match: s => hasItem(s, '草一色') },
  { id: 'sihuo', weight: 45, match: s => hasItem(s, '四活') },
  { id: 'bangbang', weight: 40, match: s => hasItem(s, '棒棒') },
  { id: 'yadang', weight: 30, match: s => hasItem(s, '压当') },
  { id: 'dandiao', weight: 30, match: s => hasItem(s, '单吊') }
]

/** 这手牌该用几档情绪：1 平播、2 提气、3 爆发 */
export function voiceTierFor(score: ScoreResult, selfDraw = false): VoiceTier {
  if (score.bigWin.isBigWin || score.points.total >= 50) return 3
  if (
    selfDraw ||
    score.points.total >= 20 ||
    flag(score, '清一色') ||
    flag(score, '七对') ||
    flag(score, '大吊车') ||
    score.points.items.length > 1
  ) {
    return 2
  }
  return 1
}

export interface WinVoiceInput {
  /** 是否自摸 */
  selfDraw: boolean
  /** 是否杠后补摸成牌（杠后赛花） */
  afterKong: boolean
  /** 是否抢杠成牌 */
  robKong?: boolean
  score: ScoreResult
  /** 一条播报最多几条，默认 5（自摸 + 3 个牌型 + 大拿） */
  maxClips?: number
}

/**
 * 成牌播报：
 *   自摸 / 杠后赛花 / 抢杠胡 / 胡
 *   → 大牌型（按 weight 降序，最多 3 个）
 *   → 大拿（压轴）
 *
 * 自摸和杠后赛花互斥：杠后赛花本身就是自摸的变体，只喊杠后赛花。
 */
export function buildWinAnnouncement(input: WinVoiceInput): VoiceClip[] {
  const score = input.score
  const tier = voiceTierFor(score, input.selfDraw)
  // 杠后赛花只可能是自摸；抢杠 / 接牌即使 afterKong 为 true 也不能这么喊
  const afterKong = input.afterKong && input.selfDraw
  const leadId = afterKong
    ? 'ganghousaihua'
    : input.selfDraw
      ? 'zimo'
      : input.robKong
        ? 'qianggang'
        : 'hu'

  const body = PATTERNS.filter(rule => rule.match(score))
    .sort((a, b) => b.weight - a.weight)
    .map(rule => rule.id)
  const dana = score.bigWin.isBigWin
  const maxClips = Math.max(2, input.maxClips ?? 5)
  const bodyLimit = Math.max(0, maxClips - 1 - (dana ? 1 : 0))

  // 组合内不留停顿：自摸和后面的牌型要像一句话连起来
  const clips: VoiceClip[] = [{ id: leadId, tier, gapMs: 0 }]
  for (const id of body.slice(0, bodyLimit)) clips.push({ id, tier, gapMs: 0 })
  if (dana) clips.push({ id: 'dana', tier: 3, gapMs: 0 })
  return clips
}
