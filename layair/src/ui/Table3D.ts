import type { HandState } from '../game/game'
import type { Tile } from '../game/score'
import { wallVisualOf } from '../game/game'
import { meldTiles, tileOrder } from '../game/score'
import { COLORS, HONOR_COLOR, SUIT_COLOR } from './theme'

/** 3D 手牌在屏幕上的可点击区域（相对牌桌 2D 根节点） */
export interface TileHit {
  tile: Tile
  index: number
  x: number
  y: number
  w: number
  h: number
  drawn: boolean
}

export interface LastMark {
  x: number
  y: number
  w: number
  h: number
}

const TILE_W = 54
const TILE_H = 78
const TILE_T = 26
/** 牌背玉绿：比桌面亮很多，扣着的牌从深绿桌面上跳出来 */
const TILE_BACK = '#4CAF87'
const TABLE_W = 1280
/** 桌面进深：牌墙是平躺的真牌（进深一张牌高 86），桌面太浅左右两条墙就塞不下 */
const TABLE_D = 1080
/**
 * 手牌离桌沿的留白：四家统一一张牌厚（TILE_T）。
 * 牌是立着的，沿「朝向桌心」那个轴的厚度就是 TILE_T，
 * 所以牌体中心 = 桌沿 - 留白 - TILE_T / 2。
 */
const HAND_EDGE_GAP = TILE_T
const HAND_Z_SELF = 380
const HAND_Z_OPP = -380
const HAND_X_SIDE = TABLE_W / 2 - HAND_EDGE_GAP - TILE_T / 2
/**
 * 牌墙：一墩就是一张平躺的牌，和手里的是同一个模型、同一套尺寸；
 * 不再单独做一套「又细又小」的牌墙（那套比手牌小一半，看着不像牌）。
 */
const STACKS = 17
/** 牌墙也按牌宽紧挨着排；整圈长度由 17 墩决定 */
const WALL_STEP = TILE_W
const WALL_LEN = TILE_W
const WALL_SPAN = STACKS * WALL_STEP
/** 牌墙 / 副露 / 牌河的摆放线（离桌心的距离），由外向内依次是 手牌 → 牌墙 → 副露 → 牌河 */
const WALL_Z = WALL_SPAN / 2
const WALL_X = WALL_SPAN / 2
const WALL_Z_SELF = 300
const MELD_Z = 315
const MELD_X = 315
const DISCARD_Z = 195
const DISCARD_X = 195

function hexColor(hex: string, alpha = 1): Laya.Color {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16) / 255
  const g = parseInt(value.slice(2, 4), 16) / 255
  const b = parseInt(value.slice(4, 6), 16) / 255
  return new Laya.Color(r, g, b, alpha)
}

/** 收集场景里所有平行光（场景文件自带的灯，调亮度用） */
function scene_getLights(root: Laya.Node): Laya.DirectionLightCom[] {
  const out: Laya.DirectionLightCom[] = []
  const walk = (node: Laya.Node) => {
    const comp = (node as unknown as Laya.Sprite3D).getComponent?.(Laya.DirectionLightCom)
    if (comp) out.push(comp)
    for (let i = 0; i < node.numChildren; i += 1) walk(node.getChildAt(i))
  }
  walk(root)
  return out
}

/**
 * 固定相机 3D 牌桌。
 *
 * 相机在本家后上方，牌桌/墙/手牌/弃牌/骰子全是 3D 网格；
 * 渲染到 RenderTexture，再由 2D 根节点铺到底层，所以：
 * - 竖屏时可以跟 2D UI 一起旋转 90°；
 * - 按钮、文字和手牌点击区域仍然是平面的；
 * - 手牌点击区域由 3D 世界坐标投影回 2D 得到。
 */
export class Table3D {
  readonly scene: Laya.Scene3D
  readonly camera: Laya.Camera
  readonly texture: Laya.Texture
  readonly renderTexture: Laya.RenderTexture
  readonly texW: number
  readonly texH: number
  readonly viewW: number
  readonly viewH: number

  selfHits: TileHit[] = []
  lastMark: LastMark | null = null

