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
    // 牌桌要铺开，不能塞进手机宽的那条列里
    const wide = computed(() => route.path.startsWith('/table'))

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
