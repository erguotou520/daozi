/**
 * 倒子麻将 · LayAir 基础控件
 *
 * 牌、骰子、牌墙墩、文本与按钮。牌面优先用图集里的真实牌面贴图，
 * 图集未就绪时退回 Canvas 文字；其余控件仍用 Graphics 矢量绘制 + Text，
 * 微信小游戏构建时只需要额外处理一张 92KB 的牌面图集。
 */

import {
  COLORS,
  FONT_SANS,
  FONT_SERIF,
  HONOR_COLOR,
  SUIT_COLOR,
  TILE_BAND_RATIO,
  TILE_FACE_RATIO,
  TILE_RATIO
} from './theme'
import { tileArt } from './tileArt'

export interface TextOpts {
  size: number
  color: string
  bold?: boolean
  font?: string
  align?: string
  valign?: string
  width?: number
  height?: number
  x?: number
  y?: number
  alpha?: number
}

export function makeText(content: string, opts: TextOpts): Laya.Text {
  const t = new Laya.Text()
  t.font = opts.font ?? FONT_SANS
  t.text = content
  t.fontSize = opts.size
  t.color = opts.color
  t.bold = !!opts.bold
  t.align = opts.align ?? 'left'
  t.valign = opts.valign ?? 'top'
  t.wordWrap = false
  t.overflow = Laya.Text.HIDDEN
  if (opts.width !== undefined) t.width = opts.width
  if (opts.height !== undefined) t.height = opts.height
  t.x = opts.x ?? 0
  t.y = opts.y ?? 0
  if (opts.alpha !== undefined) t.alpha = opts.alpha
  return t
}

/** 一块圆角矩形底板，可选描边 */
export function makePanel(w: number, h: number, radius: number, fill: string, border?: string, borderWidth = 1): Laya.Sprite {
  const s = new Laya.Sprite()
  s.size(w, h)
  if (border) {
    s.graphics.drawRoundRect(0, 0, w, h, radius, radius, radius, radius, fill, border, borderWidth)
  } else {
    s.graphics.drawRoundRect(0, 0, w, h, radius, radius, radius, radius, fill)
  }
  return s
}

export type ButtonFace = 'tile' | 'chip' | 'ghost'

export interface ButtonOpts {
  width: number
  height: number
  label: string
  fontSize?: number
  face?: ButtonFace
  onClick: () => void
}

