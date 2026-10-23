/**
 * 微信小游戏构建产物收尾（兜底脚本）：
 * - 首选方案是项目内的 build-templates/wxgame/，LayaAir 构建时会自动覆盖到 release/wxgame；
 *   appid / 横屏 / 私有配置都放在那里，正常构建不需要再手改。
 * - 这个脚本用于模板被 IDE 更新、或构建后仍被清空时的兜底：
 *   node scripts/fix-wxgame.mjs
 *
 * 可通过 WX_APPID 环境变量覆盖 appid。
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const dir = path.join(root, 'release/wxgame')

const gamePath = path.join(dir, 'game.json')
const configPath = path.join(dir, 'project.config.json')
const privatePath = path.join(dir, 'project.private.config.json')
const adapterPath = path.join(dir, 'weapp-adapter.js')
const APPID = process.env.WX_APPID || 'wx35973ee7b1494ae8'

if (!fs.existsSync(gamePath)) {
  console.error('找不到 release/wxgame/game.json，请先在 LayaAirIDE 里构建 wxgame')
  process.exit(1)
}

// LayaAir 3.4.1 的微信适配库会调用 wx.getGPU()；部分机型上该调用会让
// 小游戏在真机启动时直接失败。3.4.2 已修复；3.4.1 的产物在这里兜底去掉调用。
if (fs.existsSync(adapterPath)) {
  const adapter = fs.readFileSync(adapterPath, 'utf8')
  const fixed = adapter.replace(
    /var webgpu = typeof wx\.getGPU === 'function' \? wx\.getGPU\(\) : null;/,
    "var webgpu = null; // LayaAir 3.4.1: wx.getGPU() crashes some phones"
  )
  if (fixed === adapter) {
    if (adapter.includes('var webgpu = null; // LayaAir 3.4.1')) {
      console.log('wxgame: weapp-adapter.js already patched (wx.getGPU)')
    } else {
      console.warn('wxgame: weapp-adapter.js 未找到 wx.getGPU() 调用，跳过适配补丁')
    }
  } else {
    fs.writeFileSync(adapterPath, fixed)
    console.log('wxgame: patched weapp-adapter.js (wx.getGPU)')
  }
  const patched = fs.readFileSync(adapterPath, 'utf8')
  if (patched.includes('? wx.getGPU()')) {
    throw new Error('weapp-adapter.js 仍有 wx.getGPU() 调用，真机可能启动失败')
  }
}

const game = JSON.parse(fs.readFileSync(gamePath, 'utf8'))
game.deviceOrientation = 'landscape'
game.showStatusBar = false
fs.writeFileSync(gamePath, `${JSON.stringify(game, null, 2)}\n`)

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
config.appid = APPID
config.projectname = config.projectname || 'daozi'
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

const privateConfig = fs.existsSync(privatePath)
  ? JSON.parse(fs.readFileSync(privatePath, 'utf8'))
  : {}
privateConfig.appid = APPID
privateConfig.projectname = privateConfig.projectname || 'daozi'
fs.writeFileSync(privatePath, `${JSON.stringify(privateConfig, null, 2)}\n`)

console.log('wxgame: deviceOrientation = landscape, appid =', APPID)

// 网页版：bundle.js 是固定文件名，浏览器会按启发式缓存一直拿旧包。
// 构建后给 script 地址加一个缓存戳，普通刷新也能立刻换到新代码。
const webIndex = path.join(root, 'release/web/index.html')
if (fs.existsSync(webIndex)) {
  const stamp = Date.now().toString(36)
  const html = fs.readFileSync(webIndex, 'utf8')
  const next = html.replace(/(src="js\/bundle\.js)(\?[^"]*)?(")/, `$1?v=${stamp}$3`)
  if (next !== html) {
    fs.writeFileSync(webIndex, next)
    console.log('web: index.html bundle.js 缓存戳 =', stamp)
  } else {
    console.warn('web: 没找到 js/bundle.js 的 script 标签，跳过缓存戳')
  }
}
