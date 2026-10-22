/**
 * 倒子麻将 · 语音播报
 *
 * 音频都是离线合成好的小 mp3（24kHz 单声道 48kbps），放在
 * `resources/audio/voice/`，按 `<id>_<档位>.mp3` 命名。
 *
 * 播放策略：
 * - 一条播报由若干 clip 串起来，播完一条再播下一条，不叠在一起；
 * - 新的播报会立刻打断旧的（比如连续碰、杠）；
 * - 每段都有超时兜底，某个文件 404 / 解码失败也不会把队列卡死；
 * - 牌名只有 1 档，牌型有 1–3 档，取不到高档位时自动回落。
 */

import type { Tile } from '../game/score'
import { loadVoiceEnabled, saveVoiceEnabled } from '../ui/storage'
import { buildDiscardVoice, buildWinAnnouncement, type VoiceClip, type VoiceTier } from './announce'
import { comboPlan, VOICE_COMBOS } from './combos'

export type { VoiceClip, VoiceTier } from './announce'
export { buildWinAnnouncement } from './announce'

const VOICE_ROOT = 'resources/audio/voice'

/** 有 2 档以上的 id；不在表里的只生成过 1 档 */
const MAX_TIER: Record<string, number> = {
  gang: 2,
  angang: 2,
  zimo: 3,
  hu: 3,
  qianggang: 3
}
for (const id of [
  'dana',
  'kuzhiya',
  'qingyise',
  'duiduihu',
  'ganghousaihua',
  'sandayi',
  'qidui',
  'dadiaoche',
  'laoxiaodui',
  'bangbang',
  'sihuo',
  'caoyise',
  'yijiu',
  'shuangtong',
  'shuangsihuo',
  'sangang',
  'sandakan',
  'qingshui',
  'yadang',
  'dandiao',
  'gangkai'
]) {
  MAX_TIER[id] = 3
}
for (const combo of VOICE_COMBOS) MAX_TIER[combo.id] = 3

const ALL_TILES: Tile[] = []
for (const suit of ['万', '筒', '条']) {
  for (let rank = 1; rank <= 9; rank += 1) ALL_TILES.push(`${rank}${suit}`)
}
ALL_TILES.push('东', '南', '西', '北', '中', '发', '白')

function clipUrl(clip: VoiceClip): string {
  const max = MAX_TIER[clip.id] ?? 1
  const tier = Math.min(clip.tier, max)
  return `${VOICE_ROOT}/${clip.id}_${tier}.mp3`
}

class VoicePlayer {
  private queue: VoiceClip[] = []
  private token = 0
  private timer: any = null
  private currentUrl: string | null = null
  private muted = !loadVoiceEnabled()
  private warmed = false

  get enabled(): boolean {
    return !this.muted
  }

