import { defineComponent } from 'vue'

const CalcGroup = defineComponent({
  name: 'CalcGroup',
  props: {
    title: {
      type: String,
      required: true
    }
  },
  setup(props, ctx) {
    return () => (
      <div>
        <div class="text-desc text-sm pt-2 pb-1 pl-2">{props.title}</div>
        <div class="flex flex-wrap">
          {ctx.slots.default?.()}
        </div>
      </div>
    )
  }
})

export default CalcGroup
