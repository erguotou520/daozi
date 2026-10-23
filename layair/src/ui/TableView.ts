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
  daLiaoCheWarning,
  forbiddenDiscardsFor,
  isTenpaiHand,
  legalActions,
  playableDiscards,
  remainingTiles,
  revealHandTiles,
  settleHand,
  shortageTiles,
  threeToOneOf,
  wallVisualOf,
  type HandSettlement,
  type HandState,
  type RoundAction
} from '../game/game'
import { ROUNDS_PER_CIRCLE, dealTrace, seatFromDice } from '../game/table'
import { createMatch, endHand, startHand, STARTING_POINTS, type MatchState } from '../game/match'
import { meldTiles, parseTile, tileOrder, type Meld, type NumberSuit, type Tile } from '../game/score'
import { BUILD_TAG, COLORS, FONT_SERIF, SEAT_NAMES, TILE_FACE_RATIO, TILE_RATIO } from './theme'
import { DiceView, drawShareGlyph, drawSpeakerGlyph, makeButton, makePanel, makeText, makeWallStack, TileView } from './widgets'
import { Table3D } from './Table3D'
import { voice } from '../audio/voice'
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
import {
  DEFAULT_SHARE_TITLE,
  SHARE_QUERY_FRIEND,
  initShare,
  isWechatMiniGame,
  isPrivacyError,
  saveImageToAlbum,
  setShareCard,
  shareImage,
  shareToFriend
} from './share'

const STACKS = 17
const PER_LINE = 13
const SHORTAGE_OPTIONS: NumberSuit[] = ['万', '筒', '条']
/** 红色「听」标记的边长（设计值，实际会乘 scale） */
const LISTEN_BADGE = 22
/** 设计基准：牌桌宽约 375 逻辑像素时 scale = 1 */
const BASE_BOARD = 375

type TablePhase = 'idle' | 'rolling' | 'dealing' | 'playing' | 'round-over'

/** 四局调圈的结果（只在第 4、8…局结束时出现） */
interface CircleSummary {
  diceA: number
  diceB: number
  /** 掷骰的人：最后成牌的人 */
  rollerSeat: number
  /** 位置不动的那家（换座后的座位号） */
  fixedSeat: number
}

interface RoundSummary {
  roundIndex: number
  hands: number
  money: number[]
  points: number[]
  /** 调圈前结清的累计（按这一局坐的位置） */
  total: number[]
  /** 四局调圈：谁掷的骰、谁位置不动 */
  circle?: CircleSummary
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

const moneyText = (value: number) => `${value > 0 ? '+' : ''}${Math.round(value)}`

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
  /** 默认走 2D 牌桌；地址栏加 ?3d=1 切回 3D */
  private use3D = false
  /** 浏览器 / IDE 预览里没有 wx，加 ?share=1 也能看到分享入口和面板 */
  private sharePreview = false
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
  /** 三打一 / 定缺等临时提示条 */
  private notice: string | null = null
  /** 三打一的明牌家已经听牌时，记下这家（红色「听」标记） */
  private tenpaiSeat: number | null = null
  /** 3D 手牌的两段式出牌：第一下选中（牌抬起来），第二下才打出 */
  private selectedIndex = -1
  private selectedTile: Tile | null = null
  /** 拖动视角的临时状态：拖动过就不再把 mouseup 当成点牌 */
  private dragLast: { x: number; y: number } | null = null
  private dragMoved = false
  private suppressClick = false
  private camHud: Laya.Text | null = null
  /** 3D 手牌的点击区（content 局部坐标），用来判断拖动是不是从牌上开始的 */
  private handHitRects: Array<{ x: number; y: number; w: number; h: number }> = []
  private history: HistoryState = createHistory()
  /** 本局战绩（每局重新计数），累计战绩在 history */
  private roundStats: HistoryState = createHistory()
  /** 战绩面板当前 tab：本局 / 累计 */
  private statsTab: 'round' | 'total' = 'round'
  private showStats = false
  private showExit = false
  /** 出牌/操作后的 300ms 输入锁：这期间点什么都不响应 */
  private actionLockUntil = 0
  /** AI 正在「思考」：避免重复排程 */
  private aiPending = false
  private rotateLandscape = false
  private viewW = 0
  private viewH = 0

  constructor(owner: Laya.Sprite, viewport?: { rotate: boolean; width: number; height: number }) {
    console.log(`[daozi] build ${BUILD_TAG}`)
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

    // 运行模式：默认 2D；?3d=1 切 3D、?2d=1 显式指定 2D
    // （IDE 内置预览没有地址栏，所以默认值必须是 2D）
    const search = (HAS_WINDOW && ((window as any).location?.search ?? '')) || ''
    if (/[?&]3d=1/.test(search)) this.use3D = true
    if (/[?&]2d=1/.test(search)) this.use3D = false
    if (/[?&]share=1/.test(search)) this.sharePreview = true

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
    // 微信小游戏：先把右上角菜单的「发送给朋友 / 分享到朋友圈」打开
    // （不调 showShareMenu 的话菜单里的转发是灰的、朋友圈也分享不了）
    initShare()

    this.m = this.measure()
    this.content.pos(this.m.boardX, this.m.boardY)
    this.drawChrome()
    this.render()
    Laya.timer.once(40, this, this.init3D)

    Laya.stage.on(Laya.Event.KEY_DOWN, this, this.onKeyDown)
    // 3D 视角：拖动旋转，滚轮缩放
    Laya.stage.on(Laya.Event.MOUSE_DOWN, this, this.onStageDown)
    Laya.stage.on(Laya.Event.MOUSE_MOVE, this, this.onStageMove)
    Laya.stage.on(Laya.Event.MOUSE_UP, this, this.onStageUp)
    if ((Laya.Event as unknown as { MOUSE_WHEEL?: string }).MOUSE_WHEEL) {
      Laya.stage.on((Laya.Event as unknown as { MOUSE_WHEEL: string }).MOUSE_WHEEL, this, this.onWheel)
    }
    this.createDice()
    this.positionDice()
    voice.preload(800)
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
    this.three.sync(
      this.hand,
      this.myHandTiles(),
      dice,
      this.phase === 'rolling',
      this.wallVisual(),
      this.dealtCounts,
      this.phase === 'dealing',
      { selectedIndex: this.selectedIndex, dimTiles: this.dimTiles() },
      this.tenpaiSeat
    )
    this.threeView.graphics.clear()
    this.threeView.graphics.drawTexture(this.three.texture, 0, 0, this.viewW, this.viewH)
  }

  /** 当前轮到自己、但规则上不许打的牌：3D 里压成灰调，且不接点击 */
  private dimTiles(): Set<Tile> {
    const hand = this.hand
    const result = new Set<Tile>()
    if (!hand || !this.is3D()) return result
    const myTurn = hand.phase === 'discard' && this.currentActor(hand) === 0
    if (!myTurn) return result
    const playable = new Set(playableDiscards(hand, 0))
    const forbidden = new Set(forbiddenDiscardsFor(hand, 0))
    for (const tile of this.myHandTiles()) {
      if (!playable.has(tile) || forbidden.has(tile)) result.add(tile)
    }
    return result
  }

  private is3D(): boolean {
    return this.use3D && !!this.three
  }

  /** 以 375 牌桌宽/高为基准的缩放 */
  private u(value: number): number {
    return Math.round(value * this.m.scale)
  }

  /** 横屏桌面的伪透视：顶部 80% 宽，底部 100% 宽 */
  /**
   * 透视系数：2D 版改成纯平面牌桌，这里恒为 1。
   * （原来按 y 在 0.8~1.0 之间缩放，左右两面牌墙因此被排成斜的、
   *  牌河每行大小也不一样，看着乱。留一个函数方便以后想加回来。）
   */
  private persp(y: number): number {
    void y
    return 1
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
    const discardH = Math.round(discardW * TILE_FACE_RATIO)
    const meldW = Math.max(18, Math.round(boardH * 0.050))
    const meldH = Math.round(meldW * TILE_FACE_RATIO)

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
    // 中央只放「牌山 + 轮到谁」两行，面板收到最小
    const panelW = Math.max(150, Math.min(ringW * 0.46, u(210)))
    const panelH = Math.max(64, Math.min(ringH * 0.22, u(78)))

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
    const discardH = Math.round(discardW * TILE_FACE_RATIO)
    const meldW = Math.max(12, Math.round(bw * 0.031))
    const meldH = Math.round(meldW * TILE_FACE_RATIO)

    const laneTop = Math.round(ringY + wallT + 4)
    const laneBottom = Math.round(ringY + ringH - wallT - 4)
    const laneLeft = Math.round(ringX + wallT + 6)
    const laneRight = Math.round(ringX + ringW - wallT - 6)

    const sideLane = discardH
    const panelW = Math.max(140, Math.round(Math.min(ringW * 0.5, 220 * scale)))
    const panelH = Math.max(60, Math.round(Math.min(ringH * 0.24, 84 * scale)))

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
    const cm = this.centerPanelMetrics()
    if (!cm.showDice) {
      this.diceLayer.visible = false
      return
    }
    // 骰子放进中央半透明面板内部，尺寸再缩小一档
    const size = cm.diceSize
    const gap = cm.diceGap
    const scale = size / 60
    const totalW = size * 2 + gap
    const x0 = Math.round(cm.x + (cm.width - totalW) / 2)
    const y = Math.round(cm.y + cm.diceY)
    for (let i = 0; i < this.diceViews.length; i += 1) {
      const view = this.diceViews[i]
      view.scale(scale, scale)
      view.pos(x0 + i * (size + gap), y)
      view.setValue(i === 0 ? this.shownDice.a : this.shownDice.b)
    }
    this.diceLayer.pos(m.boardX, m.boardY)
    this.diceLayer.visible = true
  }