/** 可按压的按钮：牌面 / 描边 chip / 幽灵按钮 */
export function makeButton(opts: ButtonOpts): Laya.Sprite {
  const { width, height, label } = opts
  const face = opts.face ?? 'tile'
  const s = new Laya.Sprite()
  s.size(width, height)
  const radius = Math.max(4, Math.min(height * 0.32, 10))

  if (face === 'tile') {
    const g = s.graphics
    const bodyH = height - 3
    const inner = Math.max(2, radius - 1)
    // 落影：整块圆角，往下错 2px；不再单独画一条方形底座
    g.drawRoundRect(0, 2, width, bodyH, radius, radius, radius, radius, 'rgba(6,20,15,0.28)')
    // 牌面本体
    g.drawRoundRect(0, 0, width, bodyH, radius, radius, radius, radius, '#EFE3C8')
    // 只在顶部留一道细高光、底部留一道细暗边，避免中间出现一条直邦邦的分界
    g.drawRoundRect(2, 1.5, width - 4, Math.max(2, bodyH * 0.07), inner, inner, inner, inner, 'rgba(255,255,255,0.6)')
    g.drawRoundRect(2, bodyH * 0.9, width - 4, Math.max(2, bodyH * 0.08), inner, inner, inner, inner, 'rgba(170,140,90,0.1)')
    g.drawRoundRect(0.5, 0.5, width - 1, bodyH - 1, radius, radius, radius, radius, null as any, 'rgba(184,164,131,0.78)', 1)
  } else if (face === 'chip') {
    const g = s.graphics
    const inner = Math.max(2, radius - 1)
    g.drawRoundRect(0, 0, width, height, radius, radius, radius, radius, 'rgba(255,255,255,0.065)', 'rgba(217,180,95,0.48)', 1)
    g.drawRoundRect(2, 1.5, width - 4, Math.max(2, height * 0.2), inner, inner, inner, inner, 'rgba(255,255,255,0.05)')
  } else {
    s.graphics.drawRoundRect(0, 0, width, height, radius, radius, radius, radius, 'rgba(0,0,0,0.08)', 'rgba(217,180,95,0.4)', 1)
  }

  const color = face === 'tile' ? COLORS.ink : face === 'ghost' ? COLORS.brass : COLORS.ivory
  const text = makeText(label, {
    size: opts.fontSize ?? Math.min(15, height * 0.5),
    color,
    bold: face === 'tile',
    font: face === 'tile' ? FONT_SERIF : FONT_SANS,
    align: 'center',
    valign: 'middle',
    width,
    height: face === 'tile' ? height - 3 : height
  })
  if (face === 'tile') {
    // 象牙面上的字压一点白色高光，看起来是刻进牌面的
    text.shadowColor = 'rgba(255,255,255,0.35)'
    text.shadowOffsetX = 0
    text.shadowOffsetY = 1
    text.shadowBlur = 0
  }
  s.addChild(text)

  s.hitArea = new Laya.Rectangle(0, 0, width, height)
  s.mouseEnabled = true
  let pressed = false
  const press = () => {
    if (pressed) return
    pressed = true
    s.y += 2
  }
  const release = () => {
    if (!pressed) return
    pressed = false
    s.y -= 2
  }
  s.on(Laya.Event.MOUSE_DOWN, null, press)
  s.on(Laya.Event.MOUSE_UP, null, release)
  s.on(Laya.Event.MOUSE_OUT, null, release)
  s.on(Laya.Event.CLICK, null, opts.onClick)
  return s
}

export interface TileOpts {
  width: number
  back?: boolean
  rotate?: number
  dim?: boolean
  marked?: boolean
  /** 摊在桌面上（牌河 / 副露 / 打出的牌）；默认是立着的牌 */
  flat?: boolean
  /** 顶部厚度条放到牌的下沿：左右两家转 90° 后，白条正好朝外侧 */
  stripAtBottom?: boolean
}

/**
 * 一张有厚度的牌：象牙牌面 + 青玉侧厚，牌背是墨绿。
 * 旋转的牌把 pivot 放在中心，调用方按中心点摆位。
 */
export class TileView extends Laya.Sprite {
  readonly w: number
  readonly h: number

  constructor(tile: string, opts: TileOpts) {
    super()
    const w = opts.width
    // 平躺的明牌只看顶面，牌面比例就是贴图比例；立牌还要加一条顶部厚度带
    const h = Math.round(w * (opts.flat ? TILE_FACE_RATIO : TILE_RATIO))
    this.w = w
    this.h = h
    this.size(w, h)

    if (opts.flat) {
      this.drawFlat(tile, w, h, !!opts.back)
    } else if (opts.back) {
      this.drawStandingBack(w, h, !!opts.stripAtBottom)
    } else {
      this.drawStandingFace(tile, w, h, !!opts.stripAtBottom)
    }

    if (opts.marked) {
      this.graphics.drawRoundRect(0.5, 0.5, w - 1, h - 1, Math.max(3, w * 0.08), Math.max(3, w * 0.08), Math.max(3, w * 0.08), Math.max(3, w * 0.08), null as any, COLORS.brass, 2)
    }
    if (opts.dim) this.alpha = 0.48

    if (opts.rotate) {
      this.pivot(w / 2, h / 2)
      this.rotation = opts.rotate
    }
  }