  private tableRoot: Laya.Sprite3D
  private dynamicRoot: Laya.Sprite3D
  private diceRoot: Laya.Sprite3D | null = null
  private faceCache = new Map<string, Laya.Texture2D>()
  private roundedCache = new Map<string, Laya.Mesh>()
  private bodyCache = new Map<string, Laya.BlinnPhongMaterial>()
  private worldW: number
  private worldH: number

  constructor(viewW: number, viewH: number) {
    this.viewW = viewW
    this.viewH = viewH
    const scene = Laya.stage.getChildByName('Scene3D') as Laya.Scene3D
    const camera = scene?.getChildByName('Main Camera') as Laya.Camera
    if (!scene || !camera) throw new Error('Scene3D / Main Camera 未加载')

    this.scene = scene
    this.scene.mouseEnabled = false
    this.scene.mouseThrough = true
    this.camera = camera
    this.camera.cullingMask = 0xffffffff
    this.camera.nearPlane = 1
    // 固定相机稍收窄，保证自己的手牌清楚，同时整桌和四家牌河都在画面内。
    this.camera.farPlane = 16000
    this.camera.fieldOfView = 38
    this.camera.transform.position = new Laya.Vector3(0, 1260, 1380)
    this.camera.transform.rotationEuler = new Laya.Vector3(-42, 0, 0)

    this.tableRoot = new Laya.Sprite3D()
    this.dynamicRoot = new Laya.Sprite3D()
    scene.addChild(this.tableRoot)
    scene.addChild(this.dynamicRoot)

    const ratio = viewH / Math.max(1, viewW)
    this.texW = Math.min(1440, Math.max(960, Math.round(viewW * 0.9)))
    this.texH = Math.max(420, Math.round(this.texW * ratio))
    this.worldW = this.texW
    this.worldH = this.texH
    this.renderTexture = new Laya.RenderTexture(
      this.texW,
      this.texH,
      Laya.RenderTargetFormat.R8G8B8A8,
      Laya.RenderTargetFormat.DEPTH_16,
      false,
      0,
      false,
      true
    )
    this.camera.renderTarget = this.renderTexture
    this.camera.viewport = new Laya.Viewport(0, 0, this.texW, this.texH)
    this.texture = new Laya.Texture(this.renderTexture)

    this.buildTable()
  }

  /** 相机始终在本家后上方，固定视角；世界尺寸不随窗口拉伸 */
  private buildTable() {
    this.tableRoot.destroyChildren()

    // 整体提亮：场景自带的环境光偏暗（0.42,0.46,0.53），牌和桌面都发黑
    this.scene.ambientColor = new Laya.Color(0.72, 0.76, 0.78)
    scene_getLights(this.scene).forEach(light => {
      light.intensity = 1.35
    })

    // 桌布 + 四边木框
    this.addBox(TABLE_W, 26, TABLE_D, COLORS.table, 0, -13, 0, this.tableRoot)
    this.addBox(TABLE_W + 100, 16, 70, COLORS.woodDark, 0, -4, -TABLE_D / 2 - 28, this.tableRoot)
    this.addBox(TABLE_W + 100, 16, 70, COLORS.woodDark, 0, -4, TABLE_D / 2 + 28, this.tableRoot)
    this.addBox(70, 16, TABLE_D + 100, COLORS.woodDark, -TABLE_W / 2 - 28, -4, 0, this.tableRoot)
    this.addBox(70, 16, TABLE_D + 100, COLORS.woodDark, TABLE_W / 2 + 28, -4, 0, this.tableRoot)
    this.addBox(TABLE_W + 120, 10, 32, COLORS.brassDim, 0, -2, -TABLE_D / 2 - 62, this.tableRoot)
    this.addBox(TABLE_W + 120, 10, 32, COLORS.brassDim, 0, -2, TABLE_D / 2 + 62, this.tableRoot)
  }

