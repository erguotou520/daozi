/**
 * 倒子麻将 · LayAir 牌桌
 *
 * 把 web 端的牌桌流程完整搬到 LayAir：掷骰 → 发牌 → 定缺 → 摸打 → 碰杠成 → 结算 → 局流程。
 * UI 全部用矢量绘制，交互用 Laya 的鼠标/触摸事件，微信小游戏可直接运行。
 *
 * 所有字号与控件尺寸都乘一个基于牌桌宽度的比例 `scale`，这样手机竖屏
 * （750 逻辑宽）和桌面横屏预览是同一套相对比例，不会出现手机上字太小的问题。
 */

import {
  applyAction,
  chooseAIAction,
  forbiddenDiscardsFor,
  legalActions,
  playableDiscards,
  remainingTiles,
  settleHand,
  shortageTiles,
  wallVisualOf,
  type HandSettlement,
  type HandState,
  type RoundAction
} from '../game/game'
import { dealTrace } from '../game/table'
import { createMatch, endHand, startHand, STARTING_POINTS, type MatchState } from '../game/match'
import { meldTiles, tileOrder, type Meld, type NumberSuit, type Tile } from '../game/score'
import { COLORS, FONT_SERIF, SEAT_NAMES, TILE_RATIO } from './theme'
import { DiceView, makeButton, makePanel, makeText, makeWallStack, TileView } from './widgets'
import { Table3D } from './Table3D'
import {
  clearAllData,
  createHistory,
  loadHistory,
  loadSavedGame,
  saveGame,
  saveHistory,
  type HistoryState,
  type SavedGame
} from './storage'

const STACKS = 17
const PER_LINE = 13
const SHORTAGE_OPTIONS: NumberSuit[] = ['万', '筒', '条']
/** 设计基准：牌桌宽约 375 逻辑像素时 scale = 1 */
const BASE_BOARD = 375

type TablePhase = 'idle' | 'rolling' | 'dealing' | 'playing' | 'round-over'

interface RoundSummary {
  roundIndex: number
  hands: number
  money: number[]
  points: number[]
  total: number[]
}

interface Metrics {
  landscape: boolean
  W: number
  H: number
  boardW: number
  boardH: number
  boardX: number
  boardY: number
  bw: number
  scale: number
  ringW: number
  ringH: number
  ringX: number
  ringY: number
  /** 上下两面牌墙每墩的宽度 */
  wallWX: number
  /** 左右两面牌墙每墩的宽度 */
  wallWY: number
  wallT: number
  handW: number
  handH: number
  /** 对家（上方）手牌尺寸 */
  oppW: number
  oppH: number
  /** 上家/下家（左右）手牌尺寸 */
  sideW: number
  sideH: number
  /** 兼容旧代码：等于对家手牌尺寸 */
  seatW: number
  seatH: number
  discardW: number
  discardH: number
  meldW: number
  meldH: number
  laneTop: number
  laneBottom: number
  laneLeft: number
  laneRight: number
  panelW: number
  panelH: number
}

const HAS_WINDOW = typeof window !== 'undefined'
let FAST = false
/** 调试用：按 A 让我这一家也交给 AI 自动打，便于完整跑一把/一局 */
let AUTO = false
try {
  if (HAS_WINDOW) {
    const search = (window as any).location?.search ?? ''
    FAST = search.indexOf('fast=1') >= 0
  }
} catch {
  FAST = false
}

const moneyText = (value: number) => `${value > 0 ? '+' : ''}${Number(value.toFixed(1))}`

export class TableView {
  private owner: Laya.Sprite
  private root: Laya.Sprite
  private bgLayer: Laya.Sprite
  private boardLayer: Laya.Sprite
  private content: Laya.Sprite
  private diceLayer: Laya.Sprite
  private overlay: Laya.Sprite
  private threeView: Laya.Sprite
  private three: Table3D | null = null
  private use3D = true
  private diceViews: DiceView[] = []

  private m: Metrics
  private phase: TablePhase = 'idle'
  private board: MatchState | null = null
  private hand: HandState | null = null
  private dice: { a: number; b: number } | null = null
  private shownDice = { a: 1, b: 1 }
  private dealProgress = 0
  private consumed = new Set<string>()
  private dealtCounts = [0, 0, 0, 0]
  private roundSummary: RoundSummary | null = null
  private spinTimer: ReturnType<typeof setInterval> | null = null
  private autoCloseScheduled = false
  private declinedWin = false
  private history: HistoryState = createHistory()
  private showStats = false
  private showExit = false
  private rotateLandscape = false
  private viewW = 0
  private viewH = 0

  constructor(owner: Laya.Sprite, viewport?: { rotate: boolean; width: number; height: number }) {
    this.owner = owner
    this.rotateLandscape = viewport?.rotate ?? false
    this.viewW = viewport?.width ?? Laya.stage.width
    this.viewH = viewport?.height ?? Laya.stage.height
    this.root = new Laya.Sprite()
    this.root.name = 'DaoziRoot'
    this.root.size(this.viewW, this.viewH)
    owner.addChild(this.root)

    this.threeView = new Laya.Sprite()
    this.threeView.name = 'Table3DView'
    this.threeView.size(this.viewW, this.viewH)
    this.threeView.mouseEnabled = false
    this.threeView.mouseThrough = true
    this.root.addChildAt(this.threeView, 0)

    if (HAS_WINDOW && ((window as any).location?.search ?? '').indexOf('2d=1') >= 0) this.use3D = false

    this.bgLayer = new Laya.Sprite()
    this.boardLayer = new Laya.Sprite()
    this.content = new Laya.Sprite()
    this.diceLayer = new Laya.Sprite()
    this.overlay = new Laya.Sprite()
    this.root.addChild(this.bgLayer)
    this.root.addChild(this.boardLayer)
    this.root.addChild(this.content)
    this.root.addChild(this.diceLayer)
    this.root.addChild(this.overlay)
    this.applyRootTransform()

    this.history = loadHistory()
    const saved = loadSavedGame()
    if (saved) this.restoreGame(saved)

    this.m = this.measure()
    this.content.pos(this.m.boardX, this.m.boardY)
    this.drawChrome()
    this.render()
    Laya.timer.once(40, this, this.init3D)

    Laya.stage.on(Laya.Event.KEY_DOWN, this, this.onKeyDown)
    this.createDice()
    this.positionDice()
    if (this.phase === 'playing') this.schedule(600, () => this.tick())
  }

  private init3D() {
    if (!this.use3D || this.three) return
    try {
      this.three = new Table3D(this.viewW, this.viewH)
      this.threeView.visible = true
      this.threeView.size(this.viewW, this.viewH)
      this.bgLayer.visible = false
      this.boardLayer.visible = false
      this.diceLayer.visible = false
      this.render()
    } catch (err) {
      Laya.timer.once(120, this, this.init3D)
    }
  }

  private sync3D() {
    if (!this.three) return
    const dice = this.phase === 'rolling' ? this.shownDice : this.dice ?? this.shownDice
    this.three.sync(this.hand, this.myHandTiles(), dice, this.phase === 'rolling', this.wallVisual(), this.dealtCounts, this.phase === 'dealing')
    this.threeView.graphics.clear()
    this.threeView.graphics.drawTexture(this.three.texture, 0, 0, this.viewW, this.viewH)
  }

  private is3D(): boolean {
    return this.use3D && !!this.three
  }

  /** 以 375 牌桌宽/高为基准的缩放 */
  private u(value: number): number {
    return Math.round(value * this.m.scale)
  }

  /** 横屏桌面的伪透视：顶部 80% 宽，底部 100% 宽 */
  private persp(y: number): number {
    const ratio = Math.min(1, Math.max(0, (y - this.m.ringY) / Math.max(1, this.m.ringH)))
    return 0.8 + 0.2 * ratio
  }

  /* ------------------------------------------------------------------ *
   * 布局
   * ------------------------------------------------------------------ */

  private measure(): Metrics {
    const W = Math.max(320, this.viewW || Laya.stage.width)
    const H = Math.max(240, this.viewH || Laya.stage.height)
    return this.rotateLandscape || W > H ? this.measureLandscape(W, H) : this.measurePortrait(W, H)
  }

  /** 竖屏手机上把整个牌桌横过来：根节点旋转 90°，按横屏比例铺满竖屏画布 */
  private applyRootTransform() {
    this.root.size(this.viewW, this.viewH)
    this.root.scale(1, 1)
    this.root.pivot(0, 0)
    if (this.rotateLandscape) {
      this.root.rotation = 90
      this.root.pos(this.viewH, 0)
    } else {
      this.root.rotation = 0
      this.root.pos(0, 0)
    }
  }

  /** 由 Main 在屏幕尺寸变化时调用，保留当前牌局，只重排布局 */
  applyViewport(rotate: boolean, width: number, height: number) {
    this.rotateLandscape = rotate
    this.viewW = width
    this.viewH = height
    this.three?.dispose()
    this.three = null
    this.threeView.graphics.clear()
    this.threeView.size(width, height)
    this.threeView.visible = false
    this.bgLayer.visible = true
    this.boardLayer.visible = true
    this.applyRootTransform()
    this.m = this.measure()
    this.content.pos(this.m.boardX, this.m.boardY)
    this.drawChrome()
    this.render()
    if (this.use3D) Laya.timer.once(0, this, this.init3D)
  }

  /** 横屏：牌桌铺满整屏，本家/对家手牌大，左右两家手牌小 */
  private measureLandscape(W: number, H: number): Metrics {
    const margin = Math.max(12, Math.round(H * 0.026))
    // 微信小游戏横屏时避开刘海 / Home 指示条；浏览器没有 safeArea 就按普通边距
    let safeLeft = 0
    let safeRight = 0
    let safeTop = 0
    let safeBottom = 0
    try {
      const info = (globalThis as any).wx?.getSystemInfoSync?.()
      if (info?.safeArea && info.screenWidth && info.screenHeight) {
        const kx = W / info.screenWidth
        const ky = H / info.screenHeight
        safeLeft = Math.min(W * 0.12, Math.max(0, info.safeArea.left * kx))
        safeRight = Math.min(W * 0.12, Math.max(0, (info.screenWidth - info.safeArea.right) * kx))
        safeTop = Math.min(H * 0.12, Math.max(0, info.safeArea.top * ky))
        safeBottom = Math.min(H * 0.12, Math.max(0, (info.screenHeight - info.safeArea.bottom) * ky))
      }
    } catch {
      // 浏览器或旧版本没有 safeArea 时忽略
    }
    const marginL = Math.max(margin, Math.round(safeLeft))
    const marginR = Math.max(margin, Math.round(safeRight))
    const marginT = Math.max(margin, Math.round(safeTop))
    const marginB = Math.max(margin, Math.round(safeBottom))
    const boardW = W - marginL - marginR
    const boardH = H - marginT - marginB
    const boardX = marginL
    const boardY = marginT
    const scale = boardH / BASE_BOARD
    const u = (value: number) => Math.round(value * scale)

    const handW = Math.max(32, Math.round(boardH * 0.094))
    const handH = Math.round(handW * TILE_RATIO)
    const oppW = Math.max(26, Math.round(handW * 0.86))
    const oppH = Math.round(oppW * TILE_RATIO)
    const sideW = Math.max(18, Math.round(boardH * 0.050))
    const sideH = Math.round(sideW * TILE_RATIO)
    const discardW = Math.max(22, Math.round(boardH * 0.055))
    const discardH = Math.round(discardW * TILE_RATIO)
    const meldW = Math.max(18, Math.round(boardH * 0.050))
    const meldH = Math.round(meldW * TILE_RATIO)

    const wallT = u(18)
    const topSeatH = u(16) + oppH + u(6)
    const dockH = u(30)
    const bottomArea = handH + u(8) + dockH + u(8)
    const ringTop = topSeatH + u(4)
    const ringBottom = boardH - bottomArea
    const ringH = Math.max(220, ringBottom - ringTop)

    // 牌山：四面墙的每墩底尺寸一致，只按桌面透视做横向/纵深形变。
    // 牌桌收成居中的梯形（对家 80% 宽），不再把本家这面墙拉成长条。
    const wallLen = Math.max(36, Math.round(boardH * 0.075))
    const ringW = wallLen * STACKS + wallT * 2
    const ringX = Math.round((boardW - ringW) / 2)
    const wallWX = wallLen
    const wallWY = (ringH - wallT * 2) / STACKS

    const lanePad = u(4)
    const laneTop = ringTop + wallT + lanePad
    const laneBottom = ringTop + ringH - wallT - lanePad
    const laneLeft = ringX + wallT + lanePad
    const laneRight = ringX + ringW - wallT - lanePad

    const sideLane = discardH * 2
    const panelW = Math.max(220, Math.min(ringW - sideLane * 2 - u(20), u(270)))
    const panelH = Math.max(170, Math.min(ringH * 0.82, u(150)))

    return {
      landscape: true,
      W,
      H,
      boardW,
      boardH,
      boardX,
      boardY,
      bw: boardH,
      scale,
      ringW,
      ringH,
      ringX,
      ringY: ringTop,
      wallWX,
      wallWY,
      wallT,
      handW,
      handH,
      oppW,
      oppH,
      sideW,
      sideH,
      seatW: oppW,
      seatH: oppH,
      discardW,
      discardH,
      meldW,
      meldH,
      laneTop,
      laneBottom,
      laneLeft,
      laneRight,
      panelW,
      panelH
    }
  }