  /* ------------------------------------------------------------------ *
   * 主渲染
   * ------------------------------------------------------------------ */

  private render() {
    this.content.destroyChildren()
    this.content.graphics.clear()
    this.overlay.destroyChildren()
    this.tenpaiSeat = this.findTenpaiSeat()
    // 转发卡片标题跟着局面走：成牌后、对局中、空闲页各不相同
    setShareCard({ title: this.shareTitle(), query: SHARE_QUERY_FRIEND })
    if (this.is3D()) this.sync3D()

    if (this.phase === 'idle') {
      this.renderIdle()
      this.renderHistoryIcon()
      this.renderVoiceIcon()
      this.renderShareIcon()
      this.renderOverlays()
      this.renderCameraHud()
      this.positionDice()
      return
    }

    // 旧存档 / 极端情况下局结束但没有最后一把可展示：只铺总账，避免空 hand 崩溃
    if (this.phase === 'round-over' && !this.hand) {
      this.renderRoundSummary()
      this.renderOverlays()
      this.renderCameraHud()
      this.positionDice()
      return
    }

    this.renderWalls()
    this.renderDiscards()
    this.renderCenter()
    this.renderTopHud()
    this.renderSeats()
    this.renderHand()
    this.renderSettlement()
    this.renderDock()
    this.renderRoundSummary()
    this.renderHistoryIcon()
    this.renderVoiceIcon()
    this.renderShareIcon()
    this.renderOverlays()
    this.renderCameraHud()
    this.positionDice()
  }

  /* ------------------------------------------------------------------ *
   * 视角：拖动旋转 / 滚轮缩放，并把当前参数贴在左上角方便抄下来
   * ------------------------------------------------------------------ */

  private camHudText(): string {
    if (!this.three) return ''
    const info = this.three.cameraInfo()
    return `视角 俯${info.pitch}° 方位${info.yaw}° · fov${info.fov} · 距${info.dist}\npos ${info.pos}\n拖动空白处旋转 · 滚轮缩放`
  }

  private renderCameraHud() {
    this.camHud = null
    if (!this.is3D()) return
    const w = Math.round(Math.min(300, Math.max(196, this.viewW * 0.34)))
    const fs = Math.max(10, Math.round(w * 0.042))
    const h = fs * 4 + 10
    const panel = makePanel(w, h, 6, 'rgba(6,26,20,0.66)', 'rgba(217,180,95,0.35)', 1)
    panel.pos(8, 8)
    panel.mouseEnabled = false
    const text = makeText(this.camHudText(), {
      size: fs,
      color: 'rgba(226,236,228,0.94)',
      width: w - 12,
      height: h - 6,
      x: 6,
      y: 4
    })
    text.mouseEnabled = false
    panel.addChild(text)
    this.camHud = text
    this.overlay.addChild(panel)

    // 复位按钮：拖乱了可以一键回到默认视角
    const reset = makeButton({
      width: 46,
      height: fs + 10,
      label: '复位视角',
      fontSize: fs,
      face: 'chip',
      onClick: () => {
        this.three?.resetCamera()
        this.updateCamHud()
        this.render()
      }
    })
    reset.pos(8, 8 + h + 4)
    reset.mouseEnabled = true
    this.overlay.addChild(reset)
  }

  private updateCamHud() {
    if (this.camHud) this.camHud.text = this.camHudText()
  }

  private onStageDown(event: Laya.Event) {
    if (!this.is3D()) return
    this.suppressClick = false
    this.dragMoved = false
    // 从自己的手牌上起手时不去转视角，避免点牌被拖动吃掉
    const p = this.content.globalToLocal(new Laya.Point(event.stageX, event.stageY))
    const onTile = this.handHitRects.some(
      r => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
    )
    this.dragLast = onTile ? null : { x: event.stageX, y: event.stageY }
  }

  private onStageMove(event: Laya.Event) {
    if (!this.dragLast || !this.is3D()) return
    const dx = event.stageX - this.dragLast.x
    const dy = event.stageY - this.dragLast.y
    if (!this.dragMoved && Math.abs(dx) + Math.abs(dy) < 5) return
    this.dragMoved = true
    this.dragLast = { x: event.stageX, y: event.stageY }
    this.three?.orbit(dx, dy)
    this.updateCamHud()
  }

  private onStageUp() {
    if (!this.dragLast) return
    this.dragLast = null
    if (!this.dragMoved) return
    // 拖动过就别把这次松手当成点牌
    this.suppressClick = true
    this.render()
  }

