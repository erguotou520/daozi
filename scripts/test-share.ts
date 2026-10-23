/**
 * 微信小游戏分享 · 回归测试
 *
 * 运行： pnpm test:share
 *
 * 微信接口在 Node 里没有，这里塞一个假 wx 进去，验证：
 * - 版本比较与朋友圈开关（2.12.0 起）
 * - initShare 只装一次、菜单里同时打开「发送给朋友 / 分享到朋友圈」
 * - 右上角菜单回调拿到的卡片字段（朋友圈用 from=timeline，且只带朋友圈认识的字段）
 * - 游戏内主动转发只认识 title/imageUrl/query
 * - 截图分享走 wx.showShareImageMenu，失败时退回「存相册」；原因要能带回界面
 */

import {
  DEFAULT_SHARE_TITLE,
  SHARE_QUERY_FRIEND,
  SHARE_QUERY_TIMELINE,
  TIMELINE_MIN_VERSION,
  baseLibraryVersion,
  compareVersion,
  currentShareCard,
  initShare,
  isWechatMiniGame,
  saveImageToAlbum,
  setShareCard,
  shareImage,
  shareToFriend,
  supportsTimeline
} from '../layair/src/ui/share'

let checks = 0
let failures = 0

const check = (label: string, actual: unknown, expected: unknown) => {
  checks += 1
  if (actual === expected) {
    console.log(`  ✓ ${label}: ${String(actual)}`)
  } else {
    failures += 1
    console.log(`  ✗ ${label}: 期望 ${String(expected)}，实际 ${String(actual)}`)
  }
}

/** 假 wx：记下 showShareMenu 的参数、注册的菜单回调、主动转发的内容 */
function fakeWx(sdk = '2.12.0', withTimeline = true) {
  const calls: {
    menu?: { withShareTicket?: boolean; menus?: string[] }
    friendListener?: () => any
    timelineListener?: () => any
    shared?: any
    imageMenu?: any
  } = {}
  const wx: any = {
    showShareMenu(options: any) {
      calls.menu = options
    },
    onShareAppMessage(listener: any) {
      calls.friendListener = listener
    },
    shareAppMessage(options: any) {
      calls.shared = options
    },
    showShareImageMenu(options: any) {
      calls.imageMenu = options
    }
  }
  if (withTimeline) {
    wx.onShareTimeline = (listener: any) => {
      calls.timelineListener = listener
    }
  }
  if (sdk === 'old') {
    // 旧基础库：只有 getSystemInfoSync
    wx.getSystemInfoSync = () => ({ SDKVersion: '2.9.0' })
  } else {
    wx.getAppBaseInfo = () => ({ SDKVersion: sdk })
  }
  return { wx, calls }
}

/* ------------------------------------------------------------------ */
console.log('\n一、版本比较')
check('2.12.0 > 2.11.3', compareVersion('2.12.0', '2.11.3'), 1)
check('2.11.3 < 2.12.0', compareVersion('2.11.3', '2.12.0'), -1)
check('2.12.0 == 2.12.0', compareVersion('2.12.0', '2.12.0'), 0)
check('2.12 视为 2.12.0', compareVersion('2.12', '2.12.0'), 0)
check('3.0.0 > 2.99.99', compareVersion('3.0.0', '2.99.99'), 1)
check('空版本按 0 算', compareVersion('', '2.0.0'), -1)
check('朋友圈门槛是 2.12.0', TIMELINE_MIN_VERSION, '2.12.0')

/* ------------------------------------------------------------------ */
console.log('\n二、浏览器 / IDE 预览里没有 wx')
check('没有 wx 时不算小游戏', isWechatMiniGame(), false)
check('没有 wx 时开不了朋友圈', supportsTimeline(null), false)
check('没有 wx 时主动转发返回 false', shareToFriend({ title: 'x' }, null), false)
check('没有 wx 时 initShare 返回 false', initShare(null), false)
check('读不到环境时 baseLibraryVersion 为空', baseLibraryVersion(null), '')
check('默认卡片标题', currentShareCard().title, DEFAULT_SHARE_TITLE)
check('默认卡片带来源 query', currentShareCard().query, SHARE_QUERY_FRIEND)

/* ------------------------------------------------------------------ */
console.log('\n三、initShare：菜单与卡片')
setShareCard({ title: DEFAULT_SHARE_TITLE, query: SHARE_QUERY_FRIEND })

const { wx: wxA, calls: callsA } = fakeWx('2.12.0')
check('第一次 initShare 装上', initShare(wxA), true)
check('同一个 wx 不重复注册', initShare(wxA), false)
check('菜单打开 shareAppMessage', callsA.menu?.menus?.includes('shareAppMessage'), true)
check('菜单打开 shareTimeline', callsA.menu?.menus?.includes('shareTimeline'), true)
check('菜单不限制只能选一个好友（不传 withShareTicket）', callsA.menu?.withShareTicket, undefined)
check('注册了转发回调', typeof callsA.friendListener, 'function')
check('注册了朋友圈回调', typeof callsA.timelineListener, 'function')

setShareCard({ title: '我刚打出一手大拿，来倒子麻将试试？' })
const friendCard = callsA.friendListener?.()
check('转发卡片用最新标题', friendCard?.title, '我刚打出一手大拿，来倒子麻将试试？')
check('转发卡片来源 query', friendCard?.query, SHARE_QUERY_FRIEND)
check('转发卡片不带朋友圈专用字段', 'imagePreviewUrl' in (friendCard ?? {}), false)

const timelineCard = callsA.timelineListener?.()
check('朋友圈卡片标题同源', timelineCard?.title, '我刚打出一手大拿，来倒子麻将试试？')
check('朋友圈卡片 query 标记来源', timelineCard?.query, SHARE_QUERY_TIMELINE)
check('朋友圈卡片可以带预览图字段', 'imagePreviewUrl' in (timelineCard ?? {}), true)