  /** 竖屏：保持原来的牌桌比例 */
  private measurePortrait(W: number, H: number): Metrics {
    const margin = Math.round(Math.min(W, H) * 0.032)
    const availW = W - margin * 2
    const availH = H - margin * 2
    const boardW = Math.round(Math.min(availW, availH * 1.16))
    const boardH = Math.round(Math.min(availH, boardW * 1.5))
    const boardX = Math.round((W - boardW) / 2)
    const boardY = Math.round((H - boardH) / 2)

    const bw = Math.min(boardW / 0.93, boardH / 0.98)
    const scale = bw / BASE_BOARD
    const sideSeat = bw * 0.088
    const ringW = Math.round(Math.min(boardW - sideSeat * 2, boardH * 1.04))
    const ringH = Math.round(boardH * 0.74)
    const ringX = Math.round((boardW - ringW) / 2)
    const ringY = Math.round((boardH - ringH) / 2)

    const wallW = Math.min(ringW, ringH) / 20
    const wallT = wallW * 1.5

    const handW = Math.max(20, Math.round(bw * 0.054))
    const handH = Math.round(handW * TILE_RATIO)
    const seatW = Math.max(11, Math.round(bw * 0.029))
    const seatH = Math.round(seatW * TILE_RATIO)
    const discardW = Math.max(15, Math.round(bw * 0.037))
    const discardH = Math.round(discardW * TILE_RATIO)
    const meldW = Math.max(12, Math.round(bw * 0.031))
    const meldH = Math.round(meldW * TILE_RATIO)

    const laneTop = Math.round(ringY + wallT + 4)
    const laneBottom = Math.round(ringY + ringH - wallT - 4)
    const laneLeft = Math.round(ringX + wallT + 6)
    const laneRight = Math.round(ringX + ringW - wallT - 6)

    const sideLane = discardH
    const panelW = Math.max(180, Math.round(laneRight - laneLeft - sideLane * 2 - 14))
    const panelH = Math.round(Math.min(ringH * 0.9, 150 * scale))

    return {
      landscape: false,
      W,
      H,
      boardW,
      boardH,
      boardX,
      boardY,
      bw,
      scale,
      ringW,
      ringH,
      ringX,
      ringY,
      wallWX: wallW,
      wallWY: wallW,
      wallT,
      handW,
      handH,
      oppW: seatW,
      oppH: seatH,
      sideW: seatW,
      sideH: seatH,
      seatW,
      seatH,
      discardW,
      discardH,
      meldW,
      meldH,
      laneTop,
      laneBottom,
      laneLeft,
      laneRight,
      panelW,
      panelH
    }
  }

  private onKeyDown(event: Laya.Event) {
    // 调试用：F 快速模式，A 自动打（微信里没有键盘，不影响正式玩法）
    if (event.keyCode === 70) FAST = !FAST
    if (event.keyCode === 65) {
      AUTO = !AUTO
      this.tick()
    }
  }

  private pace(factor = 1): number {
    return (FAST ? 0.12 : 1) * factor
  }

  /* ------------------------------------------------------------------ *
   * 背景与桌框
   * ------------------------------------------------------------------ */

  private drawChrome() {
    const m = this.m
    const bg = this.bgLayer
    bg.graphics.clear()
    // 背景：深色环境，让牌桌像一块发光的实体
    const steps = 64
    for (let i = 0; i < steps; i += 1) {
      const t = i / (steps - 1)
      const r = Math.round(10 + (5 - 10) * t)
      const g = Math.round(39 + (19 - 39) * t)
      const b = Math.round(32 + (16 - 32) * t)
      bg.graphics.drawRect(0, Math.round((m.H * i) / steps), m.W, Math.ceil(m.H / steps) + 1, `rgb(${r},${g},${b})`)
    }
    bg.graphics.drawCircle(m.W / 2, -m.H * 0.08, m.W * 0.9, 'rgba(26,86,68,0.45)')

    const rim = Math.max(8, Math.min(16, Math.round(Math.min(m.W, m.H) * 0.016)))
    const board = this.boardLayer
    board.graphics.clear()
    const x = m.boardX
    const y = m.boardY
    const bW = m.boardW
    const bH = m.boardH
    const corner = 24

    // 木沿的投影
    board.graphics.drawRoundRect(x - rim - 3, y - rim + 6, bW + rim * 2 + 6, bH + rim * 2, corner, corner, corner, corner, 'rgba(0,0,0,0.42)')
    // 木沿外圈深色
    board.graphics.drawRoundRect(x - rim - 1, y - rim - 1, bW + rim * 2 + 2, bH + rim * 2 + 2, corner, corner, corner, corner, '#3A2412')
    // 木头主体
    board.graphics.drawRoundRect(x - rim, y - rim, bW + rim * 2, bH + rim * 2, corner, corner, corner, corner, '#8A5A2A')
    // 木沿顶面 / 斜面
    board.graphics.drawRoundRect(x - rim + 2, y - rim + 2, bW + rim * 2 - 4, bH + rim * 2 - 4, corner - 2, corner - 2, corner - 2, corner - 2, '#B07F43')
    board.graphics.drawRoundRect(x - rim + 4, y - rim + 4, bW + rim * 2 - 8, Math.max(3, rim * 0.55), 12, 12, 3, 3, 'rgba(255,224,166,0.28)')
    board.graphics.drawRoundRect(x - rim + 4, y - rim + 4, bW + rim * 2 - 8, bH + rim * 2 - 8, corner - 3, corner - 3, corner - 3, corner - 3, null as any, 'rgba(255,225,170,0.16)', 1)
    // 木沿与毡面之间的黑缝
    board.graphics.drawRoundRect(x - 2, y - 2, bW + 4, bH + 4, corner - 4, corner - 4, corner - 4, corner - 4, '#1A120B')
    // 毡面
    board.graphics.drawRoundRect(x, y, bW, bH, 20, 20, 20, 20, '#17553F')
    board.graphics.drawCircle(x + bW / 2, y + bH * 0.4, bW * 0.48, 'rgba(54,148,115,0.14)')
    // 毡面边缘内阴影
    board.graphics.drawRoundRect(x + 2, y + 2, bW - 4, bH - 4, 18, 18, 18, 18, null as any, 'rgba(0,0,0,0.28)', 3)
    // 黄铜内线
    board.graphics.drawRoundRect(x + 7, y + 7, bW - 14, bH - 14, 14, 14, 14, 14, null as any, 'rgba(217,180,95,0.18)', 1)
    // 桌面顶部高光
    board.graphics.drawRoundRect(x + 4, y + 4, bW - 8, Math.max(2, bH * 0.008), 16, 16, 2, 2, 'rgba(255,226,168,0.08)')
  }

  /* ------------------------------------------------------------------ *
   * 骰子
   * ------------------------------------------------------------------ */

  private createDice() {
    for (let i = 0; i < 2; i += 1) {
      const view = new DiceView(60)
      this.diceViews.push(view)
      this.diceLayer.addChild(view)
    }
    this.diceLayer.visible = false
  }

  private positionDice() {
    if (this.is3D()) {
      const dice = this.phase === 'rolling' ? this.shownDice : this.dice ?? this.shownDice
      this.three?.updateDice(this.phase === 'idle' || (this.hand && this.hand.phase === 'over') ? null : dice, this.phase === 'rolling')
      this.diceLayer.visible = false
      return
    }
    const m = this.m
    const rolling = this.phase === 'rolling'
    const size = Math.round(this.u(rolling ? 58 : 24))
    const gap = Math.round(size * 0.2)
    const panelCX = m.boardW / 2
    const panelCY = m.boardH / 2
    const scale = size / 60
    const panelTop = panelCY - m.panelH / 2
    const y = rolling ? Math.round(panelCY - size - this.u(28)) : Math.round(panelTop + this.u(10))
    for (let i = 0; i < this.diceViews.length; i += 1) {
      const view = this.diceViews[i]
      view.scale(scale, scale)
      view.pos(Math.round(panelCX - size - gap / 2 + i * (size + gap)), y)
      view.setValue(i === 0 ? this.shownDice.a : this.shownDice.b)
    }
    this.diceLayer.pos(m.boardX, m.boardY)
    this.diceLayer.visible = this.phase !== 'idle' && !(this.hand && this.hand.phase === 'over')
  }

  /* ------------------------------------------------------------------ *
   * 主渲染
   * ------------------------------------------------------------------ */

  private render() {
    this.content.destroyChildren()
    this.content.graphics.clear()
    this.overlay.destroyChildren()
    if (this.is3D()) this.sync3D()

    if (this.phase === 'idle') {
      this.renderIdle()
      this.renderHistoryIcon()
      this.renderOverlays()
      this.positionDice()
      return
    }

    // 旧存档 / 极端情况下局结束但没有最后一把可展示：只铺总账，避免空 hand 崩溃
    if (this.phase === 'round-over' && !this.hand) {
      this.renderRoundSummary()
      this.renderOverlays()
      this.positionDice()
      return
    }

    this.renderWalls()
    this.renderDiscards()
    this.renderCenter()
    this.renderSeats()
    this.renderHand()
    this.renderSettlement()
    this.renderDock()
    this.renderRoundSummary()
    this.renderHistoryIcon()
    this.renderOverlays()
    this.positionDice()
  }

  /** 当前牌墙可视状态：对局中以引擎为准，发牌阶段按已抓走的位置实时减少 */
  private wallVisual(): Array<Array<[boolean, boolean]>> {
    const hand = this.hand
    if (hand && (this.phase === 'playing' || this.phase === 'round-over')) {
      return [0, 1, 2, 3].map(seat => wallVisualOf(hand, seat))
    }
    const visual = [0, 1, 2, 3].map(() => Array.from({ length: STACKS }, () => [false, false] as [boolean, boolean]))
    for (let seat = 0; seat < 4; seat += 1) {
      for (let col = 0; col < STACKS; col += 1) {
        for (let layer = 0; layer < 2; layer += 1) {
          if (!this.consumed.has(`${seat}-${col}-${layer}`)) visual[seat][col][layer] = true
        }
      }
    }
    return visual
  }

