import { defineComponent, PropType } from 'vue'

/**
 * 牌型按钮：未选中是暗底细黄铜线，选中变成一张象牙牌。
 */
const CalcChip = defineComponent({
  name: 'CalcChip',
  props: {
    label: { type: String, required: true },
    point: { type: Number },
    hint: { type: String, default: '' },
    selected: { type: Boolean, default: false },
    span: { type: Number as PropType<1 | 2>, default: 1 }
  },
  emits: ['click'],
  setup(props, ctx) {
    return () => (
      <button
        type="button"
        title={props.hint}
        class={[
          'chip flex h-12 items-center justify-center gap-1.5 rounded-xl px-2',
          props.span === 2 ? 'col-span-2' : '',
          props.selected ? 'chip-on' : ''
        ]}
        onClick={() => ctx.emit('click')}
      >
        <span class={['text-[13px] leading-none', props.selected ? 'font-medium' : '']}>{props.label}</span>
        {props.point !== undefined && props.point > 0 && (
          <span class={['text-[10px] leading-none', props.selected ? 'text-edge-dark' : 'text-brass-dim']}>
            {props.point}
          </span>
        )}
      </button>
    )
  }
})

export default CalcChip