  /** 圆角长方体网格：六个面都做圆角，牌摸起来不是刀切豆腐 */
  private roundedMesh(w: number, h: number, d: number, radius: number): Laya.Mesh {
    const r = Math.max(0.2, Math.min(radius, Math.min(w, h, d) / 2 - 0.01))
    const key = `${w.toFixed(1)}x${h.toFixed(1)}x${d.toFixed(1)}x${r.toFixed(1)}`
    const cached = this.roundedCache.get(key)
    if (cached) return cached

    const seg = 4
    const halfX = w / 2
    const halfY = h / 2
    const halfZ = d / 2
    const coreX = Math.max(0, halfX - r)
    const coreY = Math.max(0, halfY - r)
    const coreZ = Math.max(0, halfZ - r)
    const verts: number[] = []
    const idx: number[] = []

    // t × b = n，保证从外面看是逆时针
    const faces: Array<{
      n: [number, number, number]
      t: [number, number, number]
      b: [number, number, number]
      halfN: number
      halfT: number
      halfB: number
    }> = [
      { n: [0, 0, 1], t: [1, 0, 0], b: [0, 1, 0], halfN: halfZ, halfT: halfX, halfB: halfY },
      { n: [0, 0, -1], t: [-1, 0, 0], b: [0, 1, 0], halfN: halfZ, halfT: halfX, halfB: halfY },
      { n: [1, 0, 0], t: [0, 0, -1], b: [0, 1, 0], halfN: halfX, halfT: halfZ, halfB: halfY },
      { n: [-1, 0, 0], t: [0, 0, 1], b: [0, 1, 0], halfN: halfX, halfT: halfZ, halfB: halfY },
      { n: [0, 1, 0], t: [1, 0, 0], b: [0, 0, -1], halfN: halfY, halfT: halfX, halfB: halfZ },
      { n: [0, -1, 0], t: [1, 0, 0], b: [0, 0, 1], halfN: halfY, halfT: halfX, halfB: halfZ }
    ]

    for (const face of faces) {
      const base = verts.length / 8
      for (let j = 0; j <= seg; j += 1) {
        for (let i = 0; i <= seg; i += 1) {
          const u = (i / seg) * 2 - 1
          const v = (j / seg) * 2 - 1
          const x = face.n[0] * face.halfN + face.t[0] * u * face.halfT + face.b[0] * v * face.halfB
          const y = face.n[1] * face.halfN + face.t[1] * u * face.halfT + face.b[1] * v * face.halfB
          const z = face.n[2] * face.halfN + face.t[2] * u * face.halfT + face.b[2] * v * face.halfB
          const cx = Math.max(-coreX, Math.min(coreX, x))
          const cy = Math.max(-coreY, Math.min(coreY, y))
          const cz = Math.max(-coreZ, Math.min(coreZ, z))
          let dx = x - cx
          let dy = y - cy
          let dz = z - cz
          let len = Math.sqrt(dx * dx + dy * dy + dz * dz)
          if (len < 0.00001) {
            dx = face.n[0]
            dy = face.n[1]
            dz = face.n[2]
          } else {
            dx /= len
            dy /= len
            dz /= len
          }
          verts.push(cx + dx * r, cy + dy * r, cz + dz * r, dx, dy, dz, 1 - i / seg, 1 - j / seg)
        }
      }
      for (let j = 0; j < seg; j += 1) {
        for (let i = 0; i < seg; i += 1) {
          const a = base + j * (seg + 1) + i
          const b = a + 1
          const c = a + seg + 2
          const d = a + seg + 1
          idx.push(a, b, c, a, c, d)
        }
      }
    }

    const declaration = Laya.VertexMesh.getVertexDeclaration('POSITION,NORMAL,UV')
    const mesh = Laya.PrimitiveMesh._createMesh(declaration, new Float32Array(verts), new Uint16Array(idx))
    mesh.calculateBounds()
    this.roundedCache.set(key, mesh)
    return mesh
  }

  private addRounded(
    w: number,
    h: number,
    d: number,
    radius: number,
    material: Laya.Material,
    x: number,
    y: number,
    z: number,
    parent: Laya.Sprite3D,
    rotX = 0,
    rotY = 0
  ): Laya.MeshSprite3D {
    const node = new Laya.MeshSprite3D(this.roundedMesh(w, h, d, radius))
    node.meshRenderer.sharedMaterial = material
    node.transform.position = new Laya.Vector3(x, y, z)
    node.transform.rotationEuler = new Laya.Vector3(rotX, rotY, 0)
    parent.addChild(node)
    return node
  }