  setEnabled(enabled: boolean): void {
    this.muted = !enabled
    saveVoiceEnabled(enabled)
    if (!enabled) this.stop()
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled)
    return this.enabled
  }

  /** 打一张牌：只喊牌名 */
  playDiscard(tile: Tile): void {
    this.play(buildDiscardVoice(tile))
  }

  /** 成牌：自摸 / 杠后赛花 / 抢杠 / 胡 + 牌型 + 大拿 */
  playWin(opts: {
    selfDraw: boolean
    afterKong: boolean
    robKong?: boolean
    score: Parameters<typeof buildWinAnnouncement>[0]['score']
  }): void {
    const clips = buildWinAnnouncement(opts)
    const plan = comboPlan(clips)
    if (plan) {
      // 常见组合是整句合成，自摸和牌型之间没有任何拼接缝
      const tier = clips[0]?.tier ?? 2
      const out: VoiceClip[] = [{ id: plan.combo.id, tier }]
      for (const id of plan.suffix) out.push({ id, tier: 3, gapMs: 0 })
      this.play(out)
      return
    }
    // 没有整句时逐段播放，gap 已由 announce.ts 置 0
    this.play(clips)
  }

  /** 单条播报，比如碰 / 杠 / 暗杠 / 三打一 */
  playId(id: string, tier: VoiceTier = 1, gapMs = 0): void {
    this.play([{ id, tier, gapMs }])
  }

  play(clips: VoiceClip[]): void {
    if (this.muted || clips.length === 0) return
    this.stop()
    const token = this.token
    this.queue = clips.slice()
    this.step(token)
  }

  /** 停掉当前播报和队列（静音、退出、重开一局时用） */
  stop(): void {
    this.token += 1
    this.queue = []
    if (this.timer !== null) {
      const clear = (globalThis as any).clearTimeout
      if (typeof clear === 'function') clear(this.timer)
      this.timer = null
    }
    if (this.currentUrl) {
      try {
        Laya.SoundManager.stopSound(this.currentUrl)
      } catch {
        // ignore
      }
      this.currentUrl = null
    }
  }

  /**
   * 预加载。先加载 34 张牌名 + 常用动作，牌型和成牌语音延后到空闲时再加载；
   * 文件总大小 ~1.2MB，不预加载也能在第一次播报时现取。
   */
  preload(delayMs = 0): void {
    if (this.warmed) return
    this.warmed = true
    const basic: string[] = []
    for (const tile of ALL_TILES) basic.push(clipUrl({ id: buildDiscardVoice(tile)[0].id, tier: 1 }))
    for (const id of ['peng', 'gang', 'angang', 'zimo', 'hu']) basic.push(clipUrl({ id, tier: 1 }))

    const load = (urls: string[]) => {
      try {
        Laya.loader.load(urls, Laya.Handler.create(this, (): void => undefined), null, Laya.Loader.SOUND)
      } catch {
        // 预加载失败不影响按需播放
      }
    }

    const later = () => {
      const rest: string[] = []
      for (const [id, max] of Object.entries(MAX_TIER)) {
        if (id === 'gang' || id === 'angang') continue
        for (let tier = 1; tier <= max; tier += 1) rest.push(clipUrl({ id, tier: tier as VoiceTier }))
      }
      load(rest)
    }

    if (delayMs > 0) {
      const wait = (globalThis as any).setTimeout
      if (typeof wait === 'function') {
        wait(() => {
          load(basic)
          wait(later, 1200)
        }, delayMs)
        return
      }
    }
    load(basic)
    const wait = (globalThis as any).setTimeout
    if (typeof wait === 'function') wait(later, 1200)
  }

  private step(token: number): void {
    if (token !== this.token) return
    const clip = this.queue.shift()
    if (!clip) {
      this.currentUrl = null
      return
    }

    const url = clipUrl(clip)
    this.currentUrl = url
    let finished = false
    let safety: any = null

    const next = () => {
      if (finished || token !== this.token) return
      finished = true
      if (safety !== null) {
        const clear = (globalThis as any).clearTimeout
        if (typeof clear === 'function') clear(safety)
        safety = null
      }
      if (this.currentUrl === url) this.currentUrl = null
      const wait = (globalThis as any).setTimeout
      const gap = clip.gapMs ?? 70
      if (typeof wait !== 'function') {
        this.step(token)
        return
      }
      this.timer = wait(() => {
        this.timer = null
        if (token !== this.token) return
        this.step(token)
      }, gap)
    }

    // 正常情况由 complete 回调推进；某些机型/格式不回调，3 秒后强制走下一条
    const wait = (globalThis as any).setTimeout
    if (typeof wait === 'function') {
      safety = wait(next, 3000)
    }

    try {
      Laya.SoundManager.soundVolume = 0.85
      Laya.SoundManager.playSound(url, 1, Laya.Handler.create(this, next))
    } catch (error) {
      console.warn('[voice] 播放失败', url, error)
      next()
    }
  }
}

export const voice = new VoicePlayer()
