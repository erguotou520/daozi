import { layoutKey } from '@/hooks'
import { computed, defineComponent, provide, ref } from 'vue'
import { useRoute } from 'vue-router'
import TheHeader, { TheHeaderProps } from './Header'

const CommonLayout = defineComponent({
  name: 'CommonLayout',
  props: {
    ...TheHeaderProps
  },
  setup(props, ctx) {
    const title = ref('和县刀子')
    const route = useRoute()
    // 主路由就是牌桌：全屏铺开，不套手机宽的列
    const wide = computed(() => route.path === '/')

    provide(layoutKey, {
      setTitle(v: string) {
        title.value = v
      }
    })

    return () => (
      <div class="felt-bg">
        <div class={wide.value ? 'wide-shell' : 'app-shell'}>
          <TheHeader title={title.value} />
          <main class="flex min-h-0 flex-1 flex-col">{ctx.slots.default?.()}</main>
        </div>
      </div>
    )
  }
})

export default CommonLayout
