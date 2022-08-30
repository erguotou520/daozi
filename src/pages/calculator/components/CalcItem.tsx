import { defineComponent } from 'vue'

const CalcItem = defineComponent({
  name: 'CalcItem',
  props: {
    selected: {
      type: Boolean,
      default: false
    }
  },
  emits: ['click'],
  setup(props, ctx) {
    return () => (
      <div class="p-1px w-1/5">
        <div
          class={[
            'h-10 flex items-center justify-center border-1px border-solid text-sm',
            props.selected ? 'bg-green-500 text-white border-green-700' : 'bg-gray-200 text-title border-border'
          ]}
          onClick={() => ctx.emit('click')}
        >
          {ctx.slots.default?.()}
        </div>
      </div>
    )
  }
})

export default CalcItem
