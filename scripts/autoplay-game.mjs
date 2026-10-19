/**
 * 自动打一整把牌：掷骰子 → 选缺门 → 摸牌 → 打牌 → 碰/杠/成 → 结算。
 *
 * 用法（先起无头 Chrome）：
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --headless=new --remote-debugging-port=9333 --user-data-dir=/tmp/cdp-daozi about:blank &
 *   CDP_PORT=9333 CDP_URL="http://localhost:5199/#/" node scripts/autoplay-game.mjs
 *
 * 输出：操作流水、终局状态、控制台报错；可选 CDP_SCREENSHOT 存终局截图。
 */

import { writeFileSync } from 'node:fs'

const PORT = process.env.CDP_PORT ?? '9333'
const URL_TO_OPEN = process.env.CDP_URL ?? 'http://localhost:5199/#/'
const SCREENSHOT = process.env.CDP_SCREENSHOT ?? ''
const WIDTH = Number(process.env.CDP_WIDTH ?? 1280)
const HEIGHT = Number(process.env.CDP_HEIGHT ?? 800)
const POLL = Number(process.env.CDP_POLL ?? 350)
const MAX_MS = Number(process.env.CDP_MAX_MS ?? 420000)
/** 连打几把；每把结算后自动点「下一把」/「本局结束」 */
const HANDS = Number(process.env.CDP_HANDS ?? 1)

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

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

  /** 收集一切报错：控制台 error、页面异常、未捕获 Promise */
  const errors = []
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' '))
    }
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      errors.push(message.params.entry.text)
    }
  })

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Log.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 2,
    mobile: false
  })
  // 时间戳要放在 hash 之前才是真正的文档导航；#/?x=1 只是同文档的 hash 变化，不刷新
  const base = URL_TO_OPEN.replace(/#.*$/, '')
  const hash = URL_TO_OPEN.includes('#') ? '#' + URL_TO_OPEN.split('#')[1] : ''
  const sep = base.includes('?') ? '&' : '?'
  await send('Page.navigate', { url: `${base}${sep}g=${Date.now()}${hash}` })
  await sleep(2500)

  const evaluate = async script => {
    const result = await send('Runtime.evaluate', { expression: script, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed')
    return result.result?.value
  }

  /** 找到第一个可见、可点的按钮，按文本匹配 */
  const FIND_BUTTON = text => `
    (() => {
      const wanted = ${JSON.stringify(text)}
      const buttons = [...document.querySelectorAll('button')]
      const match = buttons.find(b => !b.disabled && b.offsetParent !== null && b.textContent.trim() === wanted)
      if (match) { match.click(); return true }
      return false
    })()
  `

  const CLICK_HAND_TILE = `
    (() => {
      const tile = [...document.querySelectorAll('.hand-tile')].find(b => !b.disabled && b.offsetParent !== null)
      if (tile) { tile.click(); return true }
      return false
    })()
  `

  const STATE = `
    (() => {
      const text = document.body.innerText
      const buttons = [...document.querySelectorAll('button')]
      const nextButton = buttons.find(b => !b.disabled && b.offsetParent !== null && /^(下一把|本局结束|开第 \\d+ 局)$/.test(b.textContent.trim()))
      // 流局的结算卡上写的是「牌山摸完，本把不算输赢。」，不再出现「流局」两个字
      const over = /成牌|流局|牌山摸完/.test(text) && !!nextButton
      const roundOver = !!buttons.find(b => b.textContent.trim().startsWith('开第'))
      const meta = (text.match(/第 (\\d+) 局[\\s\\S]{0,6}第 (\\d+) 把/) ?? [])
      return {
        over,
        roundOver,
        nextLabel: nextButton ? nextButton.textContent.trim() : '',
        roundNo: meta[1] ?? '',
        handNo: meta[2] ?? '',
        points: (text.match(/[^\\n]*点[^\\n]*张/g) ?? []).slice(0, 4),
        turnText: (text.match(/轮到[^\\n]*/) ?? [''])[0],
        hasDraw: !![...document.querySelectorAll('button')].find(b => !b.disabled && b.textContent.trim() === '摸牌'),
        hasPlay: !![...document.querySelectorAll('button')].find(b => !b.disabled && b.textContent.trim() === '出牌'),
        handCount: document.querySelectorAll('.hand-tile').length,
        hasStart: !![...document.querySelectorAll('button')].find(b => !b.disabled && b.textContent.trim() === '掷骰子'),
        hasShortage: [...document.querySelectorAll('button')].some(b => !b.disabled && /^缺[万筒条]$/.test(b.textContent.trim())),
        claims: [...document.querySelectorAll('button')]
          .filter(b => !b.disabled && ['碰', '杠', '成', '过'].includes(b.textContent.trim()))
          .map(b => b.textContent.trim()),
        wall: (text.match(/牌山 (\\d+)/) ?? [])[1] ?? null,
        settleText: (() => {
          const nodes = [...document.querySelectorAll('div')]
          const panel = nodes.find(el => el.children.length > 0 && /元\\/家/.test(el.textContent) && el.textContent.length < 600)
          if (panel) return panel.textContent.replace(/\\s+/g, ' ').slice(0, 300)
          if (/流局/.test(text)) return (text.match(/[^\\n]*流局[^\\n]*/) ?? ['流局'])[0]
          if (/牌山摸完/.test(text)) return (text.match(/[^\\n]*牌山摸完[^\\n]*/) ?? ['流局'])[0]
          return ''
        })()
      }
    })()
  `

  const log = []
  const push = line => {
    log.push(line)
    console.log(line)
  }

  const started = Date.now()
  let handTilesPlayed = 0
  let claimsResolved = 0
  let shortagesChosen = 0
  let draws = 0
  let startClicked = false
  let overSeen = false
  let maxHand = 0
  let overHand = 0
  let settleShot = false
  let midShot = false
  let handsDone = 0

  while (Date.now() - started < MAX_MS) {
    await sleep(POLL)
    const state = await evaluate(STATE)
    if (state.handCount > maxHand) maxHand = state.handCount
    if (state.handCount > 14) overHand++

    // 对局中段截图（可选）：牌山消耗过阈值时拍一张
    const MID_SHOT = process.env.CDP_MID_SCREENSHOT ?? ''
    const MID_WALL = Number(process.env.CDP_MID_WALL ?? 0)
    if (MID_SHOT && MID_WALL && !midShot && state.wall !== null && Number(state.wall) <= MID_WALL && !state.over) {
      const shot = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(MID_SHOT, Buffer.from(shot.data, 'base64'))
      midShot = true
      push(`中段截图（牌山 ${state.wall}）：${MID_SHOT}`)
    }

    if (state.over) {
      if (!overSeen) {
        overSeen = true
        handsDone += 1
        push(`第 ${state.roundNo} 局第 ${state.handNo} 把结束（牌山剩余 ${state.wall}）`)
        push(`点数：${state.points.join(' / ')}`)
        if (SCREENSHOT && !settleShot) {
          const shot = await send('Page.captureScreenshot', { format: 'png' })
          writeFileSync(SCREENSHOT, Buffer.from(shot.data, 'base64'))
          settleShot = true
          push(`终局截图：${SCREENSHOT}`)
        }
        if (handsDone >= HANDS) break
      }
      // 继续下一把（局末会先出现总账，再点「开第 N 局」）
      if (state.roundOver) {
        const summary = await evaluate(`(() => {
          const node = [...document.querySelectorAll('div')].find(el => /局结束/.test(el.textContent) && el.textContent.length < 400)
          return node ? node.textContent.replace(/\\s+/g, ' ').trim() : ''
        })()`)
        push(`第 ${state.roundNo} 局结束，记总账：${summary}`)
        const done = await evaluate(`(() => {
          const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('开第'))
          if (!b) return false
          b.click()
          return true
        })()`)
        if (done) {
          overSeen = false
          settleShot = false
          startClicked = true
          continue
        }
        continue
      }
      if (state.nextLabel) {
        const done = await evaluate(FIND_BUTTON(state.nextLabel))
        if (done) {
          overSeen = false
          settleShot = false
          startClicked = true
          continue
        }
      }
      continue
    }

    // 开局（页面是异步路由，按钮可能晚一点才出现，所以放在循环里点）
    if (state.hasStart) {
      const done = await evaluate(FIND_BUTTON('掷骰子'))
      if (done && !startClicked) {
        startClicked = true
        push('掷骰子开局')
      }
      continue
    }

    // 选缺门：选手牌最少的一门（页面按钮顺序固定 万筒条，这里直接选第一个也行，点「缺筒」更有区分度）
    if (state.hasShortage) {
      const done = await evaluate(FIND_BUTTON('缺筒')) || await evaluate(FIND_BUTTON('缺万')) || await evaluate(FIND_BUTTON('缺条'))
      if (done) {
        shortagesChosen++
        push(`已选缺门（第 ${shortagesChosen} 次点击）`)
        continue
      }
    }

    // 接牌表态：优先 成，其次 碰/杠，都不要就 过
    if (state.claims.length > 0) {
      const pick = state.claims.includes('成') ? '成' : state.claims.includes('碰') ? '碰' : state.claims.includes('杠') ? '杠' : '过'
      const done = await evaluate(FIND_BUTTON(pick))
      if (done) {
        claimsResolved++
        push(`接牌表态：${pick}（第 ${claimsResolved} 次）`)
        continue
      }
    }

    // 我的回合：先摸牌，有牌可打就打一张
    if (state.hasDraw) {
      const done = await evaluate(FIND_BUTTON('摸牌'))
      if (done) {
        draws++
        continue
      }
    }

    // 东家首巡：手里已经 14 张，直接出牌
    if (state.hasPlay) {
      const done = await evaluate(FIND_BUTTON('出牌'))
      if (done) {
        draws++
        continue
      }
    }

    if (state.turnText.includes('轮到你')) {
      const done = await evaluate(CLICK_HAND_TILE)
      if (done) {
        handTilesPlayed++
        continue
      }
    }
  }

  const finalState = await evaluate(STATE)
  push(`统计：摸牌 ${draws} 次 · 打牌 ${handTilesPlayed} 次 · 接牌表态 ${claimsResolved} 次`)
  push(`手牌张数峰值 ${maxHand}${overHand ? ` · 出现 ${overHand} 次相公` : '（无相公）'}`)
  push(`控制台报错 ${errors.length} 条${errors.length ? '：' + errors.slice(0, 5).join(' | ') : ''}`)
  if (finalState.settleText) push(`结算：${finalState.settleText}`)
  console.log('FINAL ' + JSON.stringify(finalState))

  ws.close()
  if (errors.length > 0) process.exitCode = 2
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
