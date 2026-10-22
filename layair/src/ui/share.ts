/**
 * 倒子麻将 · 微信小游戏分享（转发给好友 / 分享到朋友圈）
 *
 * LayaAir 3.x 的微信小游戏适配库（`libs/laya.adapter-weixin.js`）只把 `wx` 挂到
 * `Laya.PAL.g`，并不封装转发；分享得按微信官方文档直接用 `wx` 的接口：
 *
 * 1. `wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })`
 *    小游戏右上角菜单里的「转发」**默认不可点**，朋友圈也默认不可分享，
 *    必须先调这个接口，菜单里才会出现「发送给朋友 / 分享到朋友圈」。
 * 2. `wx.onShareAppMessage` / `wx.onShareTimeline` 只负责「用户点右上角菜单时」
 *    返回卡片标题和图片；主动分享不能用这两个接口。
 * 3. 游戏内「发给好友」用 `wx.shareAppMessage` 主动拉起选择聊天界面；
 *    朋友圈没有对应的主动接口（官方原话：不支持在小游戏内直接发起分享），
 *    只能在游戏里提示玩家点右上角「···」。
 * 4. 不传 `imageUrl` 时微信拿当前游戏画面当卡片图（转发卡片 5:4，
 *    朋友圈预览图默认也是游戏画面截图），所以这里不额外打包分享图。
 *
 * 所以这个模块只做三件事：开菜单、挂卡片、主动转发；
 * 具体标题由牌桌按当前局面拼（见 TableView#shareTitle）。
 *
 * 参考：
 * - 转发 https://developers.weixin.qq.com/minigame/dev/guide/open-ability/share/share.html
 * - 分享到朋友圈 https://developers.weixin.qq.com/minigame/dev/guide/open-ability/share-timeline_game.html
 * - wx.onShareTimeline https://developers.weixin.qq.com/minigame/dev/api/share/wx.onShareTimeline.html
 */

/** 卡片参数，字段与微信文档一致；没给的字段用微信的默认行为 */
export interface ShareCard {
  /** 转发标题，不传用游戏昵称 */
  title?: string
  /** 进入小游戏后可从 wx.getLaunchOptionsSync().query 读到 */
  query?: string
  /** 转发卡片图（5:4）；不传 = 当前游戏画面截图 */
  imageUrl?: string
  /** 朋友圈预览图；不传 = 当前游戏画面截图（基础库 2.14.3+） */
  imagePreviewUrl?: string
}

/** 只声明用得上的 wx 接口，测试里可以塞假对象进来 */
export interface WxLike {
  showShareMenu?: (options: { withShareTicket?: boolean; menus?: string[] }) => void
  onShareAppMessage?: (listener: () => ShareCard) => void
  onShareTimeline?: (listener: () => ShareCard) => void
  shareAppMessage?: (options: ShareCard) => void
  getAppBaseInfo?: () => { SDKVersion?: string }
  getSystemInfoSync?: () => { SDKVersion?: string }
}

/** 朋友圈分享：微信文档写「从基础库 2.12.0 开始支持」，且目前只在安卓微信支持 */
export const TIMELINE_MIN_VERSION = '2.12.0'

export const DEFAULT_SHARE_TITLE = '倒子麻将 · 缺一门，可碰可杠不可吃，来打一把？'

/** 从分享卡片进来时带的 query，方便以后做邀请/拉新统计 */
export const SHARE_QUERY_FRIEND = 'from=share'
export const SHARE_QUERY_TIMELINE = 'from=timeline'

let card: ShareCard = { title: DEFAULT_SHARE_TITLE, query: SHARE_QUERY_FRIEND }
let installedOn: WxLike | null = null

/** 当前环境里的 wx；浏览器 / LayaAirIDE 预览里没有，返回 null */
export function wechat(): WxLike | null {
  try {
    const wx = (globalThis as any).wx
    if (wx && typeof wx.showShareMenu === 'function') return wx as WxLike
  } catch {
    // 取不到就当没有微信环境
  }
  return null
}

export function isWechatMiniGame(): boolean {
  return !!wechat()
}

/** 比较 "2.12.0" 这种版本号：a > b 返回 1，相等 0，小于 -1 */
export function compareVersion(a: string, b: string): number {
  const pa = String(a || '0').split('.').map(part => parseInt(part, 10) || 0)
  const pb = String(b || '0').split('.').map(part => parseInt(part, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

/** 微信基础库版本；旧接口还在时退回 getSystemInfoSync */
export function baseLibraryVersion(wx: WxLike | null = wechat()): string {
  if (!wx) return ''
  try {
    const info = wx.getAppBaseInfo?.()
    if (info?.SDKVersion) return info.SDKVersion
  } catch {
    // 旧版本没有 getAppBaseInfo
  }
  try {
    return wx.getSystemInfoSync?.().SDKVersion ?? ''
  } catch {
    return ''
  }
}

/** 右上角菜单能不能出现「分享到朋友圈」 */
export function supportsTimeline(wx: WxLike | null = wechat()): boolean {
  if (!wx || typeof wx.onShareTimeline !== 'function') return false
  const version = baseLibraryVersion(wx)
  // 读不到版本号时不拦着，让微信自己决定
  if (!version) return true
  return compareVersion(version, TIMELINE_MIN_VERSION) >= 0
}

/** 更新卡片内容；牌桌每次渲染时按局面调一次 */
export function setShareCard(next: ShareCard): void {
  card = { ...card, ...next }
  if (!card.title) card.title = DEFAULT_SHARE_TITLE
}

export function currentShareCard(): ShareCard {
  return { ...card }
}

/** 转发的卡片只认识 title / imageUrl / query，别把朋友圈专用字段带过去 */
function friendCard(): ShareCard {
  const { title, query, imageUrl } = card
  return { title, query, imageUrl }
}

/** 朋友圈卡片多一个预览图字段 */
function timelineCard(): ShareCard {
  const { title, query, imageUrl, imagePreviewUrl } = card
  return { title, query, imageUrl, imagePreviewUrl }
}

/**
 * 挂上右上角菜单的转发 / 朋友圈按钮，并注册卡片内容。
 * 对同一个 wx 只装一次；返回这次是否真的装了。
 */
export function initShare(wx: WxLike | null = wechat()): boolean {
  if (!wx || installedOn === wx) return false
  installedOn = wx
  try {
    // 不传 withShareTicket：设成 true 只能选一个聊天对象、转出去还不能二次转发，
    // 我们也不用 shareTicket 查群信息，放开多选更容易传播。
    wx.showShareMenu?.({ menus: ['shareAppMessage', 'shareTimeline'] })
  } catch {
    // 旧基础库不认识 menus，忽略
  }
  try {
    wx.onShareAppMessage?.(() => friendCard())
  } catch {
    // 忽略
  }
  try {
    wx.onShareTimeline?.(() => ({ ...timelineCard(), query: SHARE_QUERY_TIMELINE }))
  } catch {
    // 忽略
  }
  return true
}

/**
 * 游戏内主动「发给好友」。朋友圈没有对应的主动接口，
 * 只能在分享面板里提示玩家点右上角「···」。
 * 返回是否真的把转发调起来了。
 */
export function shareToFriend(next: ShareCard = {}, wx: WxLike | null = wechat()): boolean {
  if (!wx || typeof wx.shareAppMessage !== 'function') return false
  try {
    wx.shareAppMessage({ ...currentShareCard(), ...next })
    return true
  } catch {
    return false
  }
}
