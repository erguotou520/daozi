import { defineComponent } from 'vue'

/**
 * 分组标题：衬线小标题 + 一句说明，配上黄铜细线做节奏分隔。
 */
const CalcSection = defineComponent({
  name: 'CalcSection',
  props: {
    title: { type: String, required: true },
    hint: { type: String, default: '' },
    columns: { type: Number, default: 4 }
  },
  setup(props, ctx) {
    return () => (
      <section class="mt-7">
        <div class="mb-3 flex items-baseline gap-2.5">
          <h2 class="font-serif text-[13px] tracking-[0.3em] text-brass">{props.title}</h2>
          {props.hint && <span class="text-[10px] text-mist">{props.hint}</span>}
          <span class="brass-rule ml-auto h-px flex-1 self-center" />
        </div>
        <div
          class="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))` }}
        >
          {ctx.slots.default?.()}
        </div>
      </section>
    )
  }
})

export default CalcSection
