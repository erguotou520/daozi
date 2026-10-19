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
const APPID = process.env.WX_APPID || 'wx35973ee7b1494ae8'

if (!fs.existsSync(gamePath)) {
  console.error('找不到 release/wxgame/game.json，请先在 LayaAirIDE 里构建 wxgame')
  process.exit(1)
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