  /**
   * 立着的牌（手牌 / 亮牌）。
   * 顶部（或左右家转 90° 后的外沿）留厚度带：绿 30% + 白 70%。
   * 贴图只铺厚度带下面的牌面，牌面比例固定 128:176，不会被拉伸。
   */
  private drawStandingFace(tile: string, w: number, h: number, stripAtBottom = false) {
    const g = this.graphics
    const depth = Math.max(5, Math.round(w * TILE_BAND_RATIO))
    const greenH = Math.max(2, Math.round(depth * 0.3))
    const whiteH = depth - greenH
    const faceY = stripAtBottom ? 0 : depth
    const faceH = h - depth
    if (stripAtBottom) {
      // 左右家：带在底部，白在内、绿在最外沿；整块转 90° 后绿边朝外
      const stripY = h - depth
      g.drawRect(0, stripY, w, greenH, '#43A882')
      g.drawRect(0, stripY + greenH, w, whiteH, '#FDF9EF')
    } else {
      // 自家：带在顶部，绿在上（靠背）、白在下（靠牌面）
      g.drawRect(0, 0, w, greenH, '#43A882')
      g.drawRect(0, greenH, w, whiteH, '#FDF9EF')
    }
    g.drawRect(0, faceY, w, faceH, '#F2E7CE')
    if (!this.drawTileArt(tile, 0, faceY, w, faceH)) {
      this.drawTileText(tile, w, faceY, faceH)
    }
    // 贴图/白牌面与桌面颜色接近：外沿压一条暗线，绿白厚度带才立得起来
    g.drawRect(0, stripAtBottom ? h - 1 : 0, w, 1, 'rgba(8,30,22,0.5)')
    // 牌与牌紧挨着：只留一条极淡的右边缘线分开，不做整圈边框；画在贴图上面
    g.drawRect(w - 1, 0, 1, h, 'rgba(120,100,70,0.2)')
  }

  /**
   * 扣着的牌（对家 / 左右家牌背）。
   * - 对家：白在上、绿在下（绿靠着牌背），下面是深一档的绿牌背；
   * - 左右家：带在底部，绿在最外沿，转 90° 后绿边朝外。
   * 牌背的绿比顶部厚度带更深一点，模拟背面受光少。
   */
  private drawStandingBack(w: number, h: number, stripAtBottom = false) {
    const g = this.graphics
    const depth = Math.max(5, Math.round(w * TILE_BAND_RATIO))
    const greenH = Math.max(2, Math.round(depth * 0.3))
    const whiteH = depth - greenH
    const bodyY = stripAtBottom ? 0 : depth
    g.drawRect(0, bodyY, w, h - depth, '#358F6D')
    if (stripAtBottom) {
      const stripY = h - depth
      g.drawRect(0, stripY, w, greenH, '#43A882')
      g.drawRect(0, stripY + greenH, w, whiteH, '#FDF9EF')
    } else {
      g.drawRect(0, 0, w, whiteH, '#FDF9EF')
      g.drawRect(0, whiteH, w, greenH, '#43A882')
    }
    // 外沿暗线，让牌背和桌布分开
    g.drawRect(0, stripAtBottom ? h - 1 : 0, w, 1, 'rgba(6,26,19,0.55)')
    g.drawRect(w - 1, 0, 1, h, 'rgba(10,40,30,0.26)')
  }

  /**
   * 摊在桌面上的牌（牌河 / 副露 / 打出的牌）。
   * 从顶部看只能看到顶面，所以不画厚度带：
   * 明牌铺满牌面贴图，暗牌（暗杠）只露一块更深的绿牌背。
   */
  private drawFlat(tile: string, w: number, h: number, back: boolean) {
    const g = this.graphics
    if (back) {
      g.drawRect(0, 0, w, h, '#358F6D')
      // 顶面一道很淡的高光，避免整块绿糊成一片
      g.drawRect(0, 0, w, Math.max(1, Math.round(h * 0.04)), 'rgba(255,255,255,0.06)')
    } else {
      g.drawRect(0, 0, w, h, '#F2E7CE')
      if (!this.drawTileArt(tile, 0, 0, w, h)) this.drawTileText(tile, w, 0, h)
    }
    g.drawRect(w - 1, 0, 1, h, 'rgba(120,100,70,0.2)')
  }

  /** 整张牌面贴图铺满；图集未就绪时返回 false，交给文字兜底 */
  private drawTileArt(tile: string, x: number, y: number, w: number, h: number): boolean {
    const art = tileArt.texture(tile)
    if (!art) return false
    this.graphics.drawImage(art, x, y, w, h)
    return true
  }

