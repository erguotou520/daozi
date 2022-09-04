import { defineComponent, onMounted, onUnmounted } from 'vue'

const ResizeDetection = defineComponent({
  name: 'ResizeDetection',
  setup(props, ctx) {
    const calcBaseFontSize = () => {
      document.documentElement.style.fontSize = `${document.body.clientWidth / 375 * 16}px`
    }

    onMounted(() => {
      calcBaseFontSize()
      document.addEventListener('resize', calcBaseFontSize)
    })

    onUnmounted(() => {
      document.removeEventListener('resize', calcBaseFontSize)
    })

    return () => ctx.slots.default?.()
  }
})

export default ResizeDetection
