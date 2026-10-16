import { defineComponent, PropType } from 'vue'
import { RouterLink } from 'vue-router'

/**
 * 首页入口：做成一张麻将牌的样子（象牙牌面 + 下沿厚度）。
 * 牌面是整套界面的记忆点，所以入口本身就用它，而不是通用卡片。
 */
const TileLink = defineComponent({
  name: 'TileLink',
  props: {
    url: { type: String, required: true },
    char: { type: String, required: true },
    label: { type: String, required: true },
    size: { type: String as PropType<'lg' | 'md'>, default: 'md' },
    delay: { type: Number, default: 0 }
  },
  setup(props) {
    return () => (
      <RouterLink
        to={props.url}
        class={[
          'tile-face tile-press rise relative flex flex-col items-center justify-center rounded-2xl',
          props.size === 'lg' ? 'h-[136px] w-[106px]' : 'h-[104px] w-[82px]'
        ]}
        style={{ animationDelay: `${props.delay}ms` }}
      >
        <span
          class="font-serif leading-none text-ink"
          style={{ fontSize: props.size === 'lg' ? '2.7rem' : '2.05rem' }}
        >
          {props.char}
        </span>
        <span
          class={[
            'text-edge-dark',
            props.size === 'lg' ? 'mt-3 text-[10px] tracking-[0.34em]' : 'mt-2.5 text-[10px] tracking-[0.3em]'
          ]}
        >
          {props.label}
        </span>
      </RouterLink>
    )
  }
})

export default TileLink
