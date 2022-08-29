import { defineComponent } from 'vue'
import TheHeader, { TheHeaderProps } from './Header'

const CommonLayout = defineComponent({
  name: 'CommonLayout',
  props: {
    ...TheHeaderProps
  },
  setup(props, ctx) {
    return () => (
      <div class="flex flex-col h-screen">
        <TheHeader {...props} />
        {ctx.slots.default?.()}
      </div>
    )
  }
})

export default CommonLayout
