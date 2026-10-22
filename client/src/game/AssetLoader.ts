/** 资源预加载器 - 加载所有麻将牌 SVG 图片 */

const SUIT_MAP: Record<string, string> = {
  wan: 'Man',
  tiao: 'Sou',
  tong: 'Pin',
}

class AssetLoaderStore {
  private images: Map<string, HTMLImageElement> = new Map()
  private loaded = false
  private loading = false
  private loadPromise: Promise<void> | null = null

  /** 预加载所有牌面图片 */
  load(): Promise<void> {
    if (this.loaded) return Promise.resolve()
    if (this.loadPromise) return this.loadPromise

    this.loading = true
    const files: string[] = []

    // Man1-9, Pin1-9, Sou1-9
    for (const prefix of ['Man', 'Pin', 'Sou']) {
      for (let i = 1; i <= 9; i++) {
        files.push(`${prefix}${i}`)
      }
    }
    files.push('Front', 'Back')

    this.loadPromise = Promise.all(
      files.map(name => this.loadImage(name, `/tiles/${name}.svg`))
    ).then(() => {
      this.loaded = true
      this.loading = false
    })

    return this.loadPromise
  }

  private loadImage(name: string, src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        this.images.set(name, img)
        resolve()
      }
      img.onerror = () => {
        console.warn(`Failed to load: ${src}`)
        resolve() // 不阻塞其他加载
      }
      img.src = src
    })
  }

  /** 获取牌面图片 */
  getTileImage(suit: string, value: number): HTMLImageElement | null {
    const prefix = SUIT_MAP[suit]
    if (!prefix) return null
    return this.images.get(`${prefix}${value}`) || null
  }

  /** 获取牌面空白底 */
  getFront(): HTMLImageElement | null {
    return this.images.get('Front') || null
  }

  /** 获取牌背 */
  getBack(): HTMLImageElement | null {
    return this.images.get('Back') || null
  }

  get isLoaded(): boolean {
    return this.loaded
  }

  get isLoading(): boolean {
    return this.loading
  }
}

export const assetLoader = new AssetLoaderStore()
