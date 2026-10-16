/**
 * 用 Chrome DevTools Protocol 检查页面布局 / 截图 / 跑交互脚本。
 *
 * 用法：
 *   CDP_PORT=9333 node scripts/inspect-page.mjs <url> [表达式]
 *   CDP_WIDTH=390 CDP_HEIGHT=844 CDP_SCREENSHOT=/tmp/a.png node scripts/inspect-page.mjs "http://localhost:5199/#/"
 *   CDP_FULL=1 ... 整页截图
 *
 * 需要先起一个带 --remote-debugging-port 的无头 Chrome（独立端口 + user-data-dir，
 * 别去碰其它应用已经占用的 9222）。
 */

import { writeFileSync } from 'node:fs'

const [url, expression] = process.argv.slice(2)
const PORT = process.env.CDP_PORT ?? '9333'
const WIDTH = Number(process.env.CDP_WIDTH ?? 390)
const HEIGHT = Number(process.env.CDP_HEIGHT ?? 844)
const SCREENSHOT = process.env.CDP_SCREENSHOT
const FULL = process.env.CDP_FULL === '1'
const WAIT = Number(process.env.CDP_WAIT ?? 1800)

const DEFAULT_EXPRESSION = `JSON.stringify({
  viewport: { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight },
  bodyScrollWidth: document.body.scrollWidth,
  bodyScrollHeight: document.body.scrollHeight,
  htmlFontSize: getComputedStyle(document.documentElement).fontSize,
  shellWidth: Math.round(document.querySelector('.app-shell')?.getBoundingClientRect().width ?? 0),
  overflowing: [...document.querySelectorAll('body *')]
    .map(el => {
      const rect = el.getBoundingClientRect()
      return { tag: el.tagName, cls: String(el.className || '').slice(0, 46), right: Math.round(rect.right), w: Math.round(rect.width) }
    })
    .filter(item => item.right > document.documentElement.clientWidth + 1)
    .slice(0, 8)
}, null, 2)`

const main = async () => {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const target = targets.find(item => item.type === 'page') ?? targets[0]
  if (!target) throw new Error('没有可用的页面目标')

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))

  let nextId = 1
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      const onMessage = event => {
        const message = JSON.parse(event.data)
        if (message.id !== id) return
        ws.removeEventListener('message', onMessage)
        if (message.error) reject(new Error(JSON.stringify(message.error)))
        else resolve(message.result)
      }
      ws.addEventListener('message', onMessage)
      ws.send(JSON.stringify({ id, method, params }))
    })

  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 2,
    mobile: true
  })
  await send('Page.navigate', { url })
  await new Promise(resolve => setTimeout(resolve, WAIT))

  const evaluate = async script => {
    const result = await send('Runtime.evaluate', { expression: script, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result?.value
  }

  const value = await evaluate(expression ?? DEFAULT_EXPRESSION)
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))

  if (SCREENSHOT) {
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: FULL,
      ...(FULL ? { clip: { x: 0, y: 0, width: WIDTH, height: Number(await evaluate('document.body.scrollHeight')), scale: 2 } } : {})
    })
    writeFileSync(SCREENSHOT, Buffer.from(shot.data, 'base64'))
    console.log(`截图已保存：${SCREENSHOT}`)
  }

  ws.close()
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
