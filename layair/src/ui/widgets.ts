/**
 * 倒子麻将 · LayAir 基础控件
 *
 * 牌、骰子、牌墙墩、文本与按钮。全部用 Graphics 矢量绘制 + Text，
 * 不引用任何图片资源，微信小游戏构建时不需要处理图集。
 */

import { COLORS, FONT_SANS, FONT_SERIF, HONOR_COLOR, SUIT_COLOR, TILE_RATIO } from './theme'

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
    const h = Math.round(w * TILE_RATIO)
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
   * 立着的牌（手牌 / 对家牌背）。
   * 顶面是一条向后收窄的梯形，正面在下方，右侧留一条侧面；
   * 所有面之间压黑线，牌与牌之间再留一条外部黑缝。
   */
  /**
   * 立着的牌（手牌 / 亮牌）。
   * 顶部一条"厚度"带：绿 30% + 白 70%；下面是整块象牙白牌面。
   * 全部是正长方形——不做梯形、不留侧边厚度、不套内框。
   */
  /**
   * 立着的牌（手牌 / 亮牌）。
   * 一条「厚度」带：绿 30% + 白 70%；其余是整块象牙白牌面。
   * 全部是正长方形——不做梯形、不留侧边厚度、不套内框。
   */
  private drawStandingFace(tile: string, w: number, h: number, stripAtBottom = false) {
    const g = this.graphics
    const depth = Math.max(5, Math.round(h * 0.2))
    const greenH = Math.max(2, Math.round(depth * 0.3))
    const whiteH = depth - greenH
    const stripY = stripAtBottom ? h - depth : 0
    const faceY = stripAtBottom ? 0 : depth
    const faceH = h - depth
    g.drawRect(0, stripY, w, greenH, '#2F7A5E')
    g.drawRect(0, stripY + greenH, w, whiteH, '#FDF9EF')
    g.drawRect(0, faceY, w, faceH, '#F2E7CE')
    // 牌与牌紧挨着：只留一条极淡的右边缘线分开，不做整圈边框
    g.drawRect(w - 1, 0, 1, h, 'rgba(120,100,70,0.2)')
    this.drawTileText(tile, w, faceY, faceH)
  }

  /** 扣着的牌（对家牌背）：同一个长方形，顶部同样是绿 30% + 白 70%，牌身整块绿 */
  /** 扣着的牌（对家牌背）：同一个长方形，顶部同样是绿 30% + 白 70%，牌身整块绿 */
  private drawStandingBack(w: number, h: number, stripAtBottom = false) {
    const g = this.graphics
    const depth = Math.max(5, Math.round(h * 0.2))
    const greenH = Math.max(2, Math.round(depth * 0.3))
    const whiteH = depth - greenH
    const stripY = stripAtBottom ? h - depth : 0
    const bodyY = stripAtBottom ? 0 : depth
    g.drawRect(0, stripY, w, greenH, '#2F7A5E')
    g.drawRect(0, stripY + greenH, w, whiteH, '#FDF9EF')
    g.drawRect(0, bodyY, w, h - depth, '#2C7459')
    g.drawRect(w - 1, 0, 1, h, 'rgba(10,40,30,0.26)')
  }

  /**
   * 摊在桌面上的牌（牌河 / 副露 / 打出的牌）。
   * 看的是牌面本身，右侧和下侧露出一点厚度，外圈压黑线。
   */
  private drawFlat(tile: string, w: number, h: number, back: boolean) {
    const g = this.graphics
    const edge = Math.max(2, Math.round(h * 0.09))
    const topW = w - edge
    const topH = h - edge
    const r = Math.max(3, Math.round(w * 0.09))
    const black = '#06100C'
    const face = back ? '#2C7459' : '#F2E7CE'
    const light = back ? '#3C9374' : '#FBF4E2'
    const dark = back ? '#1F553F' : '#E4D3B0'

    g.drawRoundRect(2, 3, topW, topH, r, r, r, r, 'rgba(2,10,7,0.34)')
    g.drawRoundRect(0, 0, w, h, r, r, r, r, '#07110D')
    // 底面厚度
    g.drawRect(topW - 1, edge, edge + 1, topH, back ? '#1B4A37' : '#D2BF98')
    g.drawRect(edge, topH - 1, topW, edge + 1, back ? '#173D2D' : '#C8B48C')
    // 牌面
    g.drawRoundRect(0, 0, topW, topH, r, r, r, r, face, black, 1.6)
    if (back) {
      g.drawRect(2, 2, topW - 4, Math.max(1, topH * 0.44), light)
      g.drawRect(2, 2, topW - 4, Math.max(1, topH * 0.05), 'rgba(255,255,255,0.3)')
      g.drawRoundRect(1.5, 1.5, topW - 3, topH - 3, Math.max(2, r - 1), Math.max(2, r - 1), Math.max(2, r - 1), Math.max(2, r - 1), null as any, 'rgba(185,235,210,0.22)', 1)
    } else {
      g.drawRect(2, 2, topW - 4, Math.max(1, topH * 0.36), light)
      g.drawRect(2, 2 + topH * 0.36, topW - 4, Math.max(1, topH * 0.5), '#F7EEDA')
      g.drawRect(2, 2 + topH * 0.86, topW - 4, Math.max(1, topH * 0.12), dark)
      g.drawRect(2, 2, topW - 4, Math.max(1, topH * 0.025), 'rgba(255,255,255,0.95)')
      g.drawRoundRect(1.5, 1.5, topW - 3, topH - 3, Math.max(2, r - 1), Math.max(2, r - 1), Math.max(2, r - 1), Math.max(2, r - 1), null as any, 'rgba(143,120,82,0.42)', 1)
      this.drawTileText(tile, topW, 0, topH)
    }
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
          height: faceH,
          x: 2,
          y
        })
      )
    } else {
      const rank = tile.charAt(0)
      this.addChild(
        makeText(rank, {
          size: textW * 0.5,
          color,
          bold: true,
          font: FONT_SERIF,
          align: 'center',
          valign: 'middle',
          width: textW,
          height: faceH * 0.72,
          x: 2,
          y
        })
      )
      const suitText = makeText(suit, {
        size: textW * 0.27,
        color,
        bold: true,
        align: 'center',
        valign: 'middle',
        width: textW,
        height: faceH * 0.28,
        x: 2,
        y: y + faceH * 0.72
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