  private addBox(
    w: number,
    h: number,
    d: number,
    color: string,
    x: number,
    y: number,
    z: number,
    parent: Laya.Sprite3D
  ): Laya.MeshSprite3D {
    const box = new Laya.MeshSprite3D(Laya.PrimitiveMesh.createBox(w, h, d))
    box.transform.position = new Laya.Vector3(x, y, z)
    box.meshRenderer.sharedMaterial = this.bodyMaterial(color)
    parent.addChild(box)
    return box
  }

  private bodyMaterial(color: string): Laya.BlinnPhongMaterial {
    let mat = this.bodyCache.get(color)
    if (mat) return mat
    mat = new Laya.BlinnPhongMaterial()
    mat.albedoColor = hexColor(color)
    mat.albedoIntensity = 1.15
    this.bodyCache.set(color, mat)
    return mat
  }

  private faceMaterial(tex: Laya.Texture2D): Laya.UnlitMaterial {
    const mat = new Laya.UnlitMaterial()
    mat.albedoTexture = tex
    return mat
  }

  /** 牌面贴图：站立牌和平躺牌共用同一张（同一张牌只有一种牌面） */
  private faceTexture(tile: Tile): Laya.Texture2D {
    const key = tile
    const cached = this.faceCache.get(key)
    if (cached) return cached

    const w = 128
    const h = 176
    const hc = new Laya.HTMLCanvas(true)
    hc.size(w, h)
    const ctx = hc.context
    ctx.clearRect(0, 0, w, h)
    // 牌面就是一张干净的白纸：绿背已经由牌体那 30% 的绿长方体提供了，
    // 贴图里再画一条绿顶带，从相机俯视时会叠出「两种绿」。
    ctx.fillStyle = '#F2E7CE'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#F7EEDA'
    ctx.fillRect(3, 3, w - 6, h - 6)

    // 不再画黑框：牌与牌之间靠 3D 间隙和圆角分隔
    ctx.strokeStyle = 'rgba(143,120,82,0.32)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(5.5, 5.5, w - 11, h - 11)

    const honor = tile.length === 1 && HONOR_COLOR[tile] !== undefined
    const suit = honor ? '字' : tile.charAt(1)
    const color = honor ? HONOR_COLOR[tile] : SUIT_COLOR[suit] ?? COLORS.ink
    const areaTop = 10
    const areaH = h - areaTop - 10
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = color
    if (honor) {
      ctx.font = 'bold 76px "Songti SC", "STSong", serif'
      ctx.fillText(tile, w / 2, areaTop + areaH * 0.52)
    } else {
      ctx.font = 'bold 70px "Songti SC", "STSong", serif'
      ctx.fillText(tile.charAt(0), w / 2, areaTop + areaH * 0.36)
      ctx.font = 'bold 34px "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.fillText(suit, w / 2, areaTop + areaH * 0.75)
    }

    const tex = new Laya.Texture2D(w, h, Laya.TextureFormat.R8G8B8A8, false, false, true, false)
    tex.setImageData(hc.source, false, false)
    this.faceCache.set(key, tex)
    return tex
  }

