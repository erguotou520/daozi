import { defineComponent, onMounted, onUnmounted } from 'vue'

/**
 * 视口尺寸同步 + 强制横屏。
 *
 * - 只写 `--app-vh`（解决移动端浏览器工具栏导致的 100vh 偏差），字号交给正常响应式排版。
 * - 手机上竖着拿时，牌桌按「横屏」排版，再把整块舞台旋转 90° 显示：
 *   用户把手机逆时针转过来看就是正的。这样竖屏打开也是横屏牌桌，不会被压成竖条。
 *   `?landscape=1` / `?landscape=0` 可以强制开关（方便桌面调试）。
 */
const ResizeDetection = defineComponent({
  name: 'ResizeDetection',
  setup(props, ctx) {
    const sync = () => {
      const root = document.documentElement
      const vw = window.innerWidth
      const vh = window.innerHeight

      root.style.setProperty('--app-vh', `${vh}px`)

      const hash = window.location.hash
      const forceOn = /[?&]landscape=1/.test(hash)
      const forceOff = /[?&]landscape=0/.test(hash)
      const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
      const touch = (navigator.maxTouchPoints ?? 0) > 0
      const portrait = vh > vw
      const forced = !forceOff && portrait && (forceOn || coarse || touch)

      // 横屏舞台的尺寸：竖屏时宽高互换，再把舞台转 90° 铺满视口
      const stageW = forced ? vh : vw
      const stageH = forced ? vw : vh
      root.style.setProperty('--stage-w', `${stageW}px`)
      root.style.setProperty('--stage-h', `${stageH}px`)
      root.style.setProperty('--stage-x', `${vw}px`)
      root.style.setProperty('--app-vw', `${stageW}px`)
      root.classList.toggle('is-forced-landscape', forced)
    }

    onMounted(() => {
      sync()
      window.addEventListener('resize', sync)
      window.addEventListener('orientationchange', sync)
      // hash 路由切换时（比如 ?landscape=1）也重新算一次
      window.addEventListener('hashchange', sync)
    })

    onUnmounted(() => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
      window.removeEventListener('hashchange', sync)
    })

    return () => ctx.slots.default?.()
  }
})

export default ResizeDetection