  private renderWalls() {
    if (this.is3D()) return
    const m = this.m
    const visual = this.wallVisual()

    if (m.landscape) {
      // 横屏：居中的梯形牌桌。上下墙、左右墙每墩底尺寸一致，
      // 只按顶部 80% 宽和纵深比例做透视形变，所以不会再出现本家墙被拉长。
      const cx = m.boardW / 2
      const topS = this.persp(m.ringY)
      const bottomS = this.persp(m.ringY + m.ringH)
      const topW = m.wallWX * topS
      const bottomW = m.wallWX * bottomS
      const topSpan = STACKS * topW
      const bottomSpan = STACKS * bottomW
      const topX = cx - topSpan / 2
      const bottomX = cx - bottomSpan / 2
      const sideY = m.ringY + m.wallT

      for (let i = 0; i < STACKS; i += 1) {
        const index = STACKS - 1 - i
        const top = visual[2][index]
        const topSprite = makeWallStack(top[0], top[1], topW, m.wallT)
        topSprite.pos(Math.round(topX + i * topW), m.ringY)
        this.content.addChild(topSprite)

        const own = visual[0][i]
        const bottomSprite = makeWallStack(own[0], own[1], bottomW, m.wallT)
        bottomSprite.pos(Math.round(bottomX + i * bottomW), Math.round(m.ringY + m.ringH - m.wallT))
        this.content.addChild(bottomSprite)

        const cy = sideY + i * m.wallWY + m.wallWY / 2
        const s = this.persp(cy)
        const leftX = cx - (m.ringW / 2) * s + m.wallT / 2
        const rightX = cx + (m.ringW / 2) * s - m.wallT / 2

        const left = visual[3][i]
        const leftSprite = makeWallStack(left[0], left[1], m.wallWY, m.wallT)
        leftSprite.pivot(m.wallWY / 2, m.wallT / 2)
        leftSprite.rotation = 90
        leftSprite.pos(Math.round(leftX), Math.round(cy))
        this.content.addChild(leftSprite)

        const right = visual[1][STACKS - 1 - i]
        const rightSprite = makeWallStack(right[0], right[1], m.wallWY, m.wallT)
        rightSprite.pivot(m.wallWY / 2, m.wallT / 2)
        rightSprite.rotation = -90
        rightSprite.pos(Math.round(rightX), Math.round(cy))
        this.content.addChild(rightSprite)
      }
      return
    }

    const span = STACKS * m.wallWX
    const topX = Math.round(m.ringX + (m.ringW - span) / 2)
    const sideTop = Math.round(m.ringY + (m.ringH - span) / 2)

    for (let i = 0; i < STACKS; i += 1) {
      const index = STACKS - 1 - i
      const top = visual[2][index]
      const topSprite = makeWallStack(top[0], top[1], m.wallWX, m.wallT)
      topSprite.pos(Math.round(topX + i * m.wallWX), m.ringY)
      this.content.addChild(topSprite)

      const own = visual[0][i]
      const bottomSprite = makeWallStack(own[0], own[1], m.wallWX, m.wallT)
      bottomSprite.pos(Math.round(topX + i * m.wallWX), Math.round(m.ringY + m.ringH - m.wallT))
      this.content.addChild(bottomSprite)
    }

    for (let i = 0; i < STACKS; i += 1) {
      const left = visual[3][i]
      const leftSprite = makeWallStack(left[0], left[1], m.wallWY, m.wallT)
      leftSprite.pivot(m.wallWY / 2, m.wallT / 2)
      leftSprite.rotation = 90
      leftSprite.pos(Math.round(m.ringX + m.wallT / 2), Math.round(sideTop + i * m.wallWY + m.wallWY / 2))
      this.content.addChild(leftSprite)

      const right = visual[1][STACKS - 1 - i]
      const rightSprite = makeWallStack(right[0], right[1], m.wallWY, m.wallT)
      rightSprite.pivot(m.wallWY / 2, m.wallT / 2)
      rightSprite.rotation = -90
      rightSprite.pos(Math.round(m.ringX + m.ringW - m.wallT / 2), Math.round(sideTop + i * m.wallWY + m.wallWY / 2))
      this.content.addChild(rightSprite)
    }
  }

  private renderDiscards() {
    if (this.is3D()) return
    const hand = this.hand
    if (!hand) return
    for (let seat = 0; seat < 4; seat += 1) {
      this.renderSeatDiscards(seat, hand.players[seat].discards, hand.lastPlayed?.seat === seat)
    }
  }

  private renderSeatDiscards(seat: number, discards: Tile[], markLast: boolean) {
    if (!discards.length) return
    const m = this.m
    const n = discards.length
    const laneW = m.laneRight - m.laneLeft
    const laneH = m.laneBottom - m.laneTop
    const gap = Math.max(1, Math.round(m.discardW * 0.055))

    if (seat === 0 || seat === 2) {
      const stepW = m.discardW + gap
      const stepH = m.discardH + gap
      const perLine = Math.max(1, Math.min(18, Math.floor((laneW + gap) / stepW)))
      for (let i = 0; i < n; i += 1) {
        const col = i % perLine
        const line = Math.floor(i / perLine)
        const count = Math.min(n - line * perLine, perLine)
        const y = seat === 0 ? m.laneBottom - (line + 1) * stepH + gap : m.laneTop + line * stepH
        const tileW = m.landscape ? m.discardW * this.persp(y + m.discardH / 2) : m.discardW
        const lineW = count * tileW + (count - 1) * gap
        const x = (m.laneLeft + m.laneRight) / 2 - lineW / 2 + col * (tileW + gap)
        const tile = new TileView(discards[i], {
          width: tileW,
          marked: markLast && i === n - 1,
          flat: true
        })
        tile.pos(Math.round(x), Math.round(y))
        this.content.addChild(tile)
      }
      return
    }

    const stepY = m.discardW + gap
    const stepX = m.discardH + gap
    const perCol = Math.max(1, Math.floor((laneH + gap) / stepY))
    for (let i = 0; i < n; i += 1) {
      const line = Math.floor(i / perCol)
      const row = i % perCol
      const count = Math.min(n - line * perCol, perCol)
      const startY = (m.laneTop + m.laneBottom) / 2 - (count * stepY - gap) / 2
      const cy = startY + row * stepY + m.discardW / 2
      const sideScale = m.landscape ? this.persp(cy) : 1
      const innerLeft = m.landscape
        ? m.boardW / 2 - (m.ringW / 2) * sideScale + m.wallT
        : m.laneLeft
      const innerRight = m.landscape
        ? m.boardW / 2 + (m.ringW / 2) * sideScale - m.wallT
        : m.laneRight
      const cx =
        seat === 3
          ? innerLeft + line * stepX + m.discardH / 2
          : innerRight - line * stepX - m.discardH / 2
      const tile = new TileView(discards[i], {
        width: m.discardW,
        rotate: seat === 3 ? 90 : -90,
        marked: markLast && i === n - 1,
        flat: true
      })
      tile.pos(Math.round(cx), Math.round(cy))
      this.content.addChild(tile)
    }
  }

  /* ------------------------------------------------------------------ *
   * 中央面板
   * ------------------------------------------------------------------ */

  private currentActor(hand: HandState): number | null {
    if (hand.phase === 'over') return null
    if (hand.phase === 'claim') return hand.pendingClaims[0] ?? null
    return hand.turn
  }

  private isMyTurn(hand: HandState): boolean {
    return this.currentActor(hand) === 0
  }

  private settlement(): HandSettlement | null {
    const hand = this.hand
    if (!hand || hand.phase !== 'over' || !hand.winner) return null
    return settleHand(hand)
  }

