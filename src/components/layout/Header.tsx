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
  setup(props) {
    const route = useRoute()
    const router = useRouter()

    // 首页不放头部，主视觉自己承担品牌
    const visible = computed(() => route.path !== '/')

    return () =>
      visible.value ? (
        <header class="header-veil sticky top-0 z-20 flex h-14 shrink-0 items-center gap-1 px-2">
          <button
            type="button"
            aria-label="返回"
            class="ghost-btn flex h-9 w-9 items-center justify-center rounded-full text-sm"
            onClick={() => router.back()}
          >
            <LeftOutlined />
          </button>
          <h1 class="min-w-0 flex-1 truncate px-3 text-center font-serif text-[15px] tracking-[0.3em] text-ivory">
            {props.title}
          </h1>
          <div class="h-9 w-9 shrink-0" />
        </header>
      ) : null
  }
})

export default TheHeader
