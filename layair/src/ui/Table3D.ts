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

const TILE_W = 60
const TILE_H = 86
const TILE_T = 28
const FLAT_W = 38
const FLAT_D = 50
const TABLE_W = 1280
const TABLE_D = 900
const SELF_HAND_Z = TABLE_D / 2 - 90
const WALL_SIDE = 650
const STACKS = 17
const WALL_STEP = WALL_SIDE / STACKS
const WALL_LEN = WALL_STEP - 0.8
const WALL_THICK = 18
const WALL_H = 11

function hexColor(hex: string, alpha = 1): Laya.Color {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16) / 255
  const g = parseInt(value.slice(2, 4), 16) / 255
  const b = parseInt(value.slice(4, 6), 16) / 255
  return new Laya.Color(r, g, b, alpha)
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
    this.camera.farPlane = 4000
    this.camera.fieldOfView = 39
    this.camera.transform.position = new Laya.Vector3(0, 1120, 1200)
    this.camera.transform.rotationEuler = new Laya.Vector3(-37, 0, 0)

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
          verts.push(cx + dx * r, cy + dy * r, cz + dz * r, dx, dy, dz, i / seg, j / seg)
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
    mat.albedoIntensity = 0.95
    this.bodyCache.set(color, mat)
    return mat
  }

  private faceMaterial(tex: Laya.Texture2D): Laya.UnlitMaterial {
    const mat = new Laya.UnlitMaterial()
    mat.albedoTexture = tex
    return mat
  }

  private faceTexture(tile: Tile, flat: boolean): Laya.Texture2D {
    const key = `${tile}:${flat ? 'f' : 's'}`
    const cached = this.faceCache.get(key)
    if (cached) return cached

    const w = 128
    const h = 176
    const hc = new Laya.HTMLCanvas(true)
    hc.size(w, h)
    const ctx = hc.context
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = flat ? '#F2E7CE' : '#F2E7CE'
    ctx.fillRect(0, 0, w, h)
    if (!flat) {
      ctx.fillStyle = '#2F7A5E'
      ctx.fillRect(0, 0, w, 22)
      ctx.fillStyle = '#FBF4E2'
      ctx.fillRect(0, 22, w, 8)
      ctx.fillStyle = '#F7EEDA'
      ctx.fillRect(2, 30, w - 4, h - 34)
    } else {
      ctx.fillStyle = '#F7EEDA'
      ctx.fillRect(3, 3, w - 6, h - 6)
    }

    // 不再画黑框：牌与牌之间靠 3D 间隙和圆角分隔
    ctx.strokeStyle = 'rgba(143,120,82,0.32)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(5.5, flat ? 5.5 : 33.5, w - 11, h - (flat ? 11 : 39))

    const honor = tile.length === 1 && HONOR_COLOR[tile] !== undefined
    const suit = honor ? '字' : tile.charAt(1)
    const color = honor ? HONOR_COLOR[tile] : SUIT_COLOR[suit] ?? COLORS.ink
    const areaTop = flat ? 8 : 38
    const areaH = h - areaTop - 8
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

  /** 站立牌：自己/亮牌用牌面，对家/左右家背面用绿牌背 */
  private addStandingTile(
    tile: Tile,
    x: number,
    y: number,
    z: number,
    faceUp: boolean,
    parent: Laya.Sprite3D,
    rotationY = 0,
    drawn = false
  ) {
    const group = new Laya.Sprite3D()
    group.transform.position = new Laya.Vector3(x, y + (drawn ? 8 : 0), z)
    group.transform.rotationEuler = new Laya.Vector3(0, rotationY, 0)
    parent.addChild(group)

    const bodyColor = faceUp ? '#2F7A5E' : '#2F7A5E'
    this.addRounded(TILE_W, TILE_H, TILE_T, 4.5, this.bodyMaterial(bodyColor), 0, 0, 0, group)

    if (faceUp) {
      this.addRounded(
        TILE_W - 3.5,
        TILE_H - 3.5,
        1.7,
        0.85,
        this.faceMaterial(this.faceTexture(tile, false)),
        0,
        0,
        TILE_T / 2 + 0.9,
        group
      )
    } else {
      // 牌背：白顶 + 绿色牌背，牌背朝相机
      this.addRounded(TILE_W, 3, TILE_T, 1.2, this.bodyMaterial(COLORS.ivory), 0, TILE_H / 2 - 1.5, 0, group)
      this.addRounded(
        TILE_W - 3.5,
        TILE_H - 8,
        1.7,
        0.85,
        this.bodyMaterial('#3C9374'),
        0,
        -2,
        TILE_T / 2 + 0.8,
        group
      )
    }
  }

  /** 平躺牌：弃牌、副露、最后打出的牌 */
  private addFlatTile(tile: Tile, x: number, z: number, parent: Laya.Sprite3D, rotationY = 0): Laya.Sprite3D {
    const group = new Laya.Sprite3D()
    group.transform.position = new Laya.Vector3(x, 7, z)
    group.transform.rotationEuler = new Laya.Vector3(0, rotationY, 0)
    parent.addChild(group)

    this.addRounded(FLAT_W, 11, FLAT_D, 3.6, this.bodyMaterial(COLORS.ivory), 0, 0, 0, group)
    // 用竖牌面板绕 X 轴翻平，正面贴图自然朝上
    this.addRounded(
      FLAT_W - 3,
      FLAT_D - 3,
      1.7,
      0.8,
      this.faceMaterial(this.faceTexture(tile, true)),
      0,
      6.4,
      0,
      group,
      -90
    )
    return group
  }

  private addWall(visual: Array<Array<[boolean, boolean]>>) {
    const half = WALL_SIDE / 2
    for (let seat = 0; seat < 4; seat += 1) {
      const walls = visual[seat] ?? []
      for (let i = 0; i < STACKS; i += 1) {
        const layers = walls[i] ?? [false, false]
        for (let layer = 0; layer < 2; layer += 1) {
          if (!layers[layer]) continue
          const y = 6 + layer * (WALL_H + 1)
          if (seat === 2 || seat === 0) {
            const x = -half + i * WALL_STEP + WALL_STEP / 2
            const z = seat === 2 ? -half : half
            this.addRounded(WALL_LEN, WALL_H, WALL_THICK, 1.8, this.bodyMaterial('#2F7A5E'), x, y, z, this.dynamicRoot)
          } else {
            const x = seat === 3 ? -half : half
            const z = -half + i * WALL_STEP + WALL_STEP / 2
            this.addRounded(WALL_THICK, WALL_H, WALL_LEN, 1.8, this.bodyMaterial('#2F7A5E'), x, y, z, this.dynamicRoot)
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
    const step = Math.min(TILE_W + 2, 940 / Math.max(1, tiles.length))
    const startX = -((tiles.length - 1) * step) / 2
    for (let i = 0; i < tiles.length; i += 1) {
      const tile = tiles[i]
      if (seat === 0) {
        const x = startX + i * step
        this.addStandingTile(tile, x, TILE_H / 2 + 2, SELF_HAND_Z, faceUp, this.dynamicRoot, 0, i === drawnIndex)
        this.recordSelfHit(tile, i, x, TILE_H / 2 + (i === drawnIndex ? 10 : 2), SELF_HAND_Z, i === drawnIndex)
      } else if (seat === 2) {
        const x = startX + i * step
        this.addStandingTile(tile, x, TILE_H / 2 + 2, -TABLE_D / 2 + 22, faceUp, this.dynamicRoot, faceUp ? 0 : 180)
      } else {
        const z = startX + i * step
        const x = seat === 3 ? -TABLE_W / 2 + 18 : TABLE_W / 2 - 18
        this.addStandingTile(tile, x, TILE_H / 2 + 2, z, faceUp, this.dynamicRoot, faceUp ? 0 : seat === 3 ? 90 : -90)
      }
    }
  }

  private addMelds(seat: number, player: HandState['players'][number]) {
    if (!player.melds.length) return
    const flatGap = FLAT_W + 1.6
    let cursor = 0
    for (const meld of player.melds) {
      const tiles = meldTiles(meld)
      for (const tile of tiles) {
        let x = 0
        let z = 0
        if (seat === 0) {
          x = 260 - cursor * flatGap
          z = 180
        } else if (seat === 2) {
          x = -260 + cursor * flatGap
          z = -300
        } else if (seat === 3) {
          x = -260
          z = 160 - cursor * flatGap
        } else {
          x = 260
          z = -160 + cursor * flatGap
        }
        this.addFlatTile(tile, x, z, this.dynamicRoot)
        cursor += 1
      }
      cursor += 0.5
    }
  }

  private addDiscards(seat: number, tiles: Tile[]) {
    if (!tiles.length) return
    const last = this.hand?.lastPlayed
    const maxCols = 12
    for (let i = 0; i < tiles.length; i += 1) {
      const tile = tiles[i]
      const col = i % maxCols
      const row = Math.floor(i / maxCols)
      let x = 0
      let z = 0
      let rotation = 0
      if (seat === 0) {
        x = -maxCols * (FLAT_W + 4) / 2 + col * (FLAT_W + 2)
        z = 60 - row * (FLAT_D + 2)
      } else if (seat === 2) {
        x = maxCols * (FLAT_W + 4) / 2 - col * (FLAT_W + 2)
        z = -210 + row * (FLAT_D + 2)
      } else if (seat === 3) {
        x = -230
        z = -200 + col * (FLAT_W + 2)
        rotation = 90
      } else {
        x = 230
        z = 200 - col * (FLAT_W + 2)
        rotation = -90
      }
      const node = this.addFlatTile(tile, x, z, this.dynamicRoot, rotation)
      if (last && last.seat === seat && last.tile === tile && i === tiles.length - 1) {
        this.lastMark = this.projectGroup(node, FLAT_W, 10, FLAT_D)
      }
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
  sync(hand: HandState | null, selfTiles: Tile[], dice: { a: number; b: number } | null, rolling: boolean) {
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

    // 牌墙
    const visual = [0, 1, 2, 3].map(seat => wallVisualOf(hand, seat))
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