  /**
   * 一张牌：整只是同一个外形（牌宽 × 牌高 × 牌厚），由两段拼成——
   * 厚度方向靠**背面 30%** 是玉绿（牌背），靠**正面 70%** 是象牙白（牌身，正面贴牌面）。
   *
   * 所以同一张牌站在不同位置，看到的东西不一样：
   * - 朝向自己的牌：看到白色牌面；
   * - 别人家的牌：看到绿色牌背，牌顶上是一条绿 + 一条白。
   *
   * 三种摆法都走这一个函数，只是整组绕 X 轴翻倒，保证「绿背在背面、白身在正面」不变：
   * - stand     立着（手牌）
   * - flatUp    平躺、牌面朝上（牌河 / 副露）
   * - flatDown  平躺、牌背朝上（牌墙）
   *
   * 注意：牌面贴图里不要再画绿顶带——绿背已经由牌体那 30% 提供了，
   * 贴图上再画一条绿，手牌顶上就会叠出「两种绿」。
   */
  private addTileBody(
    tile: Tile | null,
    x: number,
    y: number,
    z: number,
    parent: Laya.Sprite3D,
    mode: 'stand' | 'flatUp' | 'flatDown',
    rotY = 0
  ): Laya.Sprite3D {
    // 外层节点只负责水平转向（左右两条牌墙要转 90°），内层负责翻倒。
    // 分成两个节点做，旋转顺序才是确定的：先翻倒，再水平转，不会受欧拉角顺序影响。
    const group = new Laya.Sprite3D()
    group.transform.position = new Laya.Vector3(x, y, z)
    group.transform.rotationEuler = new Laya.Vector3(0, rotY, 0)
    parent.addChild(group)

    const rotX = mode === 'stand' ? 0 : mode === 'flatUp' ? -90 : 90
    const body = new Laya.Sprite3D()
    body.transform.rotationEuler = new Laya.Vector3(rotX, 0, 0)
    group.addChild(body)

    const greenT = TILE_T * 0.3
    const whiteT = TILE_T - greenT
    // 绿背：厚度靠后那 30%
    this.addRounded(TILE_W, TILE_H, greenT, 2.2, this.bodyMaterial(TILE_BACK), 0, 0, -TILE_T / 2 + greenT / 2, body)
    // 白身：其余 70%，往绿背方向多咬 0.5 防接缝漏光
    this.addRounded(
      TILE_W,
      TILE_H,
      whiteT + 0.5,
      2.2,
      this.bodyMaterial(COLORS.ivory),
      0,
      0,
      TILE_T / 2 - whiteT / 2 - 0.25,
      body
    )
    if (!tile) return group

    // 牌面贴图贴在白身正面（局部 +z）；平躺时跟着整组一起翻到顶面
    this.addRounded(
      TILE_W - 1.5,
      TILE_H - 1.5,
      1.6,
      0.8,
      this.faceMaterial(this.faceTexture(tile)),
      0,
      0,
      TILE_T / 2 + 0.8,
      body
    )
    return group
  }

  /** 立着的牌：自家 / 对家 / 左右家手牌。faceUp=false 时绿背朝相机 */
  private addStandingTile(
    tile: Tile,
    x: number,
    y: number,
    z: number,
    faceUp: boolean,
    parent: Laya.Sprite3D,
    rotationY = 0
  ) {
    this.addTileBody(faceUp ? tile : null, x, y, z, parent, 'stand', rotationY)
  }

  /** 平躺的牌：弃牌、副露。牌面朝上 */
  private addFlatTile(tile: Tile, x: number, z: number, parent: Laya.Sprite3D, rotationY = 0): Laya.Sprite3D {
    return this.addTileBody(tile, x, TILE_T / 2 + 2, z, parent, 'flatUp', rotationY)
  }

  /**
   * 牌墙：一墩就是两张平躺的牌叠在一起，牌背朝上。
   * 和手里的牌是同一个模型：沿桌边 = 牌宽、垂直桌边 = 牌高、每层 = 牌厚。
   * 17 墩 × 墩距 60 = 1020，牌宽 54，所以每墩之间空 6，能一张一张数出来。
   */
  private addWall(visual: Array<Array<[boolean, boolean]>>) {
    const half = WALL_SPAN / 2
    for (let seat = 0; seat < 4; seat += 1) {
      const walls = visual[seat] ?? []
      for (let i = 0; i < STACKS; i += 1) {
        const layers = walls[i] ?? [false, false]
        // 只剩上层时不能悬空：按现有层数从桌面向下压紧
        let level = 0
        for (let layer = 0; layer < 2; layer += 1) {
          if (!layers[layer]) continue
          const y = TILE_T / 2 + level * (TILE_T + 1)
          level += 1
          if (seat === 2 || seat === 0) {
            // 上下两条墙：沿 x 排，进深朝 z
            const x = -half + i * WALL_STEP + WALL_STEP / 2
            const z = seat === 2 ? -WALL_Z : WALL_Z_SELF
            this.addTileBody(null, x, y, z, this.dynamicRoot, 'flatDown')
          } else {
            // 左右两条墙：整墩转 90°，沿 z 排，进深朝 x
            const x = seat === 3 ? -WALL_X : WALL_X
            const z = -half + i * WALL_STEP + WALL_STEP / 2
            this.addTileBody(null, x, y, z, this.dynamicRoot, 'flatDown', 90)
          }
        }
      }
    }
  }

