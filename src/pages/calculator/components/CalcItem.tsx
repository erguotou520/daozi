import { defineComponent } from 'vue'

const CalcItem = defineComponent({
  name: 'CalcItem',
  inheritAttrs: false,
  props: {
    selected: {
      type: Boolean,
      default: false
    },
    point: {
      type: Number
    }
  },
  emits: ['click'],
  setup(props, ctx) {
    return () => (
      <div class="p-1px w-1/5">
        <div
          class={[
            'relative h-10 flex items-center justify-center border-1px border-solid text-sm select-none text-center',
            props.selected ? '!bg-green-500 !text-white !border-green-700' : 'bg-gray-200 text-title border-border',
            ctx.attrs['class']
          ]}
          onClick={() => ctx.emit('click')}
        >
          {ctx.slots.default?.()}
          {props.point && <span class="right-0.5 bottom-0.5 text-dark-200 text-opacity-15 text-10px absolute">{props.point}</span>}
        </div>
      </div>
    )
  }
})

export default CalcItem