  private drawTileText(tile: string, faceW: number, y: number, faceH: number) {
    const honor = tile.length === 1 && HONOR_COLOR[tile] !== undefined
    const suit = honor ? '字' : tile.charAt(1)
    const color = honor ? HONOR_COLOR[tile] : SUIT_COLOR[suit] ?? COLORS.ink
    const textW = faceW - 4

    if (honor) {
      this.addChild(
        makeText(tile, {
          size: textW * 0.52,
          color,
          bold: true,
          font: FONT_SERIF,
          align: 'center',
          valign: 'middle',
          width: textW,
          height: faceH * 0.92,
          x: 2,
          y
        })
      )
    } else {
      const rank = tile.charAt(0)
      // 数字 + 汉字之间别再拉那么开，整体往上提一点，别贴底
      this.addChild(
        makeText(rank, {
          size: textW * 0.5,
          color,
          bold: true,
          font: FONT_SERIF,
          align: 'center',
          valign: 'middle',
          width: textW,
          height: faceH * 0.58,
          x: 2,
          y
        })
      )
      const suitText = makeText(suit, {
        size: textW * 0.26,
        color,
        bold: true,
        align: 'center',
        valign: 'middle',
        width: textW,
        height: faceH * 0.26,
        x: 2,
        y: y + faceH * 0.56
      })
      suitText.alpha = 0.9
      this.addChild(suitText)
    }
  }
}

/**
 * 牌山上一墩：两层牌，各自占半格。
 * 摸走哪一层就少哪一层——只剩上层就只画上半格，只剩下层就只画下半格，
 * 整墩不会因为剩一只牌就撑满两格高度。
 */
export function makeWallStack(top: boolean, bottom: boolean, w: number, ht: number): Laya.Sprite {
  const s = new Laya.Sprite()
  s.size(w, ht)
  if (!top && !bottom) return s

  const g = s.graphics
  const th = ht * 0.52
  const black = '#06100C'
  const drawTile = (y: number, hh: number) => {
    const edge = Math.max(1, Math.round(hh * 0.12))
    const faceH = hh - edge
    const r = Math.max(2, Math.round(w * 0.09))
    // 顶面直接铺满整格，牌与牌之间只留 1px 黑边，整面墙才连得起来
    g.drawRoundRect(0, y, w, faceH, r, r, 1, 1, '#2F7A5E', black, 1)
    g.drawRect(2, y + 2, Math.max(1, w - 4), Math.max(1, faceH * 0.28), 'rgba(255,255,255,0.16)')
    g.drawRoundRect(1.5, y + 1.5, Math.max(1, w - 3), Math.max(1, faceH - 3), Math.max(1, r - 1), Math.max(1, r - 1), 1, 1, null as any, 'rgba(190,235,210,0.24)', 1)
    // 下侧厚度
    g.drawRect(0, y + faceH, w, edge, '#1E543E')
    g.drawRect(0, y + faceH, w, 1, 'rgba(255,255,255,0.2)')
    g.drawRect(0, y + hh - 1, w, 1, black)
    // 左右黑缝
    g.drawRect(0, y, 1, hh, black)
    g.drawRect(w - 1, y, 1, hh, black)
  }

  if (top) drawTile(0, th)
  if (bottom) drawTile(ht - th, th)
  return s
}

/** 骰子：3×3 点阵 */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8]
}

export class DiceView extends Laya.Sprite {
  private value = 1
  private readonly diceSize: number

  constructor(size: number) {
    super()
    this.diceSize = size
    this.size(size, size)
    this.redraw()
  }

  setValue(value: number) {
    if (value === this.value) return
    this.value = value
    this.redraw()
  }