  private renderCenter() {
    if (this.is3D()) {
      this.renderCenter3D()
      return
    }
    const m = this.m
    const hand = this.hand

    const px = Math.round(m.boardW / 2 - m.panelW / 2)
    const py = Math.round(m.boardH / 2 - m.panelH / 2)
    const panel = makePanel(m.panelW, m.panelH, this.u(12), 'rgba(7,28,23,0.68)', 'rgba(217,180,95,0.26)')
    panel.pos(px, py)
    this.content.addChild(panel)

    const cx = m.boardW / 2
    const textW = m.panelW - this.u(16)
    const tx = px + this.u(8)

    if (this.phase === 'rolling') {
      this.content.addChild(
        makeText('掷骰…', {
          size: this.u(14),
          color: COLORS.mist,
          align: 'center',
          width: m.panelW,
          height: this.u(22),
          x: px,
          y: py + m.panelH - this.u(48)
        })
      )
      return
    }

    if (!hand || hand.phase === 'over') return

    let y = py + this.u(44)
    const match = this.board
    if (match) {
      this.content.addChild(
        makeText(`第 ${match.roundIndex} 局 · 第 ${match.hands + 1} 把`, {
          size: this.u(11),
          color: COLORS.mist,
          align: 'center',
          width: textW,
          height: this.u(16),
          x: tx,
          y
        })
      )
      if (hand.isFirstHand) {
        this.content.addChild(
          makeText('首牌', {
            size: this.u(10),
            color: COLORS.brass,
            align: 'right',
            width: textW,
            height: this.u(16),
            x: tx,
            y
          })
        )
      }
      y += this.u(19)
    }

    const status = this.phase === 'dealing' ? `发牌 ${this.dealProgress}/53` : `牌山 ${remainingTiles(hand)}`
    this.content.addChild(
      makeText(status, {
        size: this.u(11),
        color: COLORS.mist,
        align: 'center',
        width: textW,
        height: this.u(16),
        x: tx,
        y
      })
    )
    y += this.u(19)

    if (this.phase === 'dealing' && this.dice) {
      this.content.addChild(
        makeText(`${this.dice.a}+${this.dice.b}=${this.dice.a + this.dice.b} · 东家 ${SEAT_NAMES[hand.dealerSeat]}`, {
          size: this.u(11),
          color: COLORS.brass,
          align: 'center',
          width: textW,
          height: this.u(16),
          x: tx,
          y
        })
      )
      y += this.u(19)
    }

    const actor = this.currentActor(hand)
    const turnText =
      this.phase === 'dealing'
        ? '发牌中…'
        : hand.phase === 'choose-shortage'
          ? hand.players[0].shortage
            ? '等别家定缺…'
            : '选缺门'
          : this.isMyTurn(hand)
            ? '轮到你'
            : actor === null
              ? '本把结束'
              : `轮到${SEAT_NAMES[actor]}`
    this.content.addChild(
      makeText(turnText, {
        size: this.u(15),
        color: COLORS.ivory,
        font: FONT_SERIF,
        align: 'center',
        width: textW,
        height: this.u(22),
        x: tx,
        y
      })
    )
    y += this.u(26)

    if (hand.lastPlayed) {
      const lastW = Math.round(m.oppW * 1.05)
      const tile = new TileView(hand.lastPlayed.tile, { width: lastW, marked: true, flat: true })
      tile.pos(Math.round(cx - lastW - this.u(38)), Math.round(y))
      this.content.addChild(tile)
      this.content.addChild(
        makeText(`刚打 ${SEAT_NAMES[hand.lastPlayed.seat]}`, {
          size: this.u(11),
          color: COLORS.mist,
          width: this.u(110),
          height: this.u(16),
          x: Math.round(cx + this.u(4)),
          y: y + this.u(2)
        })
      )
      y += tile.h + this.u(6)
    }

    // 接牌 / 自摸成牌 / 自家杠：都放在中央面板底部
    const actions = this.phase === 'playing' ? legalActions(hand, 0) : []
    const myTurnNow = this.currentActor(hand) === 0
    const winAction = actions.find((action): action is Extract<RoundAction, { type: 'win' }> => action.type === 'win')
    const kongActions = actions.filter((action): action is Extract<RoundAction, { type: 'kong' }> => action.type === 'kong')
    const panelButtons: Array<{ label: string; face: 'tile' | 'chip'; width: number; action?: RoundAction; onPress?: () => void }> = []

    if (hand.phase === 'claim' && myTurnNow) {
      for (const action of actions) {
        if (action.type === 'pass') {
          panelButtons.push({ label: '过', face: 'chip', width: this.u(36), action })
        } else if (action.type === 'claim') {
          panelButtons.push({ label: action.claim, face: 'tile', width: this.u(36), action })
        }
      }
    } else if (hand.phase === 'discard' && myTurnNow) {
      if (winAction && !this.declinedWin) {
        panelButtons.push({ label: '成', face: 'tile', width: this.u(38), action: winAction })
        panelButtons.push({
          label: '打',
          face: 'chip',
          width: this.u(38),
          onPress: () => {
            this.declinedWin = true
            this.render()
          }
        })
      } else {
        for (const action of kongActions) {
          panelButtons.push({ label: `杠${action.tile}`, face: 'chip', width: this.u(50), action })
        }
      }
    }

    if (panelButtons.length) {
      const total = panelButtons.reduce((sum, item) => sum + item.width + this.u(5), -this.u(5))
      let bx = cx - total / 2
      const by = Math.min(py + m.panelH - this.u(28), y + this.u(2))
      for (const item of panelButtons) {
        const button = makeButton({
          width: item.width,
          height: this.u(24),
          label: item.label,
          fontSize: item.label.length > 2 ? this.u(9) : this.u(10),
          face: item.face,
          onClick: () => {
            if (item.action) this.act(item.action)
            else item.onPress?.()
          }
        })
        button.pos(Math.round(bx), Math.round(by))
        this.content.addChild(button)
        bx += item.width + this.u(5)
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * 三家座位
   * ------------------------------------------------------------------ */

  private seatTiles(seat: number): Tile[] {
    const hand = this.hand
    if (!hand) return []
    if (this.phase === 'dealing') return hand.players[seat].hand.slice(0, this.dealtCounts[seat] ?? 0)
    if (hand.phase === 'over' && hand.winner?.seat === seat) return this.revealTiles(seat)
    return hand.players[seat].hand
  }

  private revealTiles(seat: number): Tile[] {
    const hand = this.hand
    if (!hand) return []
    const tiles = [...hand.players[seat].hand].sort(tileOrder)
    const win = hand.winner
    if (win && win.seat === seat && win.winTile) {
      const index = tiles.indexOf(win.winTile)
      if (index >= 0) tiles.splice(index, 1)
      tiles.push(win.winTile)
    }
    return tiles
  }

  private seatPoints(seat: number): number {
    const hand = this.hand
    if (!hand) return STARTING_POINTS
    const base = hand.players[seat].points
    const result = this.settlement()
    return base + (result ? result.pointDelta[seat] : 0)
  }

  private renderSeats() {
    const hand = this.hand
    const actor = hand ? this.currentActor(hand) : null
    const winner = hand?.winner?.seat ?? -1
    const over = hand?.phase === 'over'

    for (const seat of [1, 2, 3]) {
      const player = hand ? hand.players[seat] : null
      const tiles = this.seatTiles(seat)
      const reveal = over && winner === seat
      const active = actor === seat && this.phase === 'playing'
      const dealer = hand?.dealerSeat === seat
      const shortage = player?.shortage ?? null
      const points = this.phase === 'playing' || this.phase === 'round-over' ? this.seatPoints(seat) : STARTING_POINTS
      const count = tiles.length

      if (seat === 2) this.renderTopSeat(player, tiles, reveal, active, dealer, shortage, points, count)
      else if (seat === 3) this.renderSideSeat(true, player, tiles, reveal, active, dealer, shortage, points, count)
      else this.renderSideSeat(false, player, tiles, reveal, active, dealer, shortage, points, count)
    }
  }

  private seatMeta(
    name: string,
    dealer: boolean,
    shortage: NumberSuit | null,
    points: number,
    count: number,
    x: number,
    y: number,
    width: number,
    align: 'left' | 'center'
  ): number {
    const nameSize = this.u(10)
    const restSize = this.u(9)
    const nameW = Math.max(this.u(26), this.measureText(name, nameSize))
    const restStr = `${shortage ? `缺${shortage}` : '—'} · ${points}点 · ${count}张`
    const restW = this.measureText(restStr, restSize)
    const badgeW = dealer ? this.u(15) : 0
    const total = nameW + this.u(4) + badgeW + restW
    let startX = align === 'center' ? x + (width - total) / 2 : x

    const nameText = makeText(name, {
      size: nameSize,
      color: COLORS.ivory,
      width: Math.ceil(nameW) + 2,
      height: this.u(16),
      x: Math.round(startX),
      y
    })
    this.content.addChild(nameText)
    startX += nameW + this.u(4)

    if (dealer) {
      const badge = makePanel(this.u(14), this.u(12), this.u(2), COLORS.brass)
      badge.pos(Math.round(startX), Math.round(y + this.u(1)))
      badge.addChild(
        makeText('东', {
          size: this.u(8),
          color: COLORS.ink,
          bold: true,
          align: 'center',
          valign: 'middle',
          width: this.u(14),
          height: this.u(12)
        })
      )
      this.content.addChild(badge)
      startX += badgeW
    }

    const rest = makeText(restStr, {
      size: restSize,
      color: COLORS.mist,
      width: Math.ceil(restW) + 2,
      height: this.u(16),
      x: Math.round(startX),
      y: y + this.u(1)
    })
    this.content.addChild(rest)
    return Math.round(total)
  }

  /** 左右两家贴在桌边，信息竖着排，避免压到牌墙 */
  private seatMetaVertical(
    name: string,
    dealer: boolean,
    shortage: NumberSuit | null,
    points: number,
    count: number,
    x: number,
    y: number,
    width: number
  ) {
    const line = (content: string, size: number, color: string, offset: number, bold = false) => {
      this.content.addChild(
        makeText(content, {
          size,
          color,
          bold,
          align: 'center',
          width,
          height: this.u(13),
          x: Math.round(x),
          y: Math.round(y + offset)
        })
      )
    }
    const size = this.u(8)
    line(name, size, COLORS.ivory, 0)
    let offset = this.u(12)
    if (dealer) {
      const badgeW = this.u(14)
      const badge = makePanel(badgeW, this.u(12), this.u(2), COLORS.brass)
      badge.pos(Math.round(x + width / 2 - badgeW / 2), Math.round(y + offset))
      badge.addChild(
        makeText('东', {
          size: this.u(8),
          color: COLORS.ink,
          bold: true,
          align: 'center',
          valign: 'middle',
          width: badgeW,
          height: this.u(12)
        })
      )
      this.content.addChild(badge)
      offset += this.u(15)
    }
    line(`${points}点`, size, COLORS.brass, offset)
    offset += this.u(12)
    line(shortage ? `缺${shortage}` : '—', this.u(8), COLORS.mist, offset)
    offset += this.u(11)
    line(`${count}张`, this.u(8), COLORS.mist, offset)
  }

  private renderTopSeat(
    player: { shortage: NumberSuit | null; melds: Meld[] } | null,
    tiles: Tile[],
    reveal: boolean,
    active: boolean,
    dealer: boolean,
    shortage: NumberSuit | null,
    points: number,
    count: number
  ) {
    const m = this.m
    const rowW = Math.max(13, tiles.length) * m.oppW
    const blockW = Math.max(this.u(180), rowW)
    const x = m.boardW / 2 - blockW / 2
    let y = this.u(4)

    this.seatMeta('对面', dealer, shortage, points, count, x, y, blockW, 'center')
    if (this.is3D()) return
    y += this.u(18)

    const rack = player && player.melds.length ? this.meldRackHorizontal(player.melds, m.meldW) : null
    const rackW = rack ? rack.width + this.u(8) : 0
    const seatGap = Math.max(2, Math.round(m.oppW * 0.05))
    const handW = Math.max(0, tiles.length * m.oppW + Math.max(0, tiles.length - 1) * seatGap)
    const totalW = rackW + handW
    const startX = m.boardW / 2 - totalW / 2
    if (rack) {
      rack.pos(Math.round(startX), Math.round(y + m.oppH - rack.height))
      this.content.addChild(rack)
    }
    let hx = startX + rackW
    for (let i = 0; i < tiles.length; i += 1) {
      const tile = reveal
        ? new TileView(tiles[i], { width: m.oppW, marked: i === tiles.length - 1 })
        : new TileView('', { width: m.oppW, back: true })
      tile.pos(Math.round(hx), Math.round(y))
      this.content.addChild(tile)
      hx += m.oppW + seatGap
    }
  }

  private renderSideSeat(
    left: boolean,
    player: { shortage: NumberSuit | null; melds: Meld[] } | null,
    tiles: Tile[],
    reveal: boolean,
    active: boolean,
    dealer: boolean,
    shortage: NumberSuit | null,
    points: number,
    count: number
  ) {
    const m = this.m
    const rotate = left ? 90 : -90
    const colW = m.sideH
    const sideGap = Math.max(1, Math.round(m.sideW * 0.055))
    const slots = Math.max(2, tiles.length)
    const handLen = slots * m.sideW + Math.max(0, slots - 1) * sideGap
    const rack = player && player.melds.length ? this.meldRackVertical(player.melds, m.meldW, rotate) : null
    const infoH = this.u(52)
    const blockH = infoH + handLen + (rack ? this.u(6) + rack.height : 0)
    const blockW = Math.max(this.u(30), colW)
    const x = m.landscape
      ? left
        ? m.ringX - blockW - this.u(6)
        : m.ringX + m.ringW + this.u(6)
      : left
        ? this.u(4)
        : m.boardW - this.u(4) - blockW
    const y = m.boardH / 2 - blockH / 2

    this.seatMetaVertical(left ? '上家' : '下家', dealer, shortage, points, count, x, y, blockW)
    if (this.is3D()) return
    let cy = y + infoH
    for (let i = 0; i < tiles.length; i += 1) {
      const tile = reveal
        ? new TileView(tiles[i], { width: m.sideW, rotate, marked: i === tiles.length - 1 })
        : new TileView('', { width: m.sideW, back: true, rotate })
      tile.pos(Math.round(x + blockW / 2), Math.round(cy + m.sideW / 2))
      this.content.addChild(tile)
      cy += m.sideW + sideGap
    }

    if (rack) {
      rack.pos(Math.round(x + blockW / 2 - rack.width / 2), Math.round(y + infoH + handLen + this.u(6)))
      this.content.addChild(rack)
    }
  }

  /* ------------------------------------------------------------------ *
   * 副露
   * ------------------------------------------------------------------ */

  private meldRackHorizontal(melds: Meld[], tileW: number): Laya.Sprite {
    const rack = new Laya.Sprite()
    const tileH = Math.round(tileW * TILE_RATIO)
    const meldGap = Math.max(1, Math.round(tileW * 0.05))
    const groupW = melds.map(meld => {
      const n = meldTiles(meld).length
      return n * tileW + Math.max(0, n - 1) * meldGap + 2
    })
    const totalW = groupW.reduce((sum, value) => sum + value + this.u(5), -this.u(5))
    rack.size(totalW, tileH + 4)
    let x = 0
    for (let g = 0; g < melds.length; g += 1) {
      const group = makePanel(groupW[g], tileH + 2, 3, 'rgba(0,0,0,0.2)', 'rgba(217,180,95,0.32)', 1)
      group.pos(Math.round(x), 1)
      rack.addChild(group)
      const tiles = meldTiles(melds[g])
      for (let i = 0; i < tiles.length; i += 1) {
        const tile = new TileView(tiles[i], { width: tileW, flat: true })
        tile.pos(1 + i * (tileW + meldGap), 2)
        group.addChild(tile)
      }
      x += groupW[g] + this.u(5)
    }
    return rack
  }

  private meldRackVertical(melds: Meld[], tileW: number, rotate: number): Laya.Sprite {
    const rack = new Laya.Sprite()
    const tileH = Math.round(tileW * TILE_RATIO)
    const meldGap = Math.max(1, Math.round(tileW * 0.05))
    const groupH = melds.map(meld => {
      const n = meldTiles(meld).length
      return n * tileW + Math.max(0, n - 1) * meldGap + 2
    })
    const totalH = groupH.reduce((sum, value) => sum + value + this.u(4), -this.u(4))
    rack.size(tileH + 4, totalH)
    let y = 0
    for (let g = 0; g < melds.length; g += 1) {
      const group = makePanel(tileH + 2, groupH[g], 3, 'rgba(0,0,0,0.2)', 'rgba(217,180,95,0.32)', 1)
      group.pos(1, Math.round(y))
      rack.addChild(group)
      const tiles = meldTiles(melds[g])
      for (let i = 0; i < tiles.length; i += 1) {
        const tile = new TileView(tiles[i], { width: tileW, rotate, flat: true })
        tile.pos(tileH / 2 + 1, 1 + i * (tileW + meldGap) + tileW / 2)
        group.addChild(tile)
      }
      y += groupH[g] + this.u(4)
    }
    return rack
  }

  /* ------------------------------------------------------------------ *
   * 我的手牌
   * ------------------------------------------------------------------ */

  private myHandTiles(): Tile[] {
    const hand = this.hand
    if (!hand) return []
    if (hand.phase === 'over') return this.revealTiles(0)
    if (this.phase === 'dealing') return hand.players[0].hand.slice(0, this.dealtCounts[0] ?? 0)
    const drawn = hand.phase === 'discard' && hand.turn === 0 ? hand.drawnTile : null
    const tiles = [...hand.players[0].hand]
    if (drawn) {
      const index = tiles.indexOf(drawn)
      if (index >= 0) tiles.splice(index, 1)
    }
    tiles.sort(tileOrder)
    return drawn ? [...tiles, drawn] : tiles
  }

  private renderHand() {
    if (this.is3D()) {
      this.renderHand3D()
      return
    }
    const hand = this.hand
    if (!hand) return
    const m = this.m
    const tiles = this.myHandTiles()
    if (!tiles.length) return
    const gap = Math.max(2, Math.round(m.handW * 0.04))
    let handW = m.handW
    let handH = m.handH
    let handRowW = tiles.length * (handW + gap) - gap
    if (handRowW > m.boardW - this.u(16)) {
      handW = Math.floor((m.boardW - this.u(16) - (tiles.length - 1) * gap) / tiles.length)
      handH = Math.round(handW * TILE_RATIO)
      handRowW = tiles.length * (handW + gap) - gap
    }

    const melds = hand.players[0].melds
    const meldRackW = melds.length ? this.meldRackHorizontal(melds, m.meldW).width : 0
    const totalW = handRowW + (melds.length ? meldRackW + this.u(10) : 0)
    const startX = Math.round((m.boardW - totalW) / 2)
    const y = Math.round(m.boardH - this.u(6) - handH)
    const myTurn = hand.phase === 'discard' && this.currentActor(hand) === 0
    const playable = new Set(playableDiscards(hand, 0))
    const forbidden = new Set(forbiddenDiscardsFor(hand, 0))
    const mustShortage = shortageTiles(hand.players[0]).length > 0
    const winPending =
      myTurn && !this.declinedWin && legalActions(hand, 0).some(action => action.type === 'win')

    for (let i = 0; i < tiles.length; i += 1) {
      const tile = tiles[i]
      const isDrawn = hand.phase !== 'over' && hand.drawnTile === tile && i === tiles.length - 1 && hand.turn === 0
      const canPlay = myTurn && playable.has(tile) && !winPending
      const isMustPlay = canPlay && mustShortage
      const isForbidden = myTurn && forbidden.has(tile)
      const view = new TileView(tile, {
        width: handW,
        marked: isMustPlay,
        dim: myTurn && !canPlay
      })
      const tx = Math.round(startX + i * (handW + gap))
      const ty = Math.round(y - (isDrawn ? this.u(6) : 0))
      view.pos(tx, ty)

      if (isMustPlay) {
        view.graphics.drawRoundRect(0, 0, handW, view.h, 4, 4, 4, 4, null as any, COLORS.brass, 2)
      } else if (isForbidden) {
        view.graphics.drawRoundRect(0, 0, handW, view.h, 4, 4, 4, 4, null as any, 'rgba(200,69,47,0.9)', 2)
      }

      if (canPlay) {
        view.hitArea = new Laya.Rectangle(0, 0, handW, view.h)
        view.mouseEnabled = true
        view.on(Laya.Event.CLICK, null, () => this.act({ type: 'discard', seat: 0, tile }))
      }
      this.content.addChild(view)
    }

    if (melds.length) {
      const rack = this.meldRackHorizontal(melds, m.meldW)
      rack.pos(Math.round(startX + handRowW + this.u(10)), Math.round(y + handH - rack.height))
      this.content.addChild(rack)
    }
  }

  /* ------------------------------------------------------------------ *
   * 操作条
   * ------------------------------------------------------------------ */

  /** 3D 模式：中间只留一条很窄的提示，不再用大面板挡牌河 */
  private renderCenter3D() {
    const m = this.m
    const hand = this.hand
    const cx = m.boardW / 2
    const cy = m.boardH / 2

    if (this.phase === 'rolling') {
      this.content.addChild(
        makeText('掷骰…', {
          size: this.u(11),
          color: COLORS.mist,
          align: 'center',
          width: this.u(160),
          height: this.u(20),
          x: cx - this.u(80),
          y: cy - this.u(140)
        })
      )
      return
    }
    if (!hand || hand.phase === 'over') return

    const match = this.board
    const actor = this.currentActor(hand)
    const status = this.phase === 'dealing'
      ? `发牌 ${this.dealProgress}/53`
      : hand.phase === 'choose-shortage'
        ? hand.players[0].shortage ? '等别家定缺' : '选缺门'
        : this.isMyTurn(hand)
          ? '轮到你'
          : actor === null ? '本把结束' : `轮到${SEAT_NAMES[actor]}`
    const round = match ? `第${match.roundIndex}局·第${match.hands + 1}把` : '本局'
    const text = `${round}  ·  牌山 ${remainingTiles(hand)}  ·  ${status}`
    const pillW = Math.round(Math.min(m.boardW * 0.42, this.u(280)))
    const pillH = this.u(26)
    const px = Math.round(cx - pillW / 2)
    const py = Math.round(cy - this.u(118))
    const pill = makePanel(pillW, pillH, this.u(13), 'rgba(7,28,23,0.52)', 'rgba(217,180,95,0.26)', 1)
    pill.pos(px, py)
    this.content.addChild(pill)
    this.content.addChild(
      makeText(text, {
        size: this.u(9),
        color: COLORS.mist,
        align: 'center',
        valign: 'middle',
        width: pillW,
        height: pillH,
        x: px,
        y: py
      })
    )
    if (hand.isFirstHand) {
      this.content.addChild(
        makeText('首牌', {
          size: this.u(8),
          color: COLORS.brass,
          align: 'right',
          width: pillW - this.u(10),
          height: this.u(14),
          x: px,
          y: py - this.u(14)
        })
      )
    }

    // 只框最后打出的那一张牌；四角由 3D 顶面投影，侧家旋转后也不会框错
    const mark = this.three?.lastMark
    if (mark && mark.w > 0 && mark.h > 0) {
      const gx = mark.x - m.boardX
      const gy = mark.y - m.boardY
      const x0 = Math.round(gx)
      const y0 = Math.round(gy)
      const x1 = x0 + Math.round(mark.w)
      const y1 = y0 + Math.round(mark.h)
      const lw = 2
      const frame = new Laya.Sprite()
      frame.graphics.drawRect(x0, y0, x1 - x0, lw, '#F5C542')
      frame.graphics.drawRect(x0, y1 - lw, x1 - x0, lw, '#F5C542')
      frame.graphics.drawRect(x0, y0 + lw, lw, y1 - y0 - lw * 2, '#F5C542')
      frame.graphics.drawRect(x1 - lw, y0 + lw, lw, y1 - y0 - lw * 2, '#F5C542')
      this.content.addChild(frame)
    }

  }

  /** 3D 手牌只保留投影后的点击层 + 可打/禁打描边 */
  private renderHand3D() {
    const hand = this.hand
    if (!hand || !this.three) return
    const tiles = this.myHandTiles()
    if (!tiles.length) return
    const myTurn = hand.phase === 'discard' && this.currentActor(hand) === 0
    const playable = new Set(playableDiscards(hand, 0))
    const forbidden = new Set(forbiddenDiscardsFor(hand, 0))
    const mustShortage = shortageTiles(hand.players[0]).length > 0
    const winPending =
      myTurn && !this.declinedWin && legalActions(hand, 0).some(action => action.type === 'win')

    for (const hit of this.three.selfHits) {
      if (!hit || hit.w <= 0 || hit.h <= 0) continue
      const canPlay = myTurn && playable.has(hit.tile) && !winPending
      const isMustPlay = canPlay && mustShortage
      const isForbidden = myTurn && forbidden.has(hit.tile)
      const x = Math.round(hit.x - this.m.boardX)
      const y = Math.round(hit.y - this.m.boardY)
      const view = new Laya.Sprite()
      view.size(Math.max(1, Math.round(hit.w)), Math.max(1, Math.round(hit.h)))
      view.pos(x, y)
      if (isMustPlay) {
        view.graphics.drawRoundRect(0, 0, view.width, view.height, this.u(4), this.u(4), this.u(4), this.u(4), null as any, COLORS.brass, 2)
      } else if (isForbidden) {
        view.graphics.drawRoundRect(0, 0, view.width, view.height, this.u(4), this.u(4), this.u(4), this.u(4), null as any, 'rgba(200,69,47,0.9)', 2)
      }
      if (canPlay) {
        view.hitArea = new Laya.Rectangle(0, 0, view.width, view.height)
        view.mouseEnabled = true
        view.on(Laya.Event.CLICK, null, () => this.act({ type: 'discard', seat: 0, tile: hit.tile }))
      }
      this.content.addChild(view)
    }
  }

  /** 把原本在中央面板的 成/杠/碰/过 收到操作条，避免挡牌河 */
  private appendDock3DActions(items: Array<Laya.Sprite | Laya.Text>, hand: HandState, myTurn: boolean) {
    if (this.phase !== 'playing' || hand.phase === 'over' || !myTurn) return
    const actions = legalActions(hand, 0)
    if (hand.phase === 'claim') {
      for (const action of actions) {
        if (action.type === 'pass') {
          items.push(makeButton({
            width: this.u(34), height: this.u(24), label: '过', fontSize: this.u(10), face: 'chip',
            onClick: () => this.act(action)
          }))
        } else if (action.type === 'claim') {
          items.push(makeButton({
            width: this.u(38), height: this.u(24), label: action.claim, fontSize: this.u(10), face: 'tile',
            onClick: () => this.act(action)
          }))
        } else if (action.type === 'win') {
          items.push(makeButton({
            width: this.u(38), height: this.u(24), label: '成', fontSize: this.u(10), face: 'tile',
            onClick: () => this.act(action)
          }))
        }
      }
      return
    }
    if (hand.phase !== 'discard') return
    const winAction = actions.find((action): action is Extract<RoundAction, { type: 'win' }> => action.type === 'win')
    if (winAction && !this.declinedWin) {
      items.push(makeButton({
        width: this.u(38), height: this.u(24), label: '成', fontSize: this.u(10), face: 'tile',
        onClick: () => this.act(winAction)
      }))
      items.push(makeButton({
        width: this.u(38), height: this.u(24), label: '打', fontSize: this.u(10), face: 'chip',
        onClick: () => { this.declinedWin = true; this.render() }
      }))
      return
    }
    for (const action of actions) {
      if (action.type !== 'kong') continue
      items.push(makeButton({
        width: this.u(50), height: this.u(24), label: `杠${action.tile}`, fontSize: this.u(9), face: 'chip',
        onClick: () => this.act(action)
      }))
    }
  }

  private renderDock() {
    const m = this.m
    const hand = this.hand
    if (!hand) {
      if (this.phase === 'rolling' || this.phase === 'dealing') {
        this.renderDockBar([
          makeText(this.phase === 'rolling' ? '掷骰…' : `发牌 ${this.dealProgress}/53`, {
            size: this.u(11),
            color: COLORS.mist,
            width: this.u(120),
            height: this.u(16)
          })
        ])
      }
      return
    }

    const items: Array<Laya.Sprite | Laya.Text> = []
    const me = hand.players[0]
    const playing = this.phase === 'playing' || this.phase === 'round-over'
    const myTurn = this.isMyTurn(hand)

    items.push(
      makeText(
        `自己${hand.dealerSeat === 0 ? ' 东' : ''}${me.shortage ? `  缺${me.shortage}` : ''}  ${playing ? this.seatPoints(0) : STARTING_POINTS}点  ${this.phase === 'dealing' ? this.dealtCounts[0] : me.hand.length}张`,
        { size: this.u(10), color: COLORS.mist, width: this.u(165), height: this.u(16) }
      )
    )

    if (this.phase === 'dealing') {
      items.push(makeText(`发牌 ${this.dealProgress}/53`, { size: this.u(11), color: COLORS.brass, width: this.u(110), height: this.u(16) }))
    } else if (this.phase === 'playing' && hand.phase === 'choose-shortage' && !me.shortage) {
      items.push(makeText('定缺', { size: this.u(10), color: COLORS.mist, width: this.u(30), height: this.u(16) }))
      for (const suit of SHORTAGE_OPTIONS) {
        items.push(
          makeButton({
            width: this.u(36),
            height: this.u(28),
            label: `缺${suit}`,
            fontSize: this.u(11),
            face: 'chip',
            onClick: () => this.act({ type: 'chooseShortage', seat: 0, suit })
          })
        )
      }
    } else if (this.phase === 'playing' && hand.phase === 'draw' && myTurn) {
      items.push(
        makeButton({
          width: this.u(64),
          height: this.u(26),
          label: me.hand.length % 3 === 2 ? '出牌' : '摸牌',
          fontSize: this.u(12),
          face: 'tile',
          onClick: () => this.act({ type: 'draw', seat: 0 })
        })
      )
    } else if (this.phase === 'playing' && hand.phase === 'over') {
      items.push(
        makeButton({
          width: this.u(72),
          height: this.u(26),
          label: this.settlement()?.gameOver ? '本局结束' : '下一把',
          fontSize: this.u(11),
          face: 'tile',
          onClick: () => this.closeHand()
        })
      )
      items.push(
        makeButton({
          width: this.u(42),
          height: this.u(26),
          label: '退出',
          fontSize: this.u(10),
          face: 'chip',
          onClick: () => this.requestExit()
        })
      )
    } else if (this.phase === 'playing') {
      const myActions = myTurn ? legalActions(hand, 0) : []
      const hasWin = myActions.some(action => action.type === 'win') && !this.declinedWin
      const hasKong = myActions.some(action => action.type === 'kong')
      const status = myTurn
        ? hasWin
          ? '可以成牌：选 成 或 打'
          : hasKong
            ? '可以杠，或点手牌打出'
            : shortageTiles(me).length
              ? '必须打缺门牌'
              : '点手牌打出'
        : `${SEAT_NAMES[this.currentActor(hand) ?? 0]}在出牌…`
      items.push(makeText(status, { size: this.u(10), color: COLORS.mist, width: this.u(180), height: this.u(16) }))
    } else if (this.phase === 'rolling') {
      items.push(makeText('掷骰…', { size: this.u(11), color: COLORS.mist, width: this.u(60), height: this.u(16) }))
    }

    if (this.is3D()) this.appendDock3DActions(items, hand, myTurn)
    this.renderDockBar(items)

    if (this.phase === 'playing' && hand.phase !== 'over') {
      const exit = makeButton({
        width: this.u(48),
        height: this.u(24),
        label: '退出',
        fontSize: this.u(10),
        face: 'ghost',
        onClick: () => this.requestExit()
      })
      exit.pos(m.boardW - this.u(54), this.u(8))
      this.content.addChild(exit)
    }
  }

  private renderDockBar(items: Array<Laya.Sprite | Laya.Text>) {
    const m = this.m
    const gap = this.u(5)
    let width = 0
    for (const item of items) width += (item as any).width ?? 0
    width += gap * Math.max(0, items.length - 1)
    const barW = Math.round(Math.min(m.boardW - this.u(8), Math.max(this.u(230), width + this.u(16))))
    const barH = this.u(32)
    const x = Math.round(m.boardW / 2 - barW / 2)
    const handTop = Math.round(m.boardH - this.u(6) - m.handH)
    const y = Math.round(handTop - barH - this.u(4))
    const bar = makePanel(barW, barH, this.u(9), 'rgba(9,33,27,0.9)', 'rgba(217,180,95,0.34)', 1)
    bar.pos(x, y)
    this.content.addChild(bar)

    let cx = x + (barW - width) / 2
    for (const item of items) {
      const w = (item as any).width ?? 0
      const h = (item as any).height ?? this.u(16)
      item.pos(Math.round(cx), Math.round(y + (barH - h) / 2))
      this.content.addChild(item as Laya.Sprite)
      cx += w + gap
    }
  }

  /* ------------------------------------------------------------------ *
   * 结算面板
   * ------------------------------------------------------------------ */

  private renderSettlement() {
    const hand = this.hand
    if (!hand || hand.phase !== 'over') return
    const m = this.m
    const win = hand.winner
    const result = this.settlement()
    const gameOver = !!result?.gameOver
    const bigWin = !!win?.score.bigWin.isBigWin
    const showMoneyRow = gameOver || bigWin
    const pointLines = win ? win.score.details.filter(line => gameOver || !/(元|应付)/.test(line)) : []
    const detailCount = Math.min(pointLines.length, this.is3D() ? 3 : m.landscape ? 4 : gameOver ? 8 : 7)
    const detailUnit = m.landscape ? 12 : 15

    const side3D = this.is3D()
    const panelW = Math.round(
      side3D
        ? Math.min(m.boardW * 0.3, this.u(250))
        : m.landscape
          ? Math.min(m.boardW * 0.5, this.u(300))
          : Math.min(m.boardW * 0.68, this.u(380))
    )
    let px = side3D
      ? Math.round(m.boardW - panelW - this.u(12))
      : Math.round(m.boardW / 2 - panelW / 2)

    if (!win) {
      const panelH = this.u(110)
      const py = side3D ? Math.round(m.boardY + this.u(8)) : Math.round(m.boardH / 2 - panelH / 2)
      const panel = makePanel(panelW, panelH, this.u(14), 'rgba(8,30,24,0.97)', 'rgba(217,180,95,0.4)', 1.5)
      panel.pos(px, py)
      this.content.addChild(panel)
      this.content.addChild(
        makeText('牌山摸完，本把不算输赢。', {
          size: this.u(13),
          color: COLORS.mist,
          align: 'center',
          width: panelW,
          height: this.u(24),
          x: px,
          y: py + panelH / 2 - this.u(12)
        })
      )
      return
    }

    // 面板高度按内容算，避免一大片空白把别人的亮牌挡住
    let used = 8 + 14 + 28 + 46 + detailCount * detailUnit + 6
    if (showMoneyRow) used += 20
    const dockTop = m.boardH - this.u(6) - m.handH - this.u(32) - this.u(4)
    const maxH = m.landscape ? Math.max(220, dockTop - m.ringY - this.u(6)) : m.ringH * 0.92
    const panelH = Math.round(Math.min(maxH, this.u(used)))
    const winnerSeat = win.seat
    let py = Math.round(m.boardH / 2 - panelH / 2)
    if (side3D) {
      // 3D：结果卡贴边放，给对家亮出的牌面让出中央
      const sideRight = winnerSeat !== 1
      px = sideRight ? Math.round(m.boardW - panelW - this.u(12)) : Math.round(this.u(12))
      py = Math.round(m.boardY + this.u(8))
    } else if (m.landscape) {
      // 横屏：面板始终夹在牌墙上方和操作条之间，四家的亮牌都不会被挡
      py = Math.round(m.ringY + Math.max(0, (maxH - panelH) / 2))
    }

    const panel = makePanel(panelW, panelH, this.u(14), 'rgba(8,30,24,0.96)', 'rgba(217,180,95,0.4)', 1.5)
    panel.pos(px, py)
    this.content.addChild(panel)

    let y = py + this.u(8)
    const match = this.board
    if (match) {
      this.content.addChild(
        makeText(`第 ${match.roundIndex} 局 · 第 ${match.hands + 1} 把`, {
          size: this.u(9),
          color: COLORS.mist,
          width: panelW - this.u(24),
          height: this.u(13),
          x: px + this.u(12),
          y
        })
      )
      y += this.u(14)
    }

    this.content.addChild(
      makeText(SEAT_NAMES[winnerSeat], {
        size: this.u(14),
        color: COLORS.ivory,
        font: FONT_SERIF,
        width: this.u(74),
        height: this.u(22),
        x: px + this.u(12),
        y
      })
    )
    this.content.addChild(
      makeText(win.selfDraw ? '自摸' : '接牌', {
        size: this.u(10),
        color: COLORS.mist,
        width: this.u(42),
        height: this.u(18),
        x: px + this.u(70),
        y: y + this.u(3)
      })
    )
    this.content.addChild(
      makeText(`${win.score.points.total}`, {
        size: this.u(24),
        color: COLORS.brass,
        bold: true,
        font: FONT_SERIF,
        align: 'right',
        width: this.u(70),
        height: this.u(28),
        x: px + panelW - this.u(86),
        y
      })
    )
    this.content.addChild(
      makeText('点', {
        size: this.u(10),
        color: COLORS.mist,
        width: this.u(16),
        height: this.u(18),
        x: px + panelW - this.u(20),
        y: y + this.u(9)
      })
    )
    y += this.u(28)

    if (showMoneyRow) {
      let badgeX = px + this.u(13)
      if (bigWin) {
        const badge = this.makeBadge('大拿', COLORS.vermillion, COLORS.ivory)
        badge.pos(badgeX, y)
        this.content.addChild(badge)
        badgeX += badge.width + this.u(6)
        if (hand.isFirstHand) {
          const qing = this.makeBadge('清水', COLORS.brass, COLORS.ink)
          qing.pos(badgeX, y)
          this.content.addChild(qing)
        }
      }
      // 一局还没结束时只算点数，不显示要付多少钱
      if (gameOver) {
        this.content.addChild(
          makeText(`${win.score.money.perOpponentTotal} 元/家 · 合计 ${win.score.money.total} 元`, {
            size: this.u(11),
            color: COLORS.brass,
            align: 'right',
            width: panelW - this.u(24),
            height: this.u(16),
            x: px + this.u(12),
            y
          })
        )
      }
      y += this.u(20)
    }

    const cellGap = this.u(4)
    const cellW = (panelW - this.u(24)) / 4
    for (let seat = 0; seat < 4; seat += 1) {
      const delta = result?.pointDelta[seat] ?? 0
      const cell = makePanel(cellW - cellGap, this.u(40), this.u(5), 'rgba(0,0,0,0.24)')
      cell.pos(Math.round(px + this.u(12) + seat * cellW + cellGap / 2), Math.round(y))
      this.content.addChild(cell)
      cell.addChild(
        makeText(SEAT_NAMES[seat], {
          size: this.u(9),
          color: COLORS.mist,
          align: 'center',
          width: cellW - cellGap,
          height: this.u(12),
          y: this.u(2)
        })
      )
      cell.addChild(
        makeText(`${this.seatPoints(seat)}`, {
          size: this.u(13),
          color: delta > 0 ? COLORS.brass : delta < 0 ? COLORS.warn : COLORS.ivory,
          align: 'center',
          width: cellW - cellGap,
          height: this.u(18),
          y: this.u(13)
        })
      )
      cell.addChild(
        makeText(delta === 0 ? '持平' : `${moneyText(delta)} 点`, {
          size: this.u(8),
          color: COLORS.mist,
          align: 'center',
          width: cellW - cellGap,
          height: this.u(12),
          y: this.u(29)
        })
      )
    }
    y += this.u(46)

    const detail = makeText(pointLines.slice(0, detailCount).join('\n'), {
      size: m.landscape ? this.u(9) : this.u(10),
      color: COLORS.mist,
      width: panelW - this.u(26),
      height: Math.max(this.u(20), detailCount * this.u(detailUnit)),
      x: px + this.u(13),
      y
    })
    detail.wordWrap = true
    detail.overflow = Laya.Text.VISIBLE
    this.content.addChild(detail)
  }

  private makeBadge(label: string, fill: string, color: string): Laya.Sprite {
    const w = Math.ceil(this.measureText(label, this.u(10))) + this.u(10)
    const badge = makePanel(w, this.u(19), this.u(3), fill)
    badge.addChild(
      makeText(label, {
        size: this.u(10),
        color,
        align: 'center',
        valign: 'middle',
        width: w,
        height: this.u(19)
      })
    )
    return badge
  }

  /* ------------------------------------------------------------------ *
   * 一局总账
   * ------------------------------------------------------------------ */

  private renderRoundSummary() {
    if (this.phase !== 'round-over' || !this.roundSummary) return
    const m = this.m
    const summary = this.roundSummary
    const dim = new Laya.Sprite()
    dim.size(m.W, m.H)
    dim.graphics.drawRect(0, 0, m.W, m.H, 'rgba(4,18,14,0.88)')
    this.overlay.addChild(dim)

    const panelW = Math.round(Math.min(m.W - this.u(40), this.u(360)))
    const panelH = Math.round(Math.min(m.H - this.u(40), this.u(300)))
    const px = Math.round((m.W - panelW) / 2)
    const py = Math.round((m.H - panelH) / 2)
    const panel = makePanel(panelW, panelH, this.u(16), 'rgba(9,34,27,0.98)', 'rgba(217,180,95,0.38)', 1.5)
    panel.pos(px, py)
    this.overlay.addChild(panel)

    this.overlay.addChild(
      makeText(`第 ${summary.roundIndex} 局结束`, {
        size: this.u(18),
        color: COLORS.brass,
        bold: true,
        font: FONT_SERIF,
        align: 'center',
        width: panelW,
        height: this.u(26),
        x: px,
        y: py + this.u(12)
      })
    )
    this.overlay.addChild(
      makeText(`共 ${summary.hands} 把 · 有人点数付完`, {
        size: this.u(10),
        color: COLORS.mist,
        align: 'center',
        width: panelW,
        height: this.u(16),
        x: px,
        y: py + this.u(40)
      })
    )

    const rowW = panelW - this.u(30)
    const roundW = this.u(58)
    const totalW = this.u(50)
    const totalX = rowW - this.u(8) - totalW
    const roundX = totalX - this.u(10) - roundW
    const colRound = px + this.u(15) + roundX
    const colTotal = px + this.u(15) + totalX
    this.overlay.addChild(
      makeText('本局', {
        size: this.u(9),
        color: COLORS.mist,
        align: 'right',
        width: roundW,
        height: this.u(13),
        x: colRound,
        y: py + this.u(62)
      })
    )
    this.overlay.addChild(
      makeText('累计', {
        size: this.u(9),
        color: COLORS.mist,
        align: 'right',
        width: totalW,
        height: this.u(13),
        x: colTotal,
        y: py + this.u(62)
      })
    )

    for (let seat = 0; seat < 4; seat += 1) {
      const rowY = py + this.u(80) + seat * this.u(38)
      const row = makePanel(panelW - this.u(30), this.u(32), this.u(6), 'rgba(0,0,0,0.22)')
      row.pos(px + this.u(15), rowY)
      this.overlay.addChild(row)
      row.addChild(
        makeText(`${SEAT_NAMES[seat]}  ${summary.points[seat]} 点`, {
          size: this.u(11),
          color: COLORS.ivory,
          width: this.u(140),
          height: this.u(18),
          x: this.u(8),
          y: this.u(7)
        })
      )
      const round = summary.money[seat]
      row.addChild(
        makeText(moneyText(round), {
          size: this.u(13),
          color: round > 0 ? COLORS.brass : round < 0 ? COLORS.warn : COLORS.mist,
          bold: true,
          align: 'right',
          width: roundW,
          height: this.u(18),
          x: roundX,
          y: this.u(7)
        })
      )
      row.addChild(
        makeText(moneyText(summary.total[seat]), {
          size: this.u(10),
          color: COLORS.mist,
          align: 'right',
          width: totalW,
          height: this.u(16),
          x: totalX,
          y: this.u(8)
        })
      )
    }

    const buttonY = py + panelH - this.u(48)
    const nextButton = makeButton({
      width: this.u(140),
      height: this.u(34),
      label: `开第 ${summary.roundIndex + 1} 局`,
      fontSize: this.u(12),
      face: 'tile',
      onClick: () => this.start()
    })
    nextButton.pos(px + panelW / 2 - this.u(124), buttonY)
    this.overlay.addChild(nextButton)

    const quitButton = makeButton({
      width: this.u(64),
      height: this.u(34),
      label: '退出',
      fontSize: this.u(11),
      face: 'chip',
      onClick: () => this.requestExit()
    })
    quitButton.pos(px + panelW / 2 + this.u(28), buttonY)
    this.overlay.addChild(quitButton)
  }

  /* ------------------------------------------------------------------ *
   * 开始界面
   * ------------------------------------------------------------------ */

  private renderIdle() {
    const m = this.m
    this.consumed.clear()
    this.renderWalls()

    const panelW = Math.min(m.boardW * 0.68, this.u(320))
    const panelH = Math.min(m.boardH * 0.44, this.u(200))
    const px = m.boardW / 2 - panelW / 2
    const py = m.boardH / 2 - panelH / 2
    const panel = makePanel(panelW, panelH, this.u(16), 'rgba(7,28,23,0.78)', 'rgba(217,180,95,0.3)', 1)
    panel.pos(px, py)
    this.content.addChild(panel)

    this.content.addChild(
      makeText('倒 子', {
        size: this.u(40),
        color: COLORS.ivory,
        bold: true,
        font: FONT_SERIF,
        align: 'center',
        width: panelW,
        height: this.u(54),
        x: px,
        y: py + panelH * 0.12
      })
    )
    this.content.addChild(
      makeText('缺一门，可碰可杠不可吃', {
        size: this.u(13),
        color: COLORS.mist,
        align: 'center',
        width: panelW,
        height: this.u(20),
        x: px,
        y: py + panelH * 0.44
      })
    )
    this.content.addChild(
      makeText('三家电脑陪你打 · 掷骰定东家 · 再选缺门', {
        size: this.u(11),
        color: COLORS.mist,
        align: 'center',
        width: panelW,
        height: this.u(18),
        x: px,
        y: py + panelH * 0.56
      })
    )

    const button = makeButton({
      width: this.u(150),
      height: this.u(38),
      label: '掷骰子',
      fontSize: this.u(14),
      face: 'tile',
      onClick: () => this.start()
    })
    button.pos(Math.round(px + panelW / 2 - this.u(75)), py + panelH * 0.7)
    this.content.addChild(button)
  }

  /* ------------------------------------------------------------------ *
   * 流程
   * ------------------------------------------------------------------ */

  private schedule(delay: number, callback: () => void) {
    Laya.timer.once(delay, this, callback)
  }

  private clearTimers() {
    Laya.timer.clearAll(this)
    this.stopSpin()
  }

  private stopSpin() {
    if (this.spinTimer !== null) {
      clearInterval(this.spinTimer)
      this.spinTimer = null
    }
  }

  start() {
    this.clearTimers()
    this.declinedWin = false
    this.showStats = false
    this.showExit = false
    this.roundSummary = null
    this.rollAndDeal()
  }

  private rollAndDeal() {
    this.clearTimers()
    this.stopSpin()
    this.declinedWin = false
    this.phase = 'rolling'
    this.autoCloseScheduled = false
    this.dice = null
    this.hand = null
    this.dealProgress = 0
    this.consumed.clear()
    this.dealtCounts = [0, 0, 0, 0]
    this.render()

    this.spinTimer = setInterval(() => {
      this.shownDice = { a: 1 + Math.floor(Math.random() * 6), b: 1 + Math.floor(Math.random() * 6) }
      this.positionDice()
    }, 70)

    this.schedule(950 * this.pace(), () => {
      this.stopSpin()
      const a = 1 + Math.floor(Math.random() * 6)
      const b = 1 + Math.floor(Math.random() * 6)
      this.shownDice = { a, b }
      this.dice = { a, b }

      let match = this.board ?? createMatch({ rollerSeat: 0 })
      if (match.current) match = endHand({ ...match, current: this.hand ?? match.current }, { rotate: false })
      const next = startHand(match, a, b)
      this.board = next
      const hand = next.current as HandState
      this.hand = hand
      this.persist()
      this.beginDealing(hand)
    })
  }

  private beginDealing(hand: HandState) {
    const trace = dealTrace(hand.dealerSeat, hand.wallSeat, hand.breakStacks)
    let index = 0
    this.phase = 'dealing'
    this.dealProgress = 0
    this.consumed = new Set<string>()
    this.dealtCounts = [0, 0, 0, 0]

    const step = () => {
      if (index >= trace.length) {
        this.phase = 'playing'
        this.render()
        this.schedule(320 * this.pace(), () => this.tick())
        return
      }
      const item = trace[index]
      index += 1
      this.dealProgress += 1
      this.consumed.add(`${item.from}-${item.col}-${item.layer}`)
      this.dealtCounts = this.dealtCounts.map((n, seat) => (seat === item.seat ? n + 1 : n))
      this.render()
      const pause = item.bulk ? (index % 4 === 0 ? 150 : 48) : 190
      this.schedule(pause * this.pace(), step)
    }
    step()
  }

  private tick() {
    const hand = this.hand
    if (!hand || this.phase !== 'playing') return
    if (this.showStats || this.showExit) return
    if (hand.phase === 'over') {
      // 自动模式下自己点「下一把」，方便整局跑通验收
      if (AUTO && !this.autoCloseScheduled) {
        this.autoCloseScheduled = true
        this.schedule(4000, () => {
          this.autoCloseScheduled = false
          if (this.hand && this.hand.phase === 'over') this.closeHand()
        })
      }
      return
    }

    if (hand.phase === 'choose-shortage') {
      // 一次把三家 AI 的定缺都落下来，玩家选缺时就能看到所有人缺什么
      let changed = false
      let current = hand
      while (current.phase === 'choose-shortage') {
        const pending = current.players.find(player => !player.shortage && (player.isAI || (AUTO && player.seat === 0)))
        if (!pending) break
        const action = chooseAIAction(current, pending.seat)
        if (!action) break
        try {
          current = applyAction(current, action)
          changed = true
        } catch {
          break
        }
      }
      if (changed) {
        this.hand = current
        this.persist()
        this.render()
        this.schedule(240 * this.pace(), () => this.tick())
      }
      return
    }

    const seat = this.currentActor(hand)
    if (seat === null) return
    if (!hand.players[seat].isAI && !(AUTO && seat === 0)) return
    const action = chooseAIAction(hand, seat)
    if (!action) return
    try {
      this.hand = applyAction(hand, action)
    } catch {
      return
    }
    this.persist()
    this.render()
    this.schedule((900 + Math.random() * 900) * this.pace(), () => this.tick())
  }

  private act(action: RoundAction, delay = 420) {
    const hand = this.hand
    if (!hand) return
    if (action.type !== 'discard') this.declinedWin = false
    try {
      this.hand = applyAction(hand, action)
    } catch (error) {
      console.error('act failed', JSON.stringify(action), error)
      return
    }
    this.persist()
    this.render()
    this.schedule(delay * this.pace(), () => this.tick())
  }

  private closeHand() {
    const match = this.board
    const hand = this.hand
    if (!match || !hand || !match.current) return
    const settlement = settleHand(hand)
    this.updateHistory(settlement)
    const roundIndex = match.roundIndex
    const hands = match.hands + 1
    const roundMoney = match.money.map((value, seat) => value + (settlement?.moneyDelta[seat] ?? 0))
    const finalPoints = hand.players.map((player, seat) => player.points + (settlement?.pointDelta[seat] ?? 0))
    const closed = endHand({ ...match, current: hand }, { rotate: false })
    this.board = closed

    if (settlement && settlement.gameOver) {
      this.roundSummary = {
        roundIndex,
        hands,
        money: roundMoney,
        points: finalPoints,
        total: closed.totalMoney
      }
      this.phase = 'round-over'
      this.persist()
      this.render()
      return
    }
    this.persist()
    this.rollAndDeal()
  }

  /* ------------------------------------------------------------------ *
   * 累计战绩 / 存档 / 退出
   * ------------------------------------------------------------------ */

  private restoreGame(saved: SavedGame) {
    if (!saved.board) return
    this.board = saved.board
    const hand = saved.hand ?? saved.board.current ?? null
    if (saved.roundSummary) {
      this.roundSummary = saved.roundSummary
      this.hand = saved.hand ?? null
      this.phase = 'round-over'
    } else if (hand) {
      this.board.current = hand
      this.hand = hand
      this.phase = 'playing'
    } else {
      this.hand = null
      this.phase = 'idle'
    }
    this.dice = saved.dice ?? null
    this.shownDice = saved.shownDice ?? { a: 1, b: 1 }
  }

  private persist() {
    if (!this.board && !this.hand && !this.roundSummary) return
    const atRoundOver = this.phase === 'round-over'
    const hand = this.hand
    const board = this.board ? { ...this.board, current: atRoundOver ? null : hand ?? this.board.current } : null
    saveGame({ board, hand, roundSummary: this.roundSummary, dice: this.dice, shownDice: this.shownDice })
    saveHistory(this.history)
  }

  private updateHistory(settlement: HandSettlement | null) {
    if (settlement) {
      for (let seat = 0; seat < 4; seat += 1) {
        this.history.seats[seat].money += settlement.moneyDelta[seat] ?? 0
      }
      const win = this.hand?.winner
      if (win) {
        const stats = this.history.seats[win.seat]
        stats.wins += 1
        stats.points += win.score.points.total
        stats.moziBig += win.score.mozi.big
        stats.moziSmall += win.score.mozi.small
      }
    }
    this.history.hands += 1
    if (settlement?.gameOver) this.history.rounds += 1
    saveHistory(this.history)
  }

  private requestStats() {
    if (this.showStats || this.showExit) return
    this.clearTimers()
    this.showStats = true
    this.render()
  }

  private requestExit() {
    if (this.showExit) return
    this.clearTimers()
    this.showExit = true
    this.render()
  }

  private closeOverlay() {
    this.showStats = false
    this.showExit = false
    this.render()
    if (this.phase === 'playing') this.schedule(300, () => this.tick())
  }

  private keepAndExit() {
    this.persist()
    this.showExit = false
    this.quit()
  }

  private clearAndExit() {
    clearAllData()
    this.history = createHistory()
    this.showExit = false
    this.quit()
  }

  private renderHistoryIcon() {
    if (this.phase !== 'idle' && this.phase !== 'playing') return
    if (this.showStats || this.showExit) return
    const size = this.u(30)
    if (size < 18) return
    const icon = new Laya.Sprite()
    icon.size(size, size)
    const r = Math.max(4, Math.round(size * 0.24))
    icon.graphics.drawRoundRect(0, 0, size, size, r, r, r, r, 'rgba(9,33,27,0.9)', 'rgba(217,180,95,0.55)', 1)
    const barW = Math.max(2, Math.round(size * 0.11))
    const baseY = size * 0.76
    const bars = [
      { x: 0.25, h: 0.22, color: COLORS.mist },
      { x: 0.445, h: 0.36, color: COLORS.brass },
      { x: 0.64, h: 0.5, color: COLORS.ivory }
    ]
    for (const bar of bars) {
      icon.graphics.drawRect(size * bar.x, baseY - size * bar.h, barW, size * bar.h, bar.color)
    }
    icon.hitArea = new Laya.Rectangle(0, 0, size, size)
    icon.mouseEnabled = true
    icon.on(Laya.Event.CLICK, null, () => this.requestStats())
    icon.pos(this.u(8), this.u(8))
    this.content.addChild(icon)
  }

  private renderOverlays() {
    if (this.showStats) this.renderStatsPanel()
    if (this.showExit) this.renderExitPanel()
  }

  private overlayDim(): Laya.Sprite {
    const m = this.m
    const dim = new Laya.Sprite()
    dim.size(m.W, m.H)
    dim.graphics.drawRect(0, 0, m.W, m.H, 'rgba(4,18,14,0.9)')
    dim.mouseEnabled = true
    this.overlay.addChild(dim)
    return dim
  }

  private renderStatsPanel() {
    const m = this.m
    this.overlayDim()
    const panelW = Math.round(Math.min(m.W * 0.86, this.u(430)))
    const panelH = Math.round(Math.min(m.H * 0.82, this.u(360)))
    const px = Math.round((m.W - panelW) / 2)
    const py = Math.round((m.H - panelH) / 2)
    const panel = makePanel(panelW, panelH, this.u(16), 'rgba(9,34,27,0.98)', 'rgba(217,180,95,0.42)', 1.5)
    panel.pos(px, py)
    this.overlay.addChild(panel)

    this.overlay.addChild(
      makeText('累计战绩', {
        size: this.u(20),
        color: COLORS.brass,
        bold: true,
        font: FONT_SERIF,
        align: 'center',
        width: panelW,
        height: this.u(30),
        x: px,
        y: py + this.u(12)
      })
    )
    this.overlay.addChild(
      makeText(`累计 ${this.history.rounds} 局 · ${this.history.hands} 把`, {
        size: this.u(11),
        color: COLORS.mist,
        align: 'center',
        width: panelW,
        height: this.u(16),
        x: px,
        y: py + this.u(42)
      })
    )

    const rowH = this.u(52)
    let y = py + this.u(66)
    for (let seat = 0; seat < 4; seat += 1) {
      const stats = this.history.seats[seat]
      this.overlay.addChild(
        makeText(SEAT_NAMES[seat], {
          size: this.u(12),
          color: COLORS.ivory,
          font: FONT_SERIF,
          width: this.u(60),
          height: this.u(20),
          x: px + this.u(16),
          y
        })
      )
      this.overlay.addChild(
        makeText(`成牌 ${stats.wins} 次 · ${stats.points} 点`, {
          size: this.u(10),
          color: COLORS.mist,
          width: panelW - this.u(100),
          height: this.u(16),
          x: px + this.u(74),
          y
        })
      )
      this.overlay.addChild(
        makeText(`大摸 ${stats.moziBig} · 小摸 ${stats.moziSmall} · 输赢 ${moneyText(stats.money)} 元`, {
          size: this.u(9),
          color: stats.money > 0 ? COLORS.brass : stats.money < 0 ? COLORS.warn : COLORS.mist,
          width: panelW - this.u(100),
          height: this.u(15),
          x: px + this.u(74),
          y: y + this.u(17)
        })
      )
      const line = new Laya.Sprite()
      line.size(panelW - this.u(32), 1)
      line.graphics.drawRect(0, 0, panelW - this.u(32), 1, 'rgba(217,180,95,0.14)')
      line.pos(px + this.u(16), y + rowH - this.u(4))
      this.overlay.addChild(line)
      y += rowH
    }

    const close = makeButton({
      width: this.u(90),
      height: this.u(30),
      label: '关闭',
      fontSize: this.u(12),
      face: 'chip',
      onClick: () => this.closeOverlay()
    })
    close.pos(Math.round(px + panelW / 2 - this.u(45)), Math.round(py + panelH - this.u(44)))
    this.overlay.addChild(close)
  }

  private renderExitPanel() {
    const m = this.m
    this.overlayDim()
    const panelW = Math.round(Math.min(m.W * 0.86, this.u(380)))
    const panelH = this.u(210)
    const px = Math.round((m.W - panelW) / 2)
    const py = Math.round((m.H - panelH) / 2)
    const panel = makePanel(panelW, panelH, this.u(16), 'rgba(9,34,27,0.98)', 'rgba(217,180,95,0.42)', 1.5)
    panel.pos(px, py)
    this.overlay.addChild(panel)

    this.overlay.addChild(
      makeText('退出游戏', {
        size: this.u(18),
        color: COLORS.brass,
        bold: true,
        font: FONT_SERIF,
        align: 'center',
        width: panelW,
        height: this.u(28),
        x: px,
        y: py + this.u(14)
      })
    )
    this.overlay.addChild(
      makeText('保留本局和累计战绩，下次进入继续？', {
        size: this.u(12),
        color: COLORS.ivory,
        align: 'center',
        width: panelW - this.u(20),
        height: this.u(20),
        x: px + this.u(10),
        y: py + this.u(54)
      })
    )
    this.overlay.addChild(
      makeText('清空会删除所有累计成牌、摸子和输赢记录。', {
        size: this.u(10),
        color: COLORS.mist,
        align: 'center',
        width: panelW - this.u(20),
        height: this.u(18),
        x: px + this.u(10),
        y: py + this.u(78)
      })
    )

    const by = py + panelH - this.u(52)
    const keep = makeButton({
      width: this.u(110),
      height: this.u(34),
      label: '保留并退出',
      fontSize: this.u(11),
      face: 'tile',
      onClick: () => this.keepAndExit()
    })
    keep.pos(Math.round(px + panelW / 2 - this.u(170)), by)
    this.overlay.addChild(keep)

    const clear = makeButton({
      width: this.u(110),
      height: this.u(34),
      label: '清空并退出',
      fontSize: this.u(11),
      face: 'chip',
      onClick: () => this.clearAndExit()
    })
    clear.pos(Math.round(px + panelW / 2 - this.u(55)), by)
    this.overlay.addChild(clear)

    const cancel = makeButton({
      width: this.u(74),
      height: this.u(34),
      label: '取消',
      fontSize: this.u(11),
      face: 'ghost',
      onClick: () => this.closeOverlay()
    })
    cancel.pos(Math.round(px + panelW / 2 + this.u(62)), by)
    this.overlay.addChild(cancel)
  }

  private quit() {
    this.clearTimers()
    this.stopSpin()
    this.declinedWin = false
    this.showStats = false
    this.showExit = false
    this.phase = 'idle'
    this.board = null
    this.hand = null
    this.dice = null
    this.shownDice = { a: 1, b: 1 }
    this.dealProgress = 0
    this.consumed.clear()
    this.dealtCounts = [0, 0, 0, 0]
    this.roundSummary = null
    this.render()
  }

  /* ------------------------------------------------------------------ *
   * 工具
   * ------------------------------------------------------------------ */

  private measureText(content: string, size: number, bold = false): number {
    const text = makeText(content, { size, color: '#FFFFFF', bold, width: size * 20, height: size * 1.4 })
    const width = text.textWidth
    text.destroy()
    return width || content.length * size * 0.86
  }
}
