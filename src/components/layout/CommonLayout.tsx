import { layoutKey } from '@/hooks'
import { defineComponent, provide, ref } from 'vue'
import TheHeader, { TheHeaderProps } from './Header'

const CommonLayout = defineComponent({
  name: 'CommonLayout',
  props: {
    ...TheHeaderProps
  },
  setup(props, ctx) {
    const title = ref('和县刀子')

    provide(layoutKey, {
      setTitle(v: string) {
        title.value = v
      }
    })

    return () => (
      <div class="flex flex-col h-screen">
        <TheHeader title={title.value} />
        {ctx.slots.default?.()}
      </div>
    )
  }
})

export default CommonLayout