  private addSeatHand(
    seat: number,
    tiles: Tile[],
    faceUp: boolean,
    drawnIndex = -1
  ) {
    if (!tiles.length) return
    // 牌与牌留 2 的缝：不留缝时一排牌会糊成一条，看不出几张
    const step = Math.min(TILE_W - 0.4, 960 / Math.max(1, tiles.length))
    const startX = -((tiles.length - 1) * step) / 2
    for (let i = 0; i < tiles.length; i += 1) {
      const tile = tiles[i]
      if (seat === 0) {
        // 刚摸到的牌只往右让一点，底部仍和手牌齐平（原先整只抬高 8，看着像往后缩）
        const x = startX + i * step + (i === drawnIndex ? 7 : 0)
        this.addStandingTile(tile, x, TILE_H / 2 + 2, HAND_Z_SELF, faceUp, this.dynamicRoot, 0)
        this.recordSelfHit(tile, i, x, TILE_H / 2 + 2, HAND_Z_SELF, i === drawnIndex)
      } else if (seat === 2) {
        const x = startX + i * step
        this.addStandingTile(tile, x, TILE_H / 2 + 2, HAND_Z_OPP, faceUp, this.dynamicRoot, faceUp ? 0 : 180)
      } else {
        const z = startX + i * step
        const x = seat === 3 ? -HAND_X_SIDE : HAND_X_SIDE
        // 一张牌的「白面」永远朝向它的主人：
        //   左家（x 负）白面朝 -x → 扣着时整组转 -90，牌背朝 +x（相机这一侧）；
        //   右家（x 正）白面朝 +x → 扣着时整组转 +90，牌背朝 -x。
        // 亮牌时反过来，让白面转向相机。
        const rot = seat === 3 ? (faceUp ? 90 : -90) : faceUp ? -90 : 90
        this.addStandingTile(tile, x, TILE_H / 2 + 2, z, faceUp, this.dynamicRoot, rot)
      }
    }
  }

  private addMelds(seat: number, player: HandState['players'][number]) {
    if (!player.melds.length) return
    const flatGap = TILE_W
    let cursor = 0
    for (const meld of player.melds) {
      const tiles = meldTiles(meld)
      for (const tile of tiles) {
        let x = 0
        let z = 0
        if (seat === 0) {
          x = 260 - cursor * flatGap
          z = MELD_Z
        } else if (seat === 2) {
          x = -260 + cursor * flatGap
          z = -MELD_Z
        } else if (seat === 3) {
          x = -MELD_X
          z = 260 - cursor * flatGap
        } else {
          x = MELD_X
          z = 260 - cursor * flatGap
        }
        this.addFlatTile(tile, x, z, this.dynamicRoot, seat === 3 ? 90 : seat === 1 ? -90 : 0)
        cursor += 1
      }
      cursor += 0.5
    }
  }

  private addDiscards(seat: number, tiles: Tile[]) {
    if (!tiles.length) return
    const last = this.hand?.lastPlayed
    // 牌与牌紧挨着（step = 牌宽/深，不留缝）。
    // 左右家整块转 90°，宽深互换，所以 col 走 z、line 走 x。
    const colStep = TILE_W
    const lineStep = TILE_H
    const maxCols = 8
    for (let i = 0; i < tiles.length; i += 1) {
      const tile = tiles[i]
      const col = i % maxCols
      const line = Math.floor(i / maxCols)
      let x = 0
      let z = 0
      let rotation = 0
      if (seat === 0) {
        x = -((maxCols - 1) * colStep) / 2 + col * colStep
        z = DISCARD_Z - line * lineStep
      } else if (seat === 2) {
        x = ((maxCols - 1) * colStep) / 2 - col * colStep
        z = -DISCARD_Z + line * lineStep
      } else if (seat === 3) {
        x = -DISCARD_X + line * lineStep
        z = -((maxCols - 1) * colStep) / 2 + col * colStep
        rotation = 90
      } else {
        x = DISCARD_X - line * lineStep
        z = ((maxCols - 1) * colStep) / 2 - col * colStep
        rotation = -90
      }
      this.addFlatTile(tile, x, z, this.dynamicRoot, rotation)
      if (last && last.seat === seat && last.tile === tile && i === tiles.length - 1) {
        this.lastMark = this.markFlatTile(x, z, rotation)
      }
    }
  }

