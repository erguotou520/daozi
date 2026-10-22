/**
 * 头像管理器 - 生成和缓存玩家头像
 * 提供默认头像（基于HSL色彩的卡通头像）
 */

// 预设的头像颜色和表情
const AVATAR_STYLES = [
  { bg: '#4a90d9', face: '😊' },
  { bg: '#e74c3c', face: '😎' },
  { bg: '#2ecc71', face: '🤠' },
  { bg: '#f39c12', face: '😄' },
  { bg: '#9b59b6', face: '🧐' },
  { bg: '#1abc9c', face: '😏' },
  { bg: '#e67e22', face: '🤗' },
  { bg: '#3498db', face: '😌' },
  { bg: '#e91e63', face: '🥳' },
  { bg: '#00bcd4', face: '😇' },
]

const BOT_STYLES = [
  { bg: '#7e57c2', face: '🤖' },
  { bg: '#5c6bc0', face: '🎀' },
  { bg: '#66bb6a', face: '👴' },
  { bg: '#42a5f5', face: '😊' },
  { bg: '#ef5350', face: '🌸' },
  { bg: '#26a69a', face: '💪' },
  { bg: '#ec407a', face: '🌺' },
  { bg: '#8d6e63', face: '🐕' },
  { bg: '#78909c', face: '🔨' },
  { bg: '#ab47bc', face: '🌷' },
]

class AvatarManagerStore {
  private cache: Map<string, HTMLCanvasElement> = new Map()

  /**
   * 获取头像 canvas 元素（用于 drawImage）
   * @param userId 用户ID
   * @param nickname 昵称
   * @param avatarEmoji 数据库中的 avatar 字段（emoji）
   * @param isBot 是否为机器人
   * @param size 头像尺寸
   */
  getAvatar(userId: string, nickname: string, avatarEmoji: string, isBot: boolean, size: number): HTMLCanvasElement {
    const key = `${userId}_${size}`
    if (this.cache.has(key)) return this.cache.get(key)!

    const canvas = document.createElement('canvas')
    canvas.width = size * 2
    canvas.height = size * 2
    const ctx = canvas.getContext('2d')!

    const hash = this.hashCode(userId)
    const styles = isBot ? BOT_STYLES : AVATAR_STYLES
    const style = styles[Math.abs(hash) % styles.length]

    // 绘制圆形头像
    const cx = size
    const cy = size
    const r = size - 2

    // 背景渐变
    const grad = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.3, 0, cx, cy, r)
    grad.addColorStop(0, this.lighten(style.bg, 20))
    grad.addColorStop(1, style.bg)
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = grad
    ctx.fill()

    // 边框
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'
    ctx.lineWidth = 2
    ctx.stroke()

    // 使用 emoji 或昵称首字
    const displayChar = avatarEmoji || nickname.charAt(0) || '?'
    const fontSize = displayChar.length === 1 && /[\u4e00-\u9fff]/.test(displayChar)
      ? r * 0.9 : r * 1.0

    ctx.font = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "PingFang SC", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#fff'
    ctx.fillText(displayChar, cx, cy + 2)

    this.cache.set(key, canvas)
    return canvas
  }

  /** 清除缓存 */
  clear(): void {
    this.cache.clear()
  }

  private hashCode(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i)
      hash |= 0
    }
    return hash
  }

  private lighten(hex: string, amount: number): string {
    const num = parseInt(hex.replace('#', ''), 16)
    const r = Math.min(255, ((num >> 16) & 0xFF) + amount)
    const g = Math.min(255, ((num >> 8) & 0xFF) + amount)
    const b = Math.min(255, (num & 0xFF) + amount)
    return `rgb(${r},${g},${b})`
  }
}

export const avatarManager = new AvatarManagerStore()