  private onWheel(event: Laya.Event) {
    if (!this.is3D()) return
    const delta = (event as unknown as { delta?: number }).delta ?? 0
    this.three?.zoom(delta > 0 ? 1.06 : 0.94)
    this.updateCamHud()
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
    const gap = 0

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
    if (hand.phase === 'rob-kong') return hand.robKong?.pending[0] ?? null
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

  /**
   * 中央面板里的大操作按钮：定缺 / 碰 / 杠 / 成 / 过 / 打。
   * 2D 把这些按钮从操作条搬进黑色提示面板，字更大、更好点。
   */
  private centerActions(hand: HandState): Array<{ label: string; onClick: () => void }> {
    if (this.is3D() || this.phase !== 'playing' || hand.phase === 'over') return []
    // 定缺是四家同时选，谁先选都行，不能受「轮到自己」限制：
    // 否则只有庄家是自己那一把能点，庄家换成别家后按钮就再也不出现了。
    if (hand.phase === 'choose-shortage') {
      if (hand.players[0].shortage) return []
      return SHORTAGE_OPTIONS.map(suit => ({ label: `缺${suit}`, onClick: () => this.act({ type: 'chooseShortage', seat: 0, suit }) }))
    }
    if (!this.isMyTurn(hand)) return []
    const actions = legalActions(hand, 0)
    const out: Array<{ label: string; onClick: () => void }> = []
    if (hand.phase === 'claim' || hand.phase === 'rob-kong') {
      for (const action of actions) {
        if (action.type === 'pass') out.push({ label: '过', onClick: () => this.act(action) })
        else if (action.type === 'claim') out.push({ label: action.claim, onClick: () => this.act(action) })
        else if (action.type === 'win') out.push({ label: '成', onClick: () => this.act(action) })
        else if (action.type === 'kong') out.push({ label: `杠${action.tile}`, onClick: () => this.act(action) })
      }
      return out
    }
    if (hand.phase === 'discard') {
      const winAction = actions.find((action): action is Extract<RoundAction, { type: 'win' }> => action.type === 'win')
      if (winAction && !this.declinedWin) {
        out.push({ label: '成', onClick: () => this.act(winAction) })
        out.push({
          label: '打',
          onClick: () => {
            this.declinedWin = true
            this.render()
          }
        })
      }
      for (const action of actions) {
        if (action.type === 'kong') out.push({ label: `杠${action.tile}`, onClick: () => this.act(action) })
      }
    }
    return out
  }

  /** 中央提示面板：骰子、状态、轮到谁、退出都放在同一块半透明面板里，高度由内容撑开 */
  private centerPanelMetrics() {
    const m = this.m
    const hand = this.hand
    const rolling = this.phase === 'rolling'
    const over = !hand || hand.phase === 'over'
    const showDice = this.phase !== 'idle' && !over
    const showStatus = this.phase !== 'idle' && !over
    const showTurn = !!hand && !over && !rolling
    const showThree = !!hand && !over && hand.threeToOneSeat !== null
    const diceSize = this.u(rolling ? 20 : 15)
    const diceGap = this.u(2)
    const exitH = this.u(20)
    const width = m.panelW
    let y = this.u(7)
    const diceY = showDice ? y : 0
    if (showDice) y += diceSize + diceGap
    const statusY = showStatus ? y : 0
    if (showStatus) y += this.u(14) + this.u(2)
    const turnY = showTurn ? y : 0
    if (showTurn) y += this.u(20) + this.u(2)
    const threeY = showThree ? y : 0
    if (showThree) y += this.u(14) + this.u(2)
    const actionRow = this.phase === 'playing' && hand ? this.centerActions(hand) : []
    const actionHeight = this.u(38)
    const actionGap = this.u(6)
    const actionY = actionRow.length ? y : 0
    if (actionRow.length) y += actionHeight + actionGap
    const showExit = this.phase !== 'idle' && !over
    const exitY = showExit ? y : 0
    if (showExit) y += exitH + this.u(4)
    const height = Math.max(this.u(70), y + this.u(3))
    return {
      x: Math.round(m.boardW / 2 - width / 2),
      y: Math.round(m.boardH / 2 - height / 2),
      width,
      height,
      diceSize,
      diceGap,
      diceY,
      statusY,
      turnY,
      threeY,
      exitY,
      exitH,
      actionRow,
      actionY,
      actionHeight,
      actionGap,
      showDice,
      showStatus,
      showTurn,
      showThree,
      showExit,
      rolling
    }
  }

  /** 中央提示：只留「牌山 / 发牌」和「轮到谁」两行，面板缩到最小 */
  private renderCenter() {
    if (this.is3D()) {
      this.renderCenter3D()
      return
    }
    const m = this.m
    const hand = this.hand
    const cm = this.centerPanelMetrics()
    if (!cm.showStatus && !cm.showTurn && !cm.showDice) return
    const { x: px, y: py, width, height } = cm

    if (cm.rolling) {
      const panel = makePanel(width, height, this.u(10), 'rgba(7,28,23,0.62)', 'rgba(217,180,95,0.22)')
      panel.pos(px, py)
      this.content.addChild(panel)
      this.content.addChild(
        makeText('掷骰…', {
          size: this.u(13),
          color: COLORS.mist,
          align: 'center',
          width,
          height: this.u(18),
          x: px,
          y: py + cm.statusY
        })
      )
      this.addCenterExit(cm)
      return
    }

    if (!hand || hand.phase === 'over') return

    const panel = makePanel(width, height, this.u(10), 'rgba(7,28,23,0.62)', 'rgba(217,180,95,0.22)')
    panel.pos(px, py)
    this.content.addChild(panel)

    const status = this.phase === 'dealing' ? `发牌 ${this.dealProgress}/53` : `牌山 ${remainingTiles(hand)}`
    if (cm.showStatus) {
      this.content.addChild(
        makeText(status, {
          size: this.u(10),
          color: COLORS.mist,
          align: 'center',
          width,
          height: this.u(14),
          x: px,
          y: py + cm.statusY
        })
      )
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
    if (cm.showTurn) {
      this.content.addChild(
        makeText(turnText, {
          size: this.u(14),
          color: COLORS.ivory,
          font: FONT_SERIF,
          align: 'center',
          width,
          height: this.u(20),
          x: px,
          y: py + cm.turnY
        })
      )
    }

    if (cm.showThree) {
      this.content.addChild(
        makeText(this.threeToOneLabel(), {
          size: this.u(10),
          color: COLORS.brass,
          align: 'center',
          width,
          height: this.u(14),
          x: px,
          y: py + cm.threeY
        })
      )
    }

    if (cm.actionRow.length) {
      const rowW = width - this.u(20)
      const gap = this.u(5)
      const bw = Math.floor((rowW - gap * (cm.actionRow.length - 1)) / cm.actionRow.length)
      let bx = px + this.u(10)
      for (const item of cm.actionRow) {
        const face = item.label === '打' || item.label === '过' ? 'chip' : 'tile'
        let fontSize = this.u(15)
        while (fontSize > this.u(9) && this.measureText(item.label, fontSize) > bw - this.u(8)) fontSize -= 1
        const button = makeButton({
          width: bw,
          height: cm.actionHeight,
          label: item.label,
          fontSize,
          face,
          onClick: item.onClick
        })
        button.pos(Math.round(bx), Math.round(py + cm.actionY))
        this.content.addChild(button)
        bx += bw + gap
      }
    }

    this.addCenterExit(cm)
  }

  private addCenterExit(cm: ReturnType<TableView['centerPanelMetrics']>) {
    if (!cm.showExit) return
    const exit = makeButton({
      width: this.u(52),
      height: cm.exitH,
      label: '退出',
      fontSize: this.u(9),
      face: 'ghost',
      onClick: () => this.requestExit()
    })
    exit.pos(Math.round(cm.x + (cm.width - this.u(52)) / 2), Math.round(cm.y + cm.exitY))
    this.content.addChild(exit)
  }

  private renderTopHud() {
    if (this.is3D()) return
    const match = this.board
    if (this.phase !== 'playing' || !match) return
    const hand = this.hand
    const text = `第 ${match.roundIndex} 局 · 第 ${match.hands + 1} 把${hand?.isFirstHand ? ' · 首牌' : ''}`
    this.content.addChild(
      makeText(text, {
        size: this.u(9),
        color: COLORS.mist,
        width: this.u(160),
        height: this.u(14),
        x: this.u(50),
        y: this.u(9)
      })
    )
  }

  /* ------------------------------------------------------------------ *
   * 三家座位
   * ------------------------------------------------------------------ */

  private seatTiles(seat: number): Tile[] {
    const hand = this.hand
    if (!hand) return []
    if (this.phase === 'dealing') return hand.players[seat].hand.slice(0, this.dealtCounts[seat] ?? 0)
    if ((hand.phase === 'over' && hand.winner?.seat === seat) || this.openSeat(seat)) return this.revealTiles(seat)
    return hand.players[seat].hand
  }

  /** 三打一：三家同缺时，缺另一门的那家把「三家缺的那门」翻开，其余手牌不亮 */
  private openSeat(seat: number): boolean {
    const hand = this.hand
    return !!hand && hand.threeToOneSeat === seat
  }

  /** 三打一要翻开的花色（三家共同缺的那门） */
  private openSuit(): NumberSuit | null {
    const hand = this.hand
    return hand ? hand.threeToOneSuit : null
  }

  /** 「三打一 · 下家亮万」 */
  private threeToOneLabel(): string {
    const hand = this.hand
    if (!hand || hand.threeToOneSeat === null) return ''
    const who = hand.threeToOneSeat === 0 ? '你' : SEAT_NAMES[hand.threeToOneSeat]
    return `三打一 · ${who}亮${hand.threeToOneSuit ?? '牌'}`
  }

  /** 三打一的明牌家当前是否听牌 */
  private findTenpaiSeat(): number | null {
    const hand = this.hand
    const seat = hand?.threeToOneSeat
    if (!hand || seat === null || seat === undefined) return null
    return isTenpaiHand(hand.players[seat]) ? seat : null
  }

  /** 红底红字的「听」标记：摆在明牌家手牌前面 */
  private drawListenBadge(x: number, y: number) {
    const size = this.u(LISTEN_BADGE)
    const badge = makePanel(size, size, this.u(4), '#B03A26')
    badge.pos(Math.round(x), Math.round(y))
    badge.mouseEnabled = false
    const inner = makePanel(size - this.u(4), size - this.u(4), this.u(3), '#F7EEDA')
    inner.pos(this.u(2), this.u(2))
    badge.addChild(inner)
    badge.addChild(
      makeText('听', {
        size: this.u(14),
        color: '#B03A26',
        bold: true,
        font: FONT_SERIF,
        align: 'center',
        valign: 'middle',
        width: size,
        height: size
      })
    )
    this.content.addChild(badge)
  }

  private revealTiles(seat: number): Tile[] {
    const hand = this.hand
    return hand ? revealHandTiles(hand, seat) : []
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
    align: 'left' | 'center',
    open = false
  ): number {
    const nameSize = this.u(10)
    const restSize = this.u(9)
    const nameW = Math.max(this.u(26), this.measureText(name, nameSize))
    const openSuit = open ? this.openSuit() : null
    const restStr = `${shortage ? `缺${shortage}` : '—'}${openSuit ? ` · 亮${openSuit}` : ''} · ${points}点 · ${count}张`
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
  /**
   * 侧家（上家/下家）信息：名字、东、缺牌、点数、张数横排一行。
   * 侧边块本身很窄，文字按「向内」方向铺开（上家左对齐、下家右对齐），
   * 只占一行高度，不再四行竖着挤掉手牌空间。
   */
  private seatMetaHorizontal(
    name: string,
    dealer: boolean,
    shortage: NumberSuit | null,
    points: number,
    count: number,
    x: number,
    y: number,
    width: number,
    align: 'left' | 'right',
    open = false
  ) {
    const nameSize = this.u(10)
    const restSize = this.u(9)
    const openSuit = open ? this.openSuit() : null
    const restStr = `${shortage ? `缺${shortage}` : '—'}${openSuit ? `·亮${openSuit}` : ''} · ${points}点 · ${count}张`
    const nameW = Math.ceil(this.measureText(name, nameSize))
    const restW = Math.ceil(this.measureText(restStr, restSize))
    const gap = this.u(4)
    const badgeW = dealer ? this.u(14) : 0
    const total = nameW + gap + (dealer ? badgeW + gap : 0) + restW
    let sx = align === 'left' ? x : x + width - total

    this.content.addChild(
      makeText(name, {
        size: nameSize,
        color: COLORS.ivory,
        width: nameW + 2,
        height: this.u(16),
        x: Math.round(sx),
        y
      })
    )
    sx += nameW + gap

    if (dealer) {
      const badge = makePanel(badgeW, this.u(12), this.u(2), COLORS.brass)
      badge.pos(Math.round(sx), Math.round(y + this.u(1)))
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
      sx += badgeW + gap
    }

    this.content.addChild(
      makeText(restStr, {
        size: restSize,
        color: openSuit ? COLORS.brass : COLORS.mist,
        width: restW + 2,
        height: this.u(16),
        x: Math.round(sx),
        y: y + this.u(1)
      })
    )
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
    // 对家缩到 90%，牌与牌紧挨着（没有缝）
    const oppW = Math.max(18, Math.round(m.oppW * 0.9))
    const rowW = Math.max(13, tiles.length) * oppW
    const blockW = Math.max(this.u(180), rowW)
    const x = m.boardW / 2 - blockW / 2
    let y = this.u(4)

    this.seatMeta('对面', dealer, shortage, points, count, x, y, blockW, 'center', this.openSeat(2))
    if (this.is3D()) return
    y += this.u(18)

    const rack = player && player.melds.length ? this.meldRackHorizontal(player.melds, m.meldW) : null
    const rackW = rack ? rack.width + this.u(8) : 0
    // 亮牌时成牌张和手牌之间留一道缝
    const winGap = reveal && tiles.length > 1 ? this.u(10) : 0
    const handW = Math.max(0, tiles.length * oppW) + winGap
    const totalW = rackW + handW
    const startX = m.boardW / 2 - totalW / 2
    if (rack) {
      rack.pos(Math.round(startX), Math.round(y + Math.round(oppW * TILE_RATIO) - rack.height))
      this.content.addChild(rack)
    }
    let hx = startX + rackW
    const openSuit = this.openSeat(2) ? this.openSuit() : null
    for (let i = 0; i < tiles.length; i += 1) {
      if (i === tiles.length - 1) hx += winGap
      const face = reveal || (openSuit !== null && parseTile(tiles[i]).suit === openSuit)
      const tile = face
        ? new TileView(tiles[i], { width: oppW, marked: reveal && i === tiles.length - 1 })
        : new TileView('', { width: oppW, back: true })
      tile.pos(Math.round(hx), Math.round(y))
      this.content.addChild(tile)
      hx += oppW
    }

    if (this.tenpaiSeat === 2) {
      const tileH = Math.round(oppW * TILE_RATIO)
      this.drawListenBadge(startX + rackW, y + tileH + this.u(2))
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
    const sideGap = 0
    const slots = Math.max(2, tiles.length)
    // 亮牌时成牌张单独留一道缝
    const winGap = reveal && tiles.length > 1 ? this.u(10) : 0
    const handLen = slots * m.sideW + winGap
    const rack = player && player.melds.length ? this.meldRackVertical(player.melds, m.meldW, rotate) : null
    // 名字 / 点数 / 缺牌 / 张数横排一行，竖向只占 18px，侧边空间留给手牌
    const infoH = this.u(18)
    const blockH = infoH + handLen + (rack ? this.u(6) + rack.height : 0)
    const blockW = Math.max(this.u(30), colW)
    // 横屏左右两侧还有余量：把上家/下家的整块（手牌、副露、座位信息）再往两边推一点
    const sideOut = m.landscape ? this.u(48) : 0
    const rawX = m.landscape
      ? left
        ? m.ringX - blockW - this.u(6) - sideOut
        : m.ringX + m.ringW + this.u(6) + sideOut
      : left
        ? this.u(4)
        : m.boardW - this.u(4) - blockW
    const x = Math.max(this.u(2), Math.min(m.boardW - blockW - this.u(2), rawX))
    const y = m.boardH / 2 - blockH / 2

    this.seatMetaHorizontal(
      left ? '上家' : '下家',
      dealer,
      shortage,
      points,
      count,
      x,
      y,
      blockW,
      left ? 'left' : 'right',
      this.openSeat(left ? 3 : 1)
    )
    if (this.is3D()) return
    let cy = y + infoH
    const openSuit = this.openSeat(left ? 3 : 1) ? this.openSuit() : null
    for (let i = 0; i < tiles.length; i += 1) {
      if (i === tiles.length - 1) cy += winGap
      const face = reveal || (openSuit !== null && parseTile(tiles[i]).suit === openSuit)
      const tile = face
        ? new TileView(tiles[i], { width: m.sideW, rotate, stripAtBottom: true, marked: reveal && i === tiles.length - 1 })
        : new TileView('', { width: m.sideW, back: true, rotate, stripAtBottom: true })
      tile.pos(Math.round(x + blockW / 2), Math.round(cy + m.sideW / 2))
      this.content.addChild(tile)
      cy += m.sideW + sideGap
    }

    if (rack) {
      rack.pos(Math.round(x + blockW / 2 - rack.width / 2), Math.round(y + infoH + handLen + this.u(6)))
      this.content.addChild(rack)
    }

    const seat = left ? 3 : 1
    if (this.tenpaiSeat === seat) {
      const size = this.u(LISTEN_BADGE)
      const bx = left ? x + blockW / 2 + this.u(10) : x + blockW / 2 - size - this.u(10)
      this.drawListenBadge(bx, y + infoH + this.u(2))
    }
  }

  /* ------------------------------------------------------------------ *
   * 副露
   * ------------------------------------------------------------------ */

  private meldRackHorizontal(melds: Meld[], tileW: number): Laya.Sprite {
    const rack = new Laya.Sprite()
    const tileH = Math.round(tileW * TILE_FACE_RATIO)
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
      const dark = melds[g].kind === '暗杠'
      for (let i = 0; i < tiles.length; i += 1) {
        const hidden = dark && i === tiles.length - 1
        const tile = new TileView(hidden ? '' : tiles[i], { width: tileW, flat: true, back: hidden })
        tile.pos(1 + i * (tileW + meldGap), 2)
        group.addChild(tile)
      }
      x += groupW[g] + this.u(5)
    }
    return rack
  }

  private meldRackVertical(melds: Meld[], tileW: number, rotate: number): Laya.Sprite {
    const rack = new Laya.Sprite()
    const tileH = Math.round(tileW * TILE_FACE_RATIO)
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
      const dark = melds[g].kind === '暗杠'
      for (let i = 0; i < tiles.length; i += 1) {
        const hidden = dark && i === tiles.length - 1
        const tile = new TileView(hidden ? '' : tiles[i], { width: tileW, rotate, flat: true, back: hidden })
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
    // 成牌张单独留一道缝：接牌和自摸都把成的那一张和手牌分开，一眼看得出是哪只成的
    const winTileGap =
      hand.phase === 'over' && hand.winner?.seat === 0 && !!hand.winner.winTile && tiles.length > 1 ? this.u(16) : 0
    let handW = m.handW
    let handH = m.handH
    let handRowW = tiles.length * (handW + gap) - gap + winTileGap
    if (handRowW > m.boardW - this.u(16)) {
      handW = Math.floor((m.boardW - this.u(16) - (tiles.length - 1) * gap - winTileGap) / tiles.length)
      handH = Math.round(handW * TILE_RATIO)
      handRowW = tiles.length * (handW + gap) - gap + winTileGap
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
        marked: isMustPlay || (hand.phase === 'over' && i === tiles.length - 1),
        dim: myTurn && !canPlay
      })
      const tx = Math.round(startX + i * (handW + gap) + (i === tiles.length - 1 ? winTileGap : 0))
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

    if (this.tenpaiSeat === 0) {
      this.drawListenBadge(startX, y - this.u(LISTEN_BADGE) - this.u(3))
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
        : hand.phase === 'rob-kong'
          ? this.isMyTurn(hand) ? '可以抢杠：选 成 或 过' : `等${SEAT_NAMES[actor ?? 0]}抢杠`
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

    const exit = makeButton({
      width: this.u(52),
      height: this.u(18),
      label: '退出',
      fontSize: this.u(9),
      face: 'ghost',
      onClick: () => this.requestExit()
    })
    exit.pos(Math.round(px + (pillW - this.u(52)) / 2), Math.round(py + pillH + this.u(4)))
    this.content.addChild(exit)

    if (hand.threeToOneSeat !== null) {
      this.content.addChild(
        makeText(this.threeToOneLabel(), {
          size: this.u(9),
          color: COLORS.brass,
          align: 'left',
          width: pillW,
          height: this.u(14),
          x: px,
          y: py - this.u(14)
        })
      )
    }
  }

  /**
   * 3D 手牌：只铺一层透明的点击区，位置严格按牌的投影走，不画任何 2D 描边。
   * 交互改成两段式——第一下选中（3D 里那张牌抬起来），第二下才打出。
   */
  private renderHand3D() {
    const hand = this.hand
    this.handHitRects = []
    if (!hand || !this.three) return
    const tiles = this.myHandTiles()
    if (!tiles.length) return
    const myTurn = hand.phase === 'discard' && this.currentActor(hand) === 0
    // 轮次变了 / 选中的牌已经不在了 → 清掉选中态
    if (!myTurn || (this.selectedIndex >= 0 && tiles[this.selectedIndex] !== this.selectedTile)) {
      this.selectedIndex = -1
      this.selectedTile = null
    }
    const playable = new Set(playableDiscards(hand, 0))
    const forbidden = new Set(forbiddenDiscardsFor(hand, 0))
    const winPending =
      myTurn && !this.declinedWin && legalActions(hand, 0).some(action => action.type === 'win')

    for (const hit of this.three.selfHits) {
      if (!hit || hit.w <= 0 || hit.h <= 0) continue
      // 禁打（不属于缺门 / 大吊车禁张）与成牌待决时一律不接点击
      const canPlay = myTurn && playable.has(hit.tile) && !forbidden.has(hit.tile) && !winPending
      if (!canPlay) continue
      const view = new Laya.Sprite()
      view.size(Math.max(1, Math.round(hit.w)), Math.max(1, Math.round(hit.h)))
      view.pos(Math.round(hit.x - this.m.boardX), Math.round(hit.y - this.m.boardY))
      view.hitArea = new Laya.Rectangle(0, 0, view.width, view.height)
      view.mouseEnabled = true
      view.on(Laya.Event.CLICK, null, () => this.onHandTileClick(hit.index, hit.tile))
      this.handHitRects.push({ x: view.x, y: view.y, w: view.width, h: view.height })
      this.content.addChild(view)
    }
  }

  /** 第一下选中并抬起，第二下打出 */
  private onHandTileClick(index: number, tile: Tile) {
    if (this.suppressClick) {
      this.suppressClick = false
      return
    }
    if (this.selectedIndex === index && this.selectedTile === tile) {
      this.selectedIndex = -1
      this.selectedTile = null
      this.act({ type: 'discard', seat: 0, tile })
      return
    }
    this.selectedIndex = index
    this.selectedTile = tile
    this.render()
  }

  /** 把原本在中央面板的 成/杠/碰/过 收到操作条，避免挡牌河 */
  private appendDock3DActions(items: Array<Laya.Sprite | Laya.Text>, hand: HandState, myTurn: boolean) {
    if (this.phase !== 'playing' || hand.phase === 'over') return
    // 定缺：不受轮次限制，四家各自选各自的
    if (hand.phase === 'choose-shortage') {
      if (hand.players[0].shortage) return
      for (const suit of SHORTAGE_OPTIONS) {
        items.push(makeButton({
          width: this.u(40), height: this.u(26), label: `缺${suit}`, fontSize: this.u(11), face: 'chip',
          onClick: () => this.act({ type: 'chooseShortage', seat: 0, suit })
        }))
      }
      return
    }
    if (!myTurn) return
    const actions = legalActions(hand, 0)
    if (hand.phase === 'claim' || hand.phase === 'rob-kong') {
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
    }
    // 杠和成/打并列
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
        `自己${hand.dealerSeat === 0 ? ' 东' : ''}${me.shortage ? `  缺${me.shortage}` : ''}${hand.threeToOneSeat === 0 && hand.threeToOneSuit ? `  亮${hand.threeToOneSuit}` : ''}  ${playing ? this.seatPoints(0) : STARTING_POINTS}点  ${this.phase === 'dealing' ? this.dealtCounts[0] : hand.phase === 'over' ? this.myHandTiles().length : me.hand.length}张`,
        { size: this.u(10), color: COLORS.mist, width: this.u(185), height: this.u(16) }
      )
    )

    if (this.phase === 'dealing') {
      items.push(makeText(`发牌 ${this.dealProgress}/53`, { size: this.u(11), color: COLORS.brass, width: this.u(110), height: this.u(16) }))
    } else if (this.phase === 'playing' && hand.phase === 'choose-shortage' && !me.shortage) {
      items.push(makeText('定缺', { size: this.u(10), color: COLORS.mist, width: this.u(30), height: this.u(16) }))
    } else if (this.phase === 'playing' && hand.phase === 'draw' && myTurn) {
      items.push(
        makeButton({
          width: this.u(78),
          height: this.u(32),
          label: me.hand.length % 3 === 2 ? '出牌' : '摸牌',
          fontSize: this.u(14),
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
          width: this.u(52),
          height: this.u(26),
          label: '分享',
          fontSize: this.u(10),
          face: 'chip',
          onClick: () => this.shareScreenshot()
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
        ? hand.phase === 'rob-kong'
          ? '可以抢杠：选 成 或 过'
          : hasWin
            ? '可以成牌：选 成 或 打'
            : hasKong
              ? '可以杠，或点手牌打出'
              : shortageTiles(me).length
                ? '必须打缺门牌'
                : '点手牌打出'
        : hand.phase === 'rob-kong'
          ? `等${SEAT_NAMES[this.currentActor(hand) ?? 0]}抢杠…`
          : `${SEAT_NAMES[this.currentActor(hand) ?? 0]}在出牌…`
      items.push(makeText(status, { size: this.u(10), color: COLORS.mist, width: this.u(180), height: this.u(16) }))
      const warning = daLiaoCheWarning(hand, 0)
      if (warning) {
        items.push(makeText(warning, { size: this.u(9), color: COLORS.vermillion, width: this.u(210), height: this.u(14) }))
      }
    } else if (this.phase === 'rolling') {
      items.push(makeText('掷骰…', { size: this.u(11), color: COLORS.mist, width: this.u(60), height: this.u(16) }))
    }

    if (this.is3D()) this.appendDock3DActions(items, hand, myTurn)
    this.renderDockBar(items)
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
    const kongOpen = !!win?.score.points.items.some(item => item.name === '杠开')

    const side3D = this.is3D()
    const panelW = Math.round(
      side3D
        ? Math.min(m.boardW * 0.3, this.u(250))
        : m.landscape
          ? Math.min(m.boardW * 0.36, this.u(216))
          : Math.min(m.boardW * 0.56, this.u(300))
    )
    let px = side3D
      ? Math.round(m.boardW - panelW - this.u(12))
      : Math.round(m.boardW / 2 - panelW / 2)

    if (!win) {
      const panelH = this.u(110)
      const py = side3D ? Math.round(m.boardY + this.u(8)) : Math.round(m.boardH / 2 - panelH / 2)
      const panel = makePanel(panelW, panelH, this.u(14), 'rgba(8,30,24,0.66)', 'rgba(217,180,95,0.28)', 1)
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
    let used = 8 + 14 + 28 + 46 + 38 + 6
    if (bigWin) used += 14
    if (kongOpen) used += 14
    if (win.score.mozi.units > 0) used += 14
    used += 18
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

    const panel = makePanel(panelW, panelH, this.u(14), 'rgba(8,30,24,0.66)', 'rgba(217,180,95,0.28)', 1)
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
        width: this.u(34),
        height: this.u(18),
        x: px + this.u(70),
        y: y + this.u(3)
      })
    )
    // 大拿 / 清水 / 杠后赛花徽标跟在「自摸 / 接牌」右侧
    let badgeX = px + this.u(70) + this.u(40) + this.u(4)
    if (bigWin) {
      const badge = this.makeBadge('大拿', COLORS.vermillion, COLORS.ivory)
      badge.pos(badgeX, y + this.u(1))
      this.content.addChild(badge)
      badgeX += badge.width + this.u(4)
      if (hand.isFirstHand) {
        const qing = this.makeBadge('清水', COLORS.brass, COLORS.ink)
        qing.pos(badgeX, y + this.u(1))
        this.content.addChild(qing)
        badgeX += qing.width + this.u(4)
      }
    }
    if (kongOpen) {
      const kong = this.makeBadge('杠后赛花', COLORS.brass, COLORS.ink)
      kong.pos(badgeX, y + this.u(1))
      this.content.addChild(kong)
    }
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

    if (bigWin) {
      const reasons = win.score.bigWin.reasons.map(reason => reason.name).join(' + ')
      this.content.addChild(
        makeText(`大拿：${reasons}`, {
          size: this.u(9),
          color: COLORS.vermillion,
          width: panelW - this.u(24),
          height: this.u(14),
          x: px + this.u(13),
          y
        })
      )
      y += this.u(14)
    }

    // 成牌只要有摸子就一定亮出来（没摸子不占位置）
    if (win.score.mozi.units > 0) {
      const mz = win.score.mozi
      this.content.addChild(
        makeText(
          `摸子 ${mz.big} 大 + ${mz.small} 小${gameOver ? ` · ${mz.money} 元/家` : ''}`,
          {
            size: this.u(10),
            color: COLORS.brass,
            width: panelW - this.u(24),
            height: this.u(14),
            x: px + this.u(12),
            y
          }
        )
      )
      y += this.u(14)
    }

    // 本局没结束时只结算点数，不显示要付多少钱；点数付完（本局结束）才亮金额
    this.content.addChild(
      makeText(
        gameOver
          ? `${win.score.money.perOpponentTotal} 元/家 · 合计 ${win.score.money.total} 元`
          : '本局未结束 · 只结算点数',
        {
          size: this.u(10),
          color: gameOver ? COLORS.brass : COLORS.mist,
          width: panelW - this.u(24),
          height: this.u(16),
          x: px + this.u(12),
          y
        }
      )
    )
    y += this.u(18)

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

    // 牌型明细：一行按「名字+点」并列铺开，比每个牌型一行省尺寸，也看得出 52 点怎么来的
    const itemText = win.score.points.items
      .map(item => `${item.name}${item.points >= 0 ? '+' : ''}${item.points}`)
      .join(' · ')
    const subtotal = win.score.points.items.reduce((sum, item) => sum + item.points, 0)
    const summary = `${itemText}  ＝ 小计 ${subtotal} 点 × ${win.score.points.multiplier} = ${win.score.points.total} 点`
    const detail = makeText(summary, {
      size: this.u(9),
      color: COLORS.mist,
      width: panelW - this.u(26),
      height: this.u(40),
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
    dim.graphics.drawRect(0, 0, m.W, m.H, 'rgba(4,18,14,0.6)')
    this.overlay.addChild(dim)

    const panelW = Math.round(Math.min(m.W - this.u(40), this.u(320)))
    const panelH = Math.round(Math.min(m.H - this.u(40), this.u(286)))
    const px = Math.round((m.W - panelW) / 2)
    const py = Math.round((m.H - panelH) / 2)
    const panel = makePanel(panelW, panelH, this.u(16), 'rgba(9,34,27,0.86)', 'rgba(217,180,95,0.32)', 1)
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

    // 四局调圈：谁掷的骰、谁位置不动
    const circleH = summary.circle ? this.u(30) : 0
    if (summary.circle) {
      const circle = summary.circle
      this.overlay.addChild(
        makeText(`四局调圈 · ${SEAT_NAMES[circle.rollerSeat]}掷骰 ${circle.diceA}+${circle.diceB}=${circle.diceA + circle.diceB}`, {
          size: this.u(10),
          color: COLORS.brass,
          align: 'center',
          width: panelW,
          height: this.u(14),
          x: px,
          y: py + this.u(58)
        })
      )
      this.overlay.addChild(
        makeText(`${SEAT_NAMES[circle.fixedSeat]}位置不动，其余三家按顺时针换位`, {
          size: this.u(10),
          color: COLORS.mist,
          align: 'center',
          width: panelW,
          height: this.u(14),
          x: px,
          y: py + this.u(74)
        })
      )
    }

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
        y: py + this.u(62) + circleH
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
        y: py + this.u(62) + circleH
      })
    )

    for (let seat = 0; seat < 4; seat += 1) {
      const rowY = py + this.u(80) + circleH + seat * this.u(38)
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
      makeText('三家电脑陪你打 · 掷骰开牌 · 赢家坐东', {
        size: this.u(11),
        color: COLORS.mist,
        align: 'center',
        width: panelW,
        height: this.u(18),
        x: px,
        y: py + panelH * 0.56
      })
    )

    const resumable = !!loadSavedGame()?.board
    const button = makeButton({
      width: this.u(150),
      height: this.u(38),
      label: resumable ? '继续上局' : '掷骰子',
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

  /** 临时提示条：显示 2.6 秒后自动收掉 */
  private flash(text: string) {
    this.notice = text
    // 提示要马上出现：调用方不一定紧接着 render（比如分享失败后什么也不做）
    this.render()
    this.schedule(2600, () => {
      this.notice = null
      this.render()
    })
  }

  /** 动作落桌后的播报：成牌 > 杠 > 碰 > 打牌 */
  private announceAction(prev: HandState, next: HandState, action: RoundAction) {
    if (!prev.winner && next.winner) {
      voice.playWin({
        selfDraw: next.winner.selfDraw,
        afterKong: next.afterKong && next.winner.selfDraw,
        robKong: action.type === 'win' ? !!action.robKong : false,
        score: next.winner.score
      })
      return
    }
    if (action.type === 'discard') {
      voice.playDiscard(action.tile)
      return
    }
    if (action.type === 'kong') {
      voice.playId(action.kind === '暗杠' ? 'angang' : 'gang', 2)
      return
    }
    if (action.type === 'claim') {
      if (action.claim === '碰') voice.playId('peng', 1)
      else if (action.claim === '杠') voice.playId('gang', 2)
    }
  }

  private announceThreeToOne(prev: HandState | null, next: HandState) {
    const seat = next.threeToOneSeat
    if (seat === null) return
    if (prev && prev.threeToOneSeat === seat) return
    const alreadyListening = isTenpaiHand(next.players[seat]) ? '，已听牌' : ''
    this.flash(
      seat === 0
        ? `三打一 · 亮出${next.threeToOneSuit ?? '牌'}，其余手牌不亮${alreadyListening}`
        : `三打一 · ${SEAT_NAMES[seat]}亮${next.threeToOneSuit ?? '牌'}${alreadyListening}`
    )
    voice.playId('sandayi', 1)
  }

  /** 明牌家从「没听」变成「听牌」时喊一声；常驻的红色「听」由 render 画 */
  private announceTenpai(prev: HandState | null, next: HandState) {
    const seat = next.threeToOneSeat
    if (seat === null || next.phase === 'over') return
    if (!prev || prev.threeToOneSeat !== seat) return
    if (isTenpaiHand(prev.players[seat])) return
    if (!isTenpaiHand(next.players[seat])) return
    this.flash(seat === 0 ? '你听牌了' : `${SEAT_NAMES[seat]}听牌！`)
  }

  private clearTimers() {
    Laya.timer.clearAll(this)
    this.stopSpin()
    this.aiPending = false
    this.notice = null
  }

  private stopSpin() {
    if (this.spinTimer !== null) {
      clearInterval(this.spinTimer)
      this.spinTimer = null
    }
  }

  start() {
    this.clearTimers()
    voice.stop()
    this.declinedWin = false
    this.notice = null
    this.showStats = false
    this.showExit = false
    this.roundSummary = null
    this.roundStats = createHistory()
    this.aiPending = false
    this.actionLockUntil = 0
    // 退出时选了「保存」：从存档接着打，不能新建一局
    // （新建 = createMatch({ rollerSeat: 0 })，庄家会变回自己）
    if (!this.board) {
      const saved = loadSavedGame()
      if (saved && saved.board) {
        this.restoreGame(saved)
        if (this.phase === 'playing' || this.phase === 'round-over') {
          this.render()
          if (this.phase === 'playing') this.schedule(420, () => this.tick())
          return
        }
      }
    }
    this.rollAndDeal()
  }

  private rollAndDeal() {
    this.clearTimers()
    this.stopSpin()
    this.declinedWin = false
    this.notice = null
    this.aiPending = false
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
        this.announceThreeToOne(hand, current)
        this.persist()
        this.render()
        this.schedule(240 * this.pace(), () => this.tick())
      }
      return
    }

    const seat = this.currentActor(hand)
    if (seat === null) return
    if (!hand.players[seat].isAI && !(AUTO && seat === 0)) return
    // AI 先「想」1–2 秒再落动作；出牌后固定留 300ms 给上一张牌落地
    if (this.aiPending) return
    this.aiPending = true
    this.schedule(this.aiThinkDelay(), () => {
      this.aiPending = false
      const current = this.hand
      if (!current || this.phase !== 'playing' || this.showStats || this.showExit) return
      if (current.phase === 'over') return
      const who = this.currentActor(current)
      if (who === null) return
      if (!current.players[who].isAI && !(AUTO && who === 0)) return
      const action = chooseAIAction(current, who)
      if (!action) return
      let next: HandState
      try {
        next = applyAction(current, action)
      } catch {
        return
      }
      this.hand = next
      this.actionLockUntil = Date.now() + 300
      this.announceTenpai(current, next)
      this.announceAction(current, next, action)
      this.persist()
      this.render()
      this.schedule(300 * this.pace(), () => this.tick())
    })
  }

  /** AI 思考 1–2 秒 */
  private aiThinkDelay() {
    return (1000 + Math.random() * 1000) * this.pace()
  }

  private act(action: RoundAction, delay = 300) {
    const hand = this.hand
    if (!hand) return
    // 上一张牌落地后的 300ms 输入锁：这期间点什么都不响应
    if (Date.now() < this.actionLockUntil) return
    if (action.type !== 'discard') this.declinedWin = false
    this.selectedIndex = -1
    this.selectedTile = null
    let next: HandState
    try {
      next = applyAction(hand, action)
    } catch (error) {
      console.error('act failed', JSON.stringify(action), error)
      return
    }
    this.hand = next
    this.actionLockUntil = Date.now() + 300
    this.announceThreeToOne(hand, next)
    this.announceTenpai(hand, next)
    this.announceAction(hand, next, action)
    this.persist()
    this.render()
    this.schedule(Math.max(300, delay) * this.pace(), () => this.tick())
  }

  private closeHand() {
    const match = this.board
    const hand = this.hand
    if (!match || !hand || !match.current) return
    if (!hand.winner && hand.result === 'exhausted') voice.playId('liuju', 1)
    const settlement = settleHand(hand)
    this.updateHistory(settlement)
    const roundIndex = match.roundIndex
    const hands = match.hands + 1
    const roundMoney = match.money.map((value, seat) => value + (settlement?.moneyDelta[seat] ?? 0))
    const finalPoints = hand.players.map((player, seat) => player.points + (settlement?.pointDelta[seat] ?? 0))

    // 四局调圈：第 4、8…局结束时，由最后成牌的人掷骰子；点数指向的那家位置不动，
    // 其余三家按顺时针换位。单机里自己会被转回 0 号位，看起来是三家电脑换位置。
    const circleNeeded = !!settlement && settlement.gameOver && match.roundIndex % ROUNDS_PER_CIRCLE === 0
    const circleDice = circleNeeded
      ? { a: 1 + Math.floor(Math.random() * 6), b: 1 + Math.floor(Math.random() * 6) }
      : null
    const closed = endHand(
      { ...match, current: hand },
      circleDice ? { circleDiceSum: circleDice.a + circleDice.b } : { rotate: false }
    )
    this.board = closed

    if (settlement && settlement.gameOver) {
      const circle: CircleSummary | undefined =
        circleDice && settlement.winnerSeat >= 0
          ? {
              diceA: circleDice.a,
              diceB: circleDice.b,
              rollerSeat: settlement.winnerSeat,
              // 点数指向的那家（换座前看到的座位名）：换座时他家不动
              fixedSeat: seatFromDice(settlement.winnerSeat, circleDice.a + circleDice.b)
            }
          : undefined
      this.roundSummary = {
        roundIndex,
        hands,
        money: roundMoney,
        points: finalPoints,
        // 调圈前结账：累计按这一局坐的位置显示
        total: match.totalMoney.map((value, seat) => value + roundMoney[seat]),
        circle
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
    this.roundStats = createHistory()
    for (let seat = 0; seat < 4; seat += 1) {
      this.roundStats.seats[seat].money = saved.board.money?.[seat] ?? 0
    }
    this.roundStats.hands = saved.board.hands ?? 0
    const hand = saved.hand ?? saved.board.current ?? null
    if (hand) {
      // 旧存档没有三打一标记：按缺门补算一次，读档后也照样只翻开三家缺的那门
      const info = hand.threeToOneSeat == null || hand.threeToOneSuit == null ? threeToOneOf(hand) : null
      hand.threeToOneSeat = hand.threeToOneSeat ?? info?.seat ?? null
      hand.threeToOneSuit = hand.threeToOneSuit ?? info?.suit ?? null
    }
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
        this.roundStats.seats[seat].money += settlement.moneyDelta[seat] ?? 0
      }
      const win = this.hand?.winner
      if (win) {
        for (const stats of [this.history.seats[win.seat], this.roundStats.seats[win.seat]]) {
          stats.wins += 1
          stats.points += win.score.points.total
          stats.moziBig += win.score.mozi.big
          stats.moziSmall += win.score.mozi.small
        }
      }
    }
    this.history.hands += 1
    this.roundStats.hands += 1
    if (settlement?.gameOver) {
      this.history.rounds += 1
      this.roundStats.rounds += 1
    }
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

  /**
   * 截图分享：右上角分享图标、一把结束后的「分享」按钮都走这里。
   * 先把当前画面截成一张图，再丢进微信的「分享图片」弹窗。
   * 小程序本身的分享（右上角菜单里的发送给朋友 / 分享到朋友圈）另走 initShare，互不影响。
   */
  private shareScreenshot() {
    // 浏览器 / IDE 预览没有截图分享能力（?share=1 只是把图标画出来看版式）
    if (!isWechatMiniGame()) {
      this.flash('截图分享只在微信小游戏里可用')
      return
    }
    const path = this.captureScreenshot()
    if (!path) {
      this.flash(`截图失败：${this.shotError || '未知原因'}`)
      return
    }
    console.log('[share] 截图完成', path)
    // 微信「分享图片」弹窗：发送给朋友 / 收藏 / 下载
    const opened = shareImage(path, {
      onFail: reason => {
        if (isPrivacyError(reason)) {
          // 相册隐私权限没在 MP 后台声明：发图片、存相册都会被微信拒，代码无解。
          // 退一步用转发卡片（卡片图就是这张截图），不依赖隐私权限。
          console.warn('[share] 缺少相册隐私权限，改用转发卡片', reason)
          if (shareToFriend({ imageUrl: path })) {
            this.flash('微信还没开通「相册」隐私权限，先用转发卡片把这张截图发出去')
          } else {
            this.flash(`分享失败：${reason.slice(0, 60)}`)
          }
          return
        }
        this.offerSaveAlbum(path, reason)
      }
    })
    if (!opened) this.offerSaveAlbum(path, '这台微信没有「分享图片」接口')
  }

  /**
   * 微信的「分享图片」打不开时的退路：原生弹窗问一句，存到相册。
   * 相册权限被拒时 saveImageToAlbum 会顺手拉起设置页。
   */
  private offerSaveAlbum(path: string, reason: string) {
    console.warn('[share] 分享图片弹窗失败，改存相册', reason)
    const wx: any = (globalThis as any).wx
    const save = () =>
      saveImageToAlbum(path, {
        onSaved: () => this.flash('已经存到相册了'),
        onFail: why => this.flash(`存相册失败：${why.slice(0, 40)}`)
      })
    if (!wx?.showModal) {
      save()
      return
    }
    wx.showModal({
      title: '分享图片打不开',
      content: `${reason}。要把这张截图存到相册吗？`,
      confirmText: '存相册',
      cancelText: '算了',
      success: (res: any) => {
        if (res?.confirm) save()
      }
    })
  }

  /** 上一次截图失败的原因：直接闪到界面上，真机调试时一眼看出卡在哪一步 */
  private shotError = ''

  /**
   * 屏幕画布的后备像素尺寸（canvas.width/height）。
   * 注意不是 Laya.Browser.clientWidth（那是 CSS 尺寸）：引擎的 gl.viewport 用的是画布后备尺寸，
   * 高 DPI 手机上两者差 2~3 倍，用 CSS 尺寸建 RenderTexture 会只截到屏幕左下角一块。
   */
  private screenSize(): { width: number; height: number } {
    const main = this.mainCanvas()
    if (main?.width && main?.height) return { width: main.width, height: main.height }
    const wx: any = (globalThis as any).wx
    const dpr = wx?.getSystemInfoSync?.().pixelRatio || 1
    const width = Math.round((Laya.Browser.clientWidth || Laya.stage.width) * dpr)
    const height = Math.round((Laya.Browser.clientHeight || Laya.stage.height) * dpr)
    return { width, height }
  }

  /** 微信的主画布（渲染这张牌桌的那块屏幕画布） */
  private mainCanvas(): any {
    const g: any = globalThis as any
    const candidates = [
      (Laya.Browser as any).mainCanvas?.source,
      g.GameGlobal?.canvas,
      g.canvas
    ]
    for (const canvas of candidates) {
      if (canvas && typeof canvas.toTempFilePathSync === 'function') return canvas
    }
    return null
  }

  /**
   * 把当前画面截成一张本地临时图，返回微信能用的路径。
   *
   * 小游戏真机上 `Laya.stage.drawToCanvas` 要经过引擎的 ImageData 中转，适配库那层在小游戏里
   * 不一定可用（真机上表现为点了没反应），所以这里按成功率排三条路：
   * 1. 主画布 canvas.toTempFilePathSync —— 微信自己的截图接口，不经过 Laya；
   * 2. RenderTexture 读像素 → 自己用 ctx.createImageData 拼图 → 导出（不依赖全局 ImageData）；
   * 3. Laya 的 drawToCanvas —— 浏览器 / IDE 预览走这条。
   */
  private captureScreenshot(): string | null {
    this.shotError = ''

    // 1) RenderTexture 读像素 → 自己拼 2D 图。
    //    RT 尺寸必须等于画布后备像素（screenSize），否则 gl.viewport 比 RT 大，
    //    只会截到屏幕左下角一块（真机上就是这样翻车的）。
    const viaRt = this.captureWithRenderTexture()
    if (viaRt) return viaRt

    // 2) 主画布 canvas.toTempFilePathSync —— 微信自己的截图接口
    const main = this.mainCanvas()
    if (main) {
      try {
        const destWidth = 1000
        const width = main.width || 0
        const height = main.height || 0
        if (width && height) {
          const path = main.toTempFilePathSync({
            x: 0,
            y: 0,
            width,
            height,
            destWidth,
            destHeight: Math.round((destWidth * height) / width)
          })
          // WebGL 主画布偶尔导出全黑/空白：文件特别小就当没截到
          if (path && !this.looksBlank(path)) return path
          this.shotError = '主画布导出的是空白图'
        }
      } catch (error) {
        this.shotError = '主画布导出失败'
        console.warn('[share] 主画布截图失败', error)
      }
    }

    // 3) Laya 自带 drawToCanvas（浏览器 / IDE 预览走这条）
    try {
      const destWidth = 1000
      const width = Laya.Browser.clientWidth || Laya.stage.width
      const height = Laya.Browser.clientHeight || Laya.stage.height
      const shot: any = (Laya.stage as any).drawToCanvas(width, height, 0, 0)
      const canvas: any = shot?.source ?? shot?.getCanvas?.() ?? shot
      if (canvas && typeof canvas.toTempFilePathSync === 'function') {
        const shotWidth = canvas.width || width
        const shotHeight = canvas.height || height
        const path = canvas.toTempFilePathSync({
          x: 0,
          y: 0,
          width: shotWidth,
          height: shotHeight,
          destWidth,
          destHeight: Math.round((destWidth * shotHeight) / shotWidth)
        })
        if (path) return path
        this.shotError = 'drawToCanvas 导出为空'
      }
    } catch (error) {
      this.shotError = this.shotError || 'drawToCanvas 失败'
      console.warn('[share] drawToCanvas 截图失败', error)
    }

    return null
  }

  /** 采样一批像素，全是同一个颜色就说明这一帧是空的 */
  private pixelsAreBlank(pixels: Uint8Array): boolean {
    if (pixels.length < 4) return true
    const pixelsCount = Math.floor(pixels.length / 4)
    const step = Math.max(1, Math.floor(pixelsCount / 512))
    let minR = 255
    let maxR = 0
    let minG = 255
    let maxG = 0
    let minB = 255
    let maxB = 0
    for (let i = 0; i < pixelsCount; i += step) {
      const base = i * 4
      const r = pixels[base]
      const g = pixels[base + 1]
      const b = pixels[base + 2]
      if (r < minR) minR = r
      if (r > maxR) maxR = r
      if (g < minG) minG = g
      if (g > maxG) maxG = g
      if (b < minB) minB = b
      if (b > maxB) maxB = b
    }
    return maxR - minR < 4 && maxG - minG < 4 && maxB - minB < 4
  }

  /** 临时文件是不是小得可疑（空白截图通常只有几 KB） */
  private looksBlank(path: string): boolean {
    try {
      const wx: any = (globalThis as any).wx
      const size = wx?.getFileSystemManager?.()?.statSync?.(path)?.size ?? 0
      return size > 0 && size < 20000
    } catch {
      return false
    }
  }

  /** 用 RenderTexture 读像素，再用 2D canvas 拼回来导出（小游戏里没有全局 ImageData） */
  private captureWithRenderTexture(): string | null {
    try {
      const { width, height } = this.screenSize()
      if (!width || !height) {
        this.shotError = this.shotError || '画布尺寸是 0'
        return null
      }
      const wx: any = (globalThis as any).wx
      if (!wx?.createCanvas) {
        this.shotError = '没有离屏画布接口'
        return null
      }
      const rt: any = (Laya.stage as any).drawToRenderTexture2D(width, height, 0, 0)
      const pixels = rt?.getData?.(0, 0, width, height) as Uint8Array | null
      if (!pixels || !pixels.length) {
        rt?.destroy?.()
        this.shotError = '读不到像素'
        return null
      }
      if (this.pixelsAreBlank(pixels)) {
        rt?.destroy?.()
        this.shotError = '离屏渲染出来是空白图'
        return null
      }
      const canvas = wx.createCanvas()
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      const image = ctx.createImageData(width, height)
      // WebGL 的 readPixels 是从下往上，逐行倒着拷
      const rowBytes = width * 4
      for (let y = 0; y < height; y += 1) {
        const src = (height - 1 - y) * rowBytes
        image.data.set(pixels.subarray(src, src + rowBytes), y * rowBytes)
      }
      ctx.putImageData(image, 0, 0)
      rt?.destroy?.()
      const destWidth = 1000
      const path = canvas.toTempFilePathSync?.({
        x: 0,
        y: 0,
        width,
        height,
        destWidth,
        destHeight: Math.round((destWidth * height) / width)
      })
      if (!path) {
        this.shotError = '离屏画布导出为空'
        return null
      }
      return path
    } catch (error) {
      this.shotError = this.shotError || '离屏渲染截图失败'
      console.warn('[share] RenderTexture 截图失败', error)
      return null
    }
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

  /** 右上角语音开关：喇叭图标，静音时喇叭上压一道叉 */
  private renderVoiceIcon() {
    if (this.phase !== 'idle' && this.phase !== 'playing') return
    if (this.showStats || this.showExit) return
    const size = this.u(30)
    if (size < 18) return
    const on = voice.enabled
    const icon = new Laya.Sprite()
    icon.size(size, size)
    const r = Math.max(4, Math.round(size * 0.24))
    icon.graphics.drawRoundRect(
      0,
      0,
      size,
      size,
      r,
      r,
      r,
      r,
      on ? 'rgba(9,33,27,0.9)' : 'rgba(28,20,12,0.9)',
      on ? 'rgba(217,180,95,0.55)' : 'rgba(201,120,86,0.6)',
      1
    )
    drawSpeakerGlyph(icon.graphics, size, on ? COLORS.brass : COLORS.warn, !on, COLORS.warn)
    icon.hitArea = new Laya.Rectangle(0, 0, size, size)
    icon.mouseEnabled = true
    icon.on(Laya.Event.CLICK, null, () => {
      voice.toggle()
      this.render()
    })
    icon.pos(this.m.boardW - size - this.u(8), this.u(8))
    this.content.addChild(icon)
  }

  /**
   * 右上角分享入口（紧挨在语音开关左边）。
   * 默认只在微信小游戏里画：浏览器 / IDE 预览没有转发能力，按钮点了也没用；
   * 想看版式就在地址栏加 ?share=1。
   */
  private renderShareIcon() {
    if (this.phase !== 'idle' && this.phase !== 'playing') return
    if (this.showStats || this.showExit) return
    if (!isWechatMiniGame() && !this.sharePreview) return
    const size = this.u(30)
    if (size < 18) return
    const icon = new Laya.Sprite()
    icon.size(size, size)
    const r = Math.max(4, Math.round(size * 0.24))
    icon.graphics.drawRoundRect(0, 0, size, size, r, r, r, r, 'rgba(9,33,27,0.9)', 'rgba(217,180,95,0.55)', 1)
    drawShareGlyph(icon.graphics, size, COLORS.brass)
    icon.hitArea = new Laya.Rectangle(0, 0, size, size)
    icon.mouseEnabled = true
    icon.on(Laya.Event.CLICK, null, () => this.shareScreenshot())
    icon.pos(this.m.boardW - size * 2 - this.u(14), this.u(8))
    this.content.addChild(icon)
  }

  /** 转发卡片标题：跟着当前局面变，比一句固定的游戏名更有说服力 */
  private shareTitle(): string {
    const hand = this.hand
    const match = this.board
    if (this.phase === 'playing' && hand) {
      const win = hand.winner
      if (hand.phase === 'over' && win) {
        if (win.seat === 0) {
          return win.score?.bigWin?.isBigWin
            ? '我刚打出一手大拿，来倒子麻将试试？'
            : '我刚成了一把倒子麻将，来打一把？'
        }
        return `${SEAT_NAMES[win.seat]}成牌了，来打一把倒子麻将？`
      }
      const roundIndex = match?.roundIndex ?? 1
      const handIndex = (match?.hands ?? 0) + 1
      return `倒子麻将第 ${roundIndex} 局第 ${handIndex} 把，来打一把？`
    }
    if (this.phase === 'round-over') return '一局倒子麻将刚打完，来打一把？'
    return DEFAULT_SHARE_TITLE
  }

  private renderOverlays() {
    this.renderNotice()
    if (this.showStats) this.renderStatsPanel()
    if (this.showExit) this.renderExitPanel()
  }

  /** 顶部临时提示（三打一翻牌等），压在其他弹窗下面 */
  private renderNotice() {
    if (!this.notice) return
    const m = this.m
    // 提示条允许折两行：微信的 errMsg 很长（showShareImageMenu:fail …），单行会被裁掉
    const w = Math.min(m.W * 0.86, this.u(420))
    const h = this.u(40)
    const panel = makePanel(w, h, this.u(10), 'rgba(9,34,27,0.94)', 'rgba(217,180,95,0.8)', 1.5)
    panel.pos(Math.round((m.W - w) / 2), this.u(10))
    panel.mouseEnabled = false
    const text = makeText(this.notice, {
      size: this.u(10),
      color: COLORS.ivory,
      align: 'center',
      valign: 'middle',
      width: w - this.u(16),
      height: h - this.u(6)
    })
    text.wordWrap = true
    text.x = this.u(8)
    text.y = this.u(3)
    panel.addChild(text)
    this.overlay.addChild(panel)
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
      makeText('战绩', {
        size: this.u(20),
        color: COLORS.brass,
        bold: true,
        font: FONT_SERIF,
        align: 'center',
        width: panelW,
        height: this.u(30),
        x: px,
        y: py + this.u(10)
      })
    )
    // 构建批次放右上角：真机/体验版是不是新包，打开战绩就能核对
    this.overlay.addChild(
      makeText(`构建 ${BUILD_TAG}`, {
        size: this.u(9),
        color: COLORS.mist,
        align: 'right',
        width: this.u(120),
        height: this.u(14),
        x: px + panelW - this.u(128),
        y: py + this.u(16)
      })
    )

    // tab：本局 / 累计
    const tabW = this.u(88)
    const tabH = this.u(26)
    const tabGap = this.u(8)
    const tabY = py + this.u(42)
    const tabs: Array<{ key: 'round' | 'total'; label: string }> = [
      { key: 'round', label: '本局' },
      { key: 'total', label: '累计' }
    ]
    tabs.forEach((tab, index) => {
      const selected = this.statsTab === tab.key
      const button = makeButton({
        width: tabW,
        height: tabH,
        label: tab.label,
        fontSize: this.u(12),
        face: selected ? 'tile' : 'chip',
        onClick: () => {
          this.statsTab = tab.key
          this.render()
        }
      })
      button.pos(
        Math.round(px + panelW / 2 - tabW - tabGap / 2 + index * (tabW + tabGap)),
        Math.round(tabY)
      )
      this.overlay.addChild(button)
    })

    const isRound = this.statsTab === 'round'
    const data = isRound ? this.roundStats : this.history
    const subtitle = isRound
      ? `第 ${this.board?.roundIndex ?? 1} 局 · 本局 ${this.roundStats.hands} 把`
      : `累计 ${this.history.rounds} 局 · ${this.history.hands} 把`
    this.overlay.addChild(
      makeText(subtitle, {
        size: this.u(11),
        color: COLORS.mist,
        align: 'center',
        width: panelW,
        height: this.u(16),
        x: px,
        y: py + this.u(72)
      })
    )

    const rowH = Math.max(this.u(38), Math.min(this.u(52), Math.floor((panelH - this.u(150)) / 4)))
    let y = py + this.u(94)
    for (let seat = 0; seat < 4; seat += 1) {
      const stats = data.seats[seat]
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
    voice.stop()
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