  /** 最后打出的牌：按旋转后的顶面四角投影，得到精确的 2D 描边区域 */
  private markFlatTile(x: number, z: number, rotationY: number) {
    const y = TILE_T / 2 + 2 + TILE_T / 2 + 1
    const a = (rotationY * Math.PI) / 180
    const c = Math.cos(a)
    const s = Math.sin(a)
    const hw = TILE_W / 2
    const hh = TILE_H / 2
    const corners: Array<[number, number]> = [
      [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]
    ]
    const pts = corners.map(([px, pz]) => this.project(x + px * c + pz * s, y, z - px * s + pz * c))
    const xs = pts.map(p => p[0])
    const ys = pts.map(p => p[1])
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys)
    }
  }

  private recordSelfHit(tile: Tile, index: number, x: number, y: number, z: number, drawn: boolean) {
    const halfW = TILE_W / 2
    const halfH = TILE_H / 2
    const front = z + TILE_T / 2
    const pts = [
      this.project(x - halfW, y + halfH, front),
      this.project(x + halfW, y + halfH, front),
      this.project(x + halfW, y - halfH, front),
      this.project(x - halfW, y - halfH, front)
    ]
    const xs = pts.map(p => p[0])
    const ys = pts.map(p => p[1])
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    this.selfHits.push({
      tile,
      index,
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
      drawn
    })
  }

  private project(x: number, y: number, z: number): [number, number] {
    const v = new Laya.Vector4()
    this.camera.worldToViewportPoint(new Laya.Vector3(x, y, z), v)
    return [(v.x / this.texW) * this.viewW, (v.y / this.texH) * this.viewH]
  }

  private projectGroup(node: Laya.Sprite3D, w: number, h: number, d: number): LastMark {
    const base = node.transform.position
    const pts = [
      this.project(base.x - w / 2, base.y + h / 2, base.z - d / 2),
      this.project(base.x + w / 2, base.y + h / 2, base.z - d / 2),
      this.project(base.x + w / 2, base.y - h / 2, base.z + d / 2),
      this.project(base.x - w / 2, base.y - h / 2, base.z + d / 2)
    ]
    const xs = pts.map(p => p[0])
    const ys = pts.map(p => p[1])
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }

  private hand: HandState | null = null

  /** 同步整桌：每次出牌/摸牌后重建 3D 节点 */
  sync(
    hand: HandState | null,
    selfTiles: Tile[],
    dice: { a: number; b: number } | null,
    rolling: boolean,
    wallVisual?: Array<Array<[boolean, boolean]>>,
    dealtCounts?: number[],
    dealing = false
  ) {
    this.hand = hand
    this.selfHits = []
    this.lastMark = null
    this.dynamicRoot.destroyChildren()
    this.diceRoot = null

    if (!hand) {
      const full = [0, 1, 2, 3].map(() =>
        Array.from({ length: STACKS }, () => [true, true] as [boolean, boolean])
      )
      this.addWall(full)
      this.buildDice(dice, rolling)
      return
    }

    // 牌墙：发牌阶段必须用已抓走的位置，不能直接用完整牌山
    const visual = wallVisual ?? [0, 1, 2, 3].map(seat => wallVisualOf(hand, seat))
    this.addWall(visual)

    const winner = hand.winner?.seat
    for (let seat = 0; seat < 4; seat += 1) {
      const player = hand.players[seat]
      if (seat === 0) {
        this.addSeatHand(0, selfTiles, true, selfTiles.length - 1)
      } else {
        const reveal = hand.phase === 'over' && winner === seat
        const tiles = reveal
          ? [...player.hand].sort(tileOrder)
          : dealing
            ? player.hand.slice(0, dealtCounts?.[seat] ?? 0)
            : player.hand
        this.addSeatHand(seat, tiles, reveal)
      }
      this.addMelds(seat, player)
      this.addDiscards(seat, player.discards)
    }

    this.buildDice(dice, rolling)
  }

  private buildDice(dice: { a: number; b: number } | null, rolling: boolean) {
    if (this.diceRoot) {
      this.diceRoot.destroy()
      this.diceRoot = null
    }
    if (!dice) return
    const root = new Laya.Sprite3D()
    this.dynamicRoot.addChild(root)
    this.diceRoot = root
    const scale = rolling ? 1 : 0.68
    this.addDie(root, dice.a, -34, 48, 12, scale, rolling)
    this.addDie(root, dice.b, 34, 48, -12, scale, rolling)
  }

  private addDie(parent: Laya.Sprite3D, value: number, x: number, y: number, z: number, scale: number, rolling: boolean) {
    const die = new Laya.Sprite3D()
    die.transform.position = new Laya.Vector3(x, y, z)
    die.transform.scale = new Laya.Vector3(scale, scale, scale)
    parent.addChild(die)

    const body = new Laya.MeshSprite3D(Laya.PrimitiveMesh.createBox(52, 52, 52))
    body.meshRenderer.sharedMaterial = this.bodyMaterial(COLORS.ivory)
    die.addChild(body)

    // 六面点数。牌桌的视角能看到顶面，所以最后把 value 转到顶面。
    const faces: Array<[Laya.Vector3, Array<[number, number]>]> = [
      [new Laya.Vector3(0, 1, 0), [[0, 0]]],
      [new Laya.Vector3(0, -1, 0), [[-10, -10], [-10, 0], [-10, 10], [10, -10], [10, 0], [10, 10]]],
      [new Laya.Vector3(0, 0, 1), [[-10, -10], [10, 10]]],
      [new Laya.Vector3(0, 0, -1), [[-10, -10], [-10, 0], [-10, 10], [10, -10], [10, 10]]],
      [new Laya.Vector3(1, 0, 0), [[-10, -10], [0, 0], [10, 10]]],
      [new Laya.Vector3(-1, 0, 0), [[-10, -10], [-10, 10], [10, -10], [10, 10]]]
    ]
    const pipMat = this.bodyMaterial('#141414')
    for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
      const [normal, points] = faces[faceIndex]
      const faceValue = faceIndex + 1
      if (faceValue > 6) continue
      for (const [u, v] of points) {
        let px = 0
        let py = 0
        let pz = 0
        if (normal.y !== 0) {
          px = u
          py = normal.y * 26.5
          pz = v
        } else if (normal.z !== 0) {
          px = u
          py = v
          pz = normal.z * 26.5
        } else {
          px = normal.x * 26.5
          py = v
          pz = u
        }
        const pip = new Laya.MeshSprite3D(Laya.PrimitiveMesh.createSphere(3.3, 8, 8))
        pip.transform.position = new Laya.Vector3(px, py, pz)
        pip.meshRenderer.sharedMaterial = pipMat
        die.addChild(pip)
      }
    }

    die.transform.rotationEuler = rolling
      ? new Laya.Vector3(Math.random() * 360, Math.random() * 360, Math.random() * 360)
      : this.dieRotation(value)
  }

  private dieRotation(value: number): Laya.Vector3 {
    // 让 value 所在的面朝上
    switch (value) {
      case 2:
        return new Laya.Vector3(-90, 0, 0)
      case 5:
        return new Laya.Vector3(90, 0, 0)
      case 3:
        return new Laya.Vector3(0, 0, 90)
      case 4:
        return new Laya.Vector3(0, 0, -90)
      case 6:
        return new Laya.Vector3(180, 0, 0)
      default:
        return new Laya.Vector3(0, 0, 0)
    }
  }

  /** 骰子旋转/落定只更新骰子，不重建整桌 */
  updateDice(dice: { a: number; b: number } | null, rolling: boolean) {
    this.buildDice(dice, rolling)
  }

  dispose() {
    this.dynamicRoot.destroyChildren()
    this.tableRoot.destroyChildren()
  }
}
