/**
 * 倒子麻将 · 牌面贴图
 *
 * 牌面不再是 Canvas 文字，而是从一张 1024×880 的图集里取真实牌面：
 * 8 列 × 5 行，每格 128×176，34 种牌按下面的固定顺序排列。
 * 整张图集量化到 128 色后只有 92KB，2D / 3D 共用同一份像素。
 *
 * 图集由矢量原图离线烘焙（34 格按 TILE_ORDER 排好，再量化成 128 色），
 * 牌面取自 https://github.com/zddd312/mahjong-tiles 的扁平风格套装
 * （M+ 字型条款，可自由商用；1 条是长尾雀鸟，白板留白加黑框）。
 * 构建产物里只需要 `resources/tiles/tilefaces.png` 这一张图。
 */

import type { Tile } from '../game/score'

/** 图集在 resources 下的路径；Laya 的 resources 根目录会自动映射 */
export const TILE_ATLAS_URL = 'resources/tiles/tilefaces.png'

/** 单格尺寸（图集里的原始像素） */
export const TILE_CELL_W = 128
export const TILE_CELL_H = 176
/** 图集列数；行数由牌种数量决定 */
const ATLAS_COLS = 8

/** 万 1–9、筒 1–9、条 1–9、东南西北中发白 */
const TILE_ORDER: Tile[] = []
for (const suit of ['万', '筒', '条']) {
  for (let rank = 1; rank <= 9; rank += 1) TILE_ORDER.push(`${rank}${suit}`)
}
TILE_ORDER.push('东', '南', '西', '北', '中', '发', '白')

const TILE_INDEX = new Map<Tile, number>(TILE_ORDER.map((tile, index) => [tile, index]))

class TileArtStore {
  /** 2D 用：整张图集的 Texture（内部包着 Texture2D） */
  private atlas: Laya.Texture | null = null
  /** 3D 用：原始 Image，按格裁到 Canvas 再上传成 Texture2D */
  private source: HTMLImageElement | null = null
  /** 2D 每种牌的子纹理，全部共享同一张 GPU 图集 */
  private cellCache = new Map<Tile, Laya.Texture>()
  private loading: Promise<boolean> | null = null

  get ready(): boolean {
    return !!this.atlas && !!this.source
  }

  /**
   * 载入图集。失败时返回 false，调用方继续用旧的文字牌面兜底。
   * 同一份 URL 只加载一次。
   */
  load(): Promise<boolean> {
    if (this.ready) return Promise.resolve(true)
    if (this.loading) return this.loading

    this.loading = new Promise<boolean>((resolve) => {
      let settled = false
      let timer: any
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        if (timer !== undefined) {
          const clear = (globalThis as any).clearTimeout
          if (typeof clear === 'function') clear(timer)
        }
        resolve(ok)
      }

      const url = Laya.URL.formatURL(TILE_ATLAS_URL)
      const img = new Laya.Browser.window.Image()
      img.onload = () => {
        if (settled) return
        try {
          const texture = new Laya.Texture2D(
            img.width,
            img.height,
            Laya.TextureFormat.R8G8B8A8,
            false,
            false,
            true,
            false
          )
          texture.setImageData(img, false, false)
          this.atlas = new Laya.Texture(texture)
          this.source = img
          finish(true)
        } catch (err) {
          console.warn('[tileArt] 牌面图集转换失败，继续使用文字牌面', err)
          finish(false)
        }
      }
      img.onerror = () => {
        console.warn(`[tileArt] 牌面图集加载失败：${url}，继续使用文字牌面`)
        finish(false)
      }
      img.src = url

      // 微信小游戏低端机上偶发 onload 不回调，超时后直接走文字兜底，别把牌桌卡死
      timer = (globalThis as any).setTimeout?.(() => {
        if (!settled) console.warn('[tileArt] 牌面图集加载超时，继续使用文字牌面')
        finish(false)
      }, 3000)
    })

    return this.loading
  }

  /** 2D：一种牌在图集里的子纹理；图集未就绪时返回 null */
  texture(tile: Tile): Laya.Texture | null {
    if (!this.ready) return null
    const cached = this.cellCache.get(tile)
    if (cached) return cached
    const index = TILE_INDEX.get(tile)
    if (index === undefined) return null
    const x = (index % ATLAS_COLS) * TILE_CELL_W
    const y = Math.floor(index / ATLAS_COLS) * TILE_CELL_H
    const tex = Laya.Texture.create(this.atlas as Laya.Texture, x, y, TILE_CELL_W, TILE_CELL_H)
    this.cellCache.set(tile, tex)
    return tex
  }

  /**
   * 3D：把图集里的一格画到独立 Canvas 上。
   * 3D 材质只接受 Texture2D，而 Texture2D 没有「子区域」概念，
   * 所以这里按格裁一次；Table3D 会按牌种缓存，最多 34 张。
   */
  faceCanvas(tile: Tile, dim = false): HTMLCanvasElement | null {
    if (!this.ready) return null
    const index = TILE_INDEX.get(tile)
    if (index === undefined) return null
    const sx = (index % ATLAS_COLS) * TILE_CELL_W
    const sy = Math.floor(index / ATLAS_COLS) * TILE_CELL_H

    const hc = new Laya.HTMLCanvas(true)
    hc.size(TILE_CELL_W, TILE_CELL_H)
    const ctx = hc.context
    ctx.clearRect(0, 0, TILE_CELL_W, TILE_CELL_H)
    // 图集格子本身已经是象牙底，直接整格铺满
    ctx.drawImage(
      this.source as HTMLImageElement,
      sx,
      sy,
      TILE_CELL_W,
      TILE_CELL_H,
      0,
      0,
      TILE_CELL_W,
      TILE_CELL_H
    )
    if (dim) {
      // 禁打的灰版：压一层灰，保留牌面纹理
      ctx.fillStyle = 'rgba(92, 98, 92, 0.58)'
      ctx.fillRect(0, 0, TILE_CELL_W, TILE_CELL_H)
    }
    return hc.source as HTMLCanvasElement
  }
}

export const tileArt = new TileArtStore()
