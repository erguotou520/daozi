/**
 * 音效管理器 - 使用 Web Audio API 生成游戏音效
 * 无需外部音频文件，所有音效通过合成方式生成
 */
class SoundManagerStore {
  private ctx: AudioContext | null = null
  private enabled = true
  private volume = 0.5
  private bgmNode: OscillatorNode | null = null
  private bgmGain: GainNode | null = null

  private getCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume()
    }
    return this.ctx
  }

  /** 启用/禁用音效 */
  toggle(on?: boolean): void {
    this.enabled = on ?? !this.enabled
    if (!this.enabled) this.stopBgm()
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
  }

  // ============= 基础音效合成 =============

  /** 牌桌点击音 (短促的木质敲击声) */
  playDiscard(): void {
    if (!this.enabled) return
    const ctx = this.getCtx()
    const t = ctx.currentTime

    // 高频click
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(800, t)
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.08)
    gain.gain.setValueAtTime(this.volume * 0.4, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.1)

    // 低频thud
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(150, t)
    osc2.frequency.exponentialRampToValueAtTime(60, t + 0.12)
    gain2.gain.setValueAtTime(this.volume * 0.3, t)
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.15)
    osc2.connect(gain2).connect(ctx.destination)
    osc2.start(t)
    osc2.stop(t + 0.15)
  }

  /** 摸牌音 (滑动声) */
  playDraw(): void {
    if (!this.enabled) return
    const ctx = this.getCtx()
    const t = ctx.currentTime

    // 噪声模拟滑动
    const bufferSize = ctx.sampleRate * 0.15
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize)
    }

    const noise = ctx.createBufferSource()
    noise.buffer = buffer

    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(2000, t)
    filter.Q.value = 2

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(this.volume * 0.15, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15)

    noise.connect(filter).connect(gain).connect(ctx.destination)
    noise.start(t)
  }

  /** 碰牌音 (清脆双击 + 语音提示) */
  playPong(): void {
    if (!this.enabled) return
    const ctx = this.getCtx()
    const t = ctx.currentTime

    // 连续两声敲击
    for (let i = 0; i < 2; i++) {
      const delay = i * 0.08
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(1200, t + delay)
      osc.frequency.exponentialRampToValueAtTime(600, t + delay + 0.06)
      gain.gain.setValueAtTime(this.volume * 0.4, t + delay)
      gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.08)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t + delay)
      osc.stop(t + delay + 0.08)
    }

    // 低音共鸣
    const bass = ctx.createOscillator()
    const bassGain = ctx.createGain()
    bass.type = 'sine'
    bass.frequency.value = 220
    bassGain.gain.setValueAtTime(this.volume * 0.15, t)
    bassGain.gain.exponentialRampToValueAtTime(0.001, t + 0.2)
    bass.connect(bassGain).connect(ctx.destination)
    bass.start(t)
    bass.stop(t + 0.2)
  }

  /** 杠牌音 (厚重三连击) */
  playKong(): void {
    if (!this.enabled) return
    const ctx = this.getCtx()
    const t = ctx.currentTime

    // 三连敲击 + 下行音调
    for (let i = 0; i < 3; i++) {
      const delay = i * 0.07
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(900 - i * 100, t + delay)
      osc.frequency.exponentialRampToValueAtTime(300, t + delay + 0.08)
      gain.gain.setValueAtTime(this.volume * 0.45, t + delay)
      gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.1)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t + delay)
      osc.stop(t + delay + 0.1)
    }

    // 低频隆隆
    const bass = ctx.createOscillator()
    const bassGain = ctx.createGain()
    bass.type = 'sine'
    bass.frequency.setValueAtTime(120, t + 0.05)
    bass.frequency.exponentialRampToValueAtTime(60, t + 0.3)
    bassGain.gain.setValueAtTime(this.volume * 0.2, t + 0.05)
    bassGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
    bass.connect(bassGain).connect(ctx.destination)
    bass.start(t + 0.05)
    bass.stop(t + 0.3)
  }

  /** 胡牌音 (欢快上行琶音 + 和弦) */
  playWin(): void {
    if (!this.enabled) return
    const ctx = this.getCtx()
    const t = ctx.currentTime

    // 上行琶音 C-E-G-C'
    const notes = [523, 659, 784, 1047]
    notes.forEach((freq, i) => {
      const delay = i * 0.12
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, t + delay)
      gain.gain.linearRampToValueAtTime(this.volume * 0.35, t + delay + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.5)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t + delay)
      osc.stop(t + delay + 0.5)
    })

    // 和弦持续音
    const chordDelay = 0.5
    const chordFreqs = [523, 659, 784]
    chordFreqs.forEach(freq => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(this.volume * 0.15, t + chordDelay)
      gain.gain.exponentialRampToValueAtTime(0.001, t + chordDelay + 1.5)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t + chordDelay)
      osc.stop(t + chordDelay + 1.5)
    })
  }

  /** 选缺确认音 */
  playChooseLack(): void {
    if (!this.enabled) return
    const ctx = this.getCtx()
    const t = ctx.currentTime

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(660, t)
    osc.frequency.setValueAtTime(880, t + 0.1)
    gain.gain.setValueAtTime(this.volume * 0.25, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.25)
  }

  /** 按钮点击音 */
  playClick(): void {
    if (!this.enabled) return
    const ctx = this.getCtx()
    const t = ctx.currentTime

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 1000
    gain.gain.setValueAtTime(this.volume * 0.15, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.05)
  }

  /** 错误/警告音 */
  playError(): void {
    if (!this.enabled) return
    const ctx = this.getCtx()
    const t = ctx.currentTime

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(300, t)
    osc.frequency.setValueAtTime(200, t + 0.15)
    gain.gain.setValueAtTime(this.volume * 0.2, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.3)
  }

  /** 回合提示音 (轮到自己) */
  playTurnNotify(): void {
    if (!this.enabled) return
    const ctx = this.getCtx()
    const t = ctx.currentTime

    // 两个上行音
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(440, t)
    osc.frequency.setValueAtTime(554, t + 0.12)
    gain.gain.setValueAtTime(this.volume * 0.2, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.3)
  }

  /** 荒庄音 */
  playDrawGame(): void {
    if (!this.enabled) return
    const ctx = this.getCtx()
    const t = ctx.currentTime

    // 下行三音
    const notes = [440, 330, 220]
    notes.forEach((freq, i) => {
      const delay = i * 0.2
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(this.volume * 0.2, t + delay)
      gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.4)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t + delay)
      osc.stop(t + delay + 0.4)
    })
  }

  /** 开始/停止背景音乐 (轻柔环境音) */
  startBgm(): void {
    if (!this.enabled || this.bgmNode) return
    const ctx = this.getCtx()

    // 极低音量持续和弦 - 不干扰游戏
    this.bgmGain = ctx.createGain()
    this.bgmGain.gain.value = this.volume * 0.03

    const freqs = [130.8, 164.8, 196.0] // C3 E3 G3
    const nodes: OscillatorNode[] = []

    freqs.forEach(freq => {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      osc.connect(this.bgmGain!)
      osc.start()
      nodes.push(osc)
    })

    this.bgmGain.connect(ctx.destination)
    this.bgmNode = nodes[0] // 存一个引用用于stop
  }

  stopBgm(): void {
    if (this.bgmGain) {
      this.bgmGain.disconnect()
      this.bgmGain = null
    }
    this.bgmNode = null
  }
}

export const soundManager = new SoundManagerStore()