  private redraw() {
    const s = this.diceSize
    const g = this.graphics
    g.clear()
    const r = s * 0.22
    // 影子必须和骰身同尺寸，只是往下错开一点；否则影子比骰身高，底下会露出直角边
    g.drawRoundRect(0, s * 0.07, s, s * 0.93, r, r, r, r, '#8E7A4F')
    g.drawRoundRect(0, 0, s, s * 0.93, r, r, r, r, '#F5EAD0', '#B8A483', 1)
    g.drawRect(2, 2, s - 4, Math.max(1, s * 0.06), 'rgba(255,255,255,0.8)')

    const pad = s * 0.17
    const cell = (s - pad * 2) / 3
    const radius = cell * 0.36
    for (const index of PIPS[this.value] ?? PIPS[1]) {
      const col = index % 3
      const row = Math.floor(index / 3)
      const cx = pad + cell * (col + 0.5)
      const cy = pad + cell * (row + 0.5)
      g.drawCircle(cx, cy, radius, '#C0392B')
      g.drawCircle(cx - radius * 0.2, cy - radius * 0.2, radius * 0.34, 'rgba(255,255,255,0.35)')
    }
  }
}

/* ------------------------------------------------------------------ *
 * 图标：分享 / 声音
 *
 * 右上角这几个按钮原来是「享 / 音 / 静」几个汉字，现在改成矢量图标：
 * 全部按 0~1 的比例画在 size × size 的方块里，所以 30 逻辑像素和 57 像素都清楚。
 * ------------------------------------------------------------------ */

/** 分享：三个节点 + 两条连线（微信 / 安卓常见的分享符号） */
export function drawShareGlyph(g: Laya.Graphics, size: number, color: string) {
  const line = Math.max(1.2, size * 0.055)
  const radius = size * 0.095
  const hubX = size * 0.28
  const hubY = size * 0.5
  const topX = size * 0.72
  const topY = size * 0.25
  const botX = size * 0.72
  const botY = size * 0.75
  g.drawLine(hubX, hubY, topX, topY, color, line)
  g.drawLine(hubX, hubY, botX, botY, color, line)
  g.drawCircle(hubX, hubY, radius, color)
  g.drawCircle(topX, topY, radius, color)
  g.drawCircle(botX, botY, radius, color)
}

/**
 * 一段圆弧，只描边。
 * 没用 Graphics.drawPath / arcTo：在小尺寸下把弧拆成几段直线更稳，也不会被某些
 * 渲染路径丢掉；段数够多，30 像素的图标上看不出棱角。
 */
function strokeArc(
  g: Laya.Graphics,
  cx: number,
  cy: number,
  radius: number,
  spread: number,
  color: string,
  lineWidth: number,
  segments = 6
) {
  let prevX = 0
  let prevY = 0
  for (let i = 0; i <= segments; i += 1) {
    const angle = -spread + (2 * spread * i) / segments
    const x = cx + radius * Math.cos(angle)
    const y = cy + radius * Math.sin(angle)
    if (i > 0) g.drawLine(prevX, prevY, x, y, color, lineWidth)
    prevX = x
    prevY = y
  }
}

/** 声音：喇叭 + 两道声波；静音时喇叭上压一道斜杠 */
export function drawSpeakerGlyph(g: Laya.Graphics, size: number, color: string, muted: boolean, mutedColor: string) {
  const poly: number[] = []
  for (const [x, y] of [
    [0.18, 0.39],
    [0.31, 0.39],
    [0.48, 0.21],
    [0.48, 0.79],
    [0.31, 0.61],
    [0.18, 0.61]
  ]) {
    poly.push(x * size, y * size)
  }
  g.drawPoly(0, 0, poly, color)

  if (muted) {
    const lineWidth = Math.max(1.6, size * 0.065)
    g.drawLine(size * 0.56, size * 0.32, size * 0.86, size * 0.68, mutedColor, lineWidth)
    g.drawLine(size * 0.86, size * 0.32, size * 0.56, size * 0.68, mutedColor, lineWidth)
    return
  }

  const lineWidth = Math.max(1.4, size * 0.058)
  strokeArc(g, size * 0.49, size * 0.5, size * 0.15, 0.62, color, lineWidth)
  strokeArc(g, size * 0.49, size * 0.5, size * 0.27, 0.62, color, lineWidth)
}
