/**
 * 倒子麻将 · 整句组合（纯逻辑）
 *
 * 这些是「自摸清一色」「杠后赛花对对胡」这类最常见的整句，
 * 由 CosyVoice 一次合成，中间没有任何拼接停顿；不在这张表里的组合
 * 退回逐段播放，段与段的 gap 也是 0。
 *
 * 顺序必须与 `buildWinAnnouncement()` 输出的一致：自摸/杠后赛花 → 牌型 → 大拿。
 * 音频由 `scripts/voice/generate.py` 按同 id 生成。
 */

import type { VoiceClip } from './announce'

export interface VoiceCombo {
  id: string
  sequence: string[]
  /** 仅用于文档/调试，真正播报的是已合成音频 */
  text: string
}

export const VOICE_COMBOS: VoiceCombo[] = [
  { id: "c_zimo_qingyise", sequence: ["zimo", "qingyise"], text: "自摸清一色！" },
  { id: "c_zimo_duiduihu", sequence: ["zimo", "duiduihu"], text: "自摸对对胡！" },
  { id: "c_zimo_kuzhiya", sequence: ["zimo", "kuzhiya"], text: "自摸枯只压！" },
  { id: "c_zimo_qidui", sequence: ["zimo", "qidui"], text: "自摸七对！" },
  { id: "c_zimo_dadiaoche", sequence: ["zimo", "dadiaoche"], text: "自摸大吊车！" },
  { id: "c_zimo_qingyise_dana", sequence: ["zimo", "qingyise", "dana"], text: "自摸清一色大拿！" },
  { id: "c_zimo_duiduihu_dana", sequence: ["zimo", "duiduihu", "dana"], text: "自摸对对胡大拿！" },
  { id: "c_zimo_kuzhiya_dana", sequence: ["zimo", "kuzhiya", "dana"], text: "自摸枯只压大拿！" },
  { id: "c_zimo_qidui_dana", sequence: ["zimo", "qidui", "dana"], text: "自摸七对大拿！" },
  { id: "c_zimo_dadiaoche_dana", sequence: ["zimo", "dadiaoche", "dana"], text: "自摸大吊车大拿！" },
  { id: "c_zimo_qingyise_duiduihu", sequence: ["zimo", "qingyise", "duiduihu"], text: "自摸清一色对对胡！" },
  { id: "c_zimo_qingyise_duiduihu_dana", sequence: ["zimo", "qingyise", "duiduihu", "dana"], text: "自摸清一色对对胡大拿！" },
  { id: "c_zimo_sandayi", sequence: ["zimo", "sandayi"], text: "自摸三打一！" },
  { id: "c_zimo_qingyise_sandayi", sequence: ["zimo", "qingyise", "sandayi"], text: "自摸清一色三打一！" },
  { id: "c_ganghousaihua_qingyise", sequence: ["ganghousaihua", "qingyise"], text: "杠后赛花清一色！" },
  { id: "c_ganghousaihua_duiduihu", sequence: ["ganghousaihua", "duiduihu"], text: "杠后赛花对对胡！" },
  { id: "c_ganghousaihua_qingyise_dana", sequence: ["ganghousaihua", "qingyise", "dana"], text: "杠后赛花清一色大拿！" },
  { id: "c_qianggang_duiduihu", sequence: ["qianggang", "duiduihu"], text: "抢杠胡对对胡！" },
  { id: "c_hu_qingyise", sequence: ["hu", "qingyise"], text: "胡清一色！" },
  { id: "c_hu_duiduihu", sequence: ["hu", "duiduihu"], text: "胡对对胡！" }
]

const COMBO_MAP = new Map<string, VoiceCombo>(
  VOICE_COMBOS.map(combo => [combo.sequence.join('|'), combo])
)

/**
 * 「不动手」几乎每把没碰没杠的牌都有，但它不是一句值得喊的牌型；
 * 匹配整句时先把它去掉，否则「自摸清一色」永远匹配不上。
 */
const MATCH_IGNORED = new Set(['budongshou'])

/** 按 buildWinAnnouncement 的 clip 序列找整句；找不到返回 null */
export function comboFor(clips: VoiceClip[]): VoiceCombo | null {
  const key = clips
    .map(clip => clip.id)
    .filter(id => !MATCH_IGNORED.has(id))
    .join('|')
  return COMBO_MAP.get(key) ?? null
}

export interface ComboPlan {
  combo: VoiceCombo
  /** 整句之后还要补的短 clip，比如缺 *_dana 整句时补一条大拿 */
  suffix: Array<'dana'>
}

/**
 * 先找完全匹配的整句；没有再试「去掉大拿」的整句 + 单独大拿。
 * 大拿是压轴，单独补一条也比把自摸/清一色拆成三段自然。
 */
export function comboPlan(clips: VoiceClip[]): ComboPlan | null {
  const exact = comboFor(clips)
  if (exact) return { combo: exact, suffix: [] }
  if (clips.length > 1 && clips[clips.length - 1].id === 'dana') {
    const base = comboFor(clips.slice(0, -1))
    if (base) return { combo: base, suffix: ['dana'] }
  }
  return null
}