/* ------------------------------------------------------------------ */
console.log('\n四、朋友圈开关')
const { wx: wxNew } = fakeWx('2.12.0')
check('基础库 2.12.0 支持朋友圈', supportsTimeline(wxNew), true)
const { wx: wxOld } = fakeWx('2.11.3')
check('基础库 2.11.3 不支持朋友圈', supportsTimeline(wxOld), false)
const { wx: wxNoTimeline } = fakeWx('3.0.0', false)
check('没有 onShareTimeline 时不支持朋友圈', supportsTimeline(wxNoTimeline), false)
const { wx: wxAncient } = fakeWx('old')
check('旧基础库退回 getSystemInfoSync 读版本', baseLibraryVersion(wxAncient), '2.9.0')
check('旧基础库不支持朋友圈', supportsTimeline(wxAncient), false)

/* ------------------------------------------------------------------ */
console.log('\n五、游戏内主动转发')
const { wx: wxB, calls: callsB } = fakeWx('2.12.0')
initShare(wxB)
setShareCard({ title: '来打一把倒子麻将', query: SHARE_QUERY_FRIEND })
check('主动转发成功', shareToFriend({}, wxB), true)
check('主动转发带标题', callsB.shared?.title, '来打一把倒子麻将')
check('主动转发带来源 query', callsB.shared?.query, SHARE_QUERY_FRIEND)
check('主动转发可以临时改标题', shareToFriend({ title: '临时标题' }, wxB), true)
check('临时标题生效', callsB.shared?.title, '临时标题')

const noShareApi: any = { showShareMenu() {}, onShareAppMessage() {}, onShareTimeline() {} }
check('没有 shareAppMessage 时返回 false', shareToFriend({}, noShareApi), false)

/* ------------------------------------------------------------------ */
console.log('\n六、截图分享')
const { wx: wxC, calls: callsC } = fakeWx('3.0.0')
initShare(wxC)
check('截图分享调起来了', shareImage('/tmp/daozi-shot.png', { wx: wxC }), true)
check('截图分享把临时路径交给微信', callsC.imageMenu?.path, '/tmp/daozi-shot.png')
check('空路径不调微信', shareImage('', { wx: wxC }), false)

const noImageMenu: any = { showShareMenu() {}, onShareAppMessage() {}, onShareTimeline() {}, shareAppMessage() {} }
check('老版本没有 showShareImageMenu 时返回 false', shareImage('/tmp/daozi-shot.png', { wx: noImageMenu }), false)
check('没有 wx 时截图分享返回 false', shareImage('/tmp/daozi-shot.png', { wx: null }), false)

// 老版本退回转发卡片：图片当卡片图
check('退回转发时把截图当卡片图', shareToFriend({ imageUrl: '/tmp/daozi-shot.png' }, noImageMenu), true)

// 微信拒了（例如图太大 / 基础库太老）：fail 回调把 errMsg 带回来，界面上要能看见
const failing: any = {
  showShareMenu() {},
  onShareAppMessage() {},
  onShareTimeline() {},
  showShareImageMenu(options: any) {
    options.fail?.({ errMsg: 'showShareImageMenu:fail path is invalid' })
  }
}
let failureReason = ''
check('分享被拒时返回 true（接口已调起）', shareImage('/tmp/daozi-shot.png', { wx: failing, onFail: r => (failureReason = r) }), true)
check('分享被拒时把 errMsg 交给回调', failureReason, 'showShareImageMenu:fail path is invalid')

/* ------------------------------------------------------------------ */
console.log('\n七、存到相册（分享图片弹窗打不开时的退路）')
{
  const calls: { saved?: string; settingOpened?: boolean } = {}
  let saved = false
  let saveFail = ''
  const wxSave: any = {
    showShareMenu() {},
    saveImageToPhotosAlbum(options: any) {
      calls.saved = options.filePath
      options.success?.()
    },
    openSetting() {
      calls.settingOpened = true
    }
  }
  check('存相册调起来了', saveImageToAlbum('/tmp/daozi-shot.png', { wx: wxSave, onSaved: () => (saved = true) }), true)
  check('存相册用的是这张截图', calls.saved, '/tmp/daozi-shot.png')
  check('存成功回调触发', saved, true)
  check('存成功不拉设置页', calls.settingOpened, undefined)

  const wxDenied: any = {
    showShareMenu() {},
    saveImageToPhotosAlbum(options: any) {
      options.fail?.({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' })
    },
    openSetting() {
      calls.settingOpened = true
    }
  }
  calls.settingOpened = false
  check('权限被拒时返回 true（接口已调起）', saveImageToAlbum('/tmp/daozi-shot.png', { wx: wxDenied, onFail: r => (saveFail = r) }), true)
  check('权限被拒时带回 errMsg', saveFail, 'saveImageToPhotosAlbum:fail auth deny')
  check('权限被拒时自动拉起设置页', calls.settingOpened, true)

  const noAlbumApi: any = { showShareMenu() {} }
  check('没有 saveImageToPhotosAlbum 时返回 false', saveImageToAlbum('/tmp/daozi-shot.png', { wx: noAlbumApi }), false)
  check('没有 wx 时返回 false', saveImageToAlbum('/tmp/daozi-shot.png', { wx: null }), false)
}

/* ------------------------------------------------------------------ */
console.log('\n' + '='.repeat(72))
console.log(`${checks - failures}/${checks} 项通过${failures ? `，${failures} 项失败` : ''}`)
console.log('='.repeat(72))

if (failures) process.exitCode = 1
