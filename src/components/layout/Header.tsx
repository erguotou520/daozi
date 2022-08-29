import { computed, defineComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LeftOutlined } from '../icons'

export const TheHeaderProps = {
  title: {
    type: String,
    default: '和县刀子'
  }
} as const

const TheHeader = defineComponent({
  name: 'TheHeader',
  props: TheHeaderProps,
  setup(props, ctx) {
    const route = useRoute()
    const router = useRouter()

    const isHomepage = computed(() => route.path === '/')

    const back = () => {
      router.back()
    }

    return () => (
      <div class="bg-primary flex h-12 items-center">
        <div
          class={[
            'w-12 h-12 flex items-center justify-center flex-shrink-0',
            isHomepage.value ? 'opacity-0 pointer-events-none' : ''
          ]}
          onClick={back}
        >
          <LeftOutlined />
        </div>
        <div class="flex-1 text-center text-white px-10 truncate">{props.title}</div>
        <div class="flex-shrink-0 w-12"></div>
      </div>
    )
  }
})

export default TheHeader
