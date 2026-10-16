import { defineComponent, onMounted, onUnmounted } from 'vue'

/**
 * 视口高度同步。
 *
 * 之前这里按 `clientWidth / 375` 缩放根字号，桌面端会被放大 3~4 倍，
 * 整个布局随之「变大变乱」。现在只在根节点写一个 `--app-vh`，
 * 解决移动端浏览器工具栏导致的 100vh 偏差，字号交给正常响应式排版。
 */
const ResizeDetection = defineComponent({
  name: 'ResizeDetection',
  setup(props, ctx) {
    const sync = () => {
      document.documentElement.style.setProperty('--app-vh', `${window.innerHeight}px`)
    }

    onMounted(() => {
      sync()
      window.addEventListener('resize', sync)
      window.addEventListener('orientationchange', sync)
    })

    onUnmounted(() => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
    })

    return () => ctx.slots.default?.()
  }
})

export default ResizeDetection
