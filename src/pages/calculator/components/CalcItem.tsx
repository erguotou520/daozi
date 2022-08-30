import { defineComponent } from 'vue'

const CalcItem = defineComponent({
  name: 'CalcItem',
  props: {
    selected: {
      type: Boolean,
      default: false
    }
  },
  setup(props, ctx) {
    return () => (
      <div class="p-1px w-1/5">
        <div
          class={[
            'h-10 flex items-center justify-center text-title border-1px border-solid border-border bg-gray-200 text-sm',
            props.selected ? 'bg-green text-white border-green-700' : ''
          ]}
        >
          {ctx.slots.default?.()}
        </div>
      </div>
    )
  }
})

export default CalcItem
