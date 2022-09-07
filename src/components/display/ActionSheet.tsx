import { mount } from '@/utils/mount'
import { defineComponent, PropType, ref } from 'vue'

type ActionSheetItem = {
  title: string
  key: string
}

const ActionSheet = defineComponent({
  name: 'ActionSheet',
  props: {
    visible: {
      type: Boolean
    },
    items: {
      type: Array as PropType<ActionSheetItem[]>,
      required: true
    }
  },
  emits: ['confirm', 'update:visible'],
  setup(props, ctx) {
    const selected = ref<string | null>()

    const cancel = () => {
      selected.value = null
      ctx.emit('update:visible', false)
    }

    const confirm = () => {
      ctx.emit('confirm', selected.value)
      cancel()
    }

    return () =>
      props.visible ? (
        <div class="bg-black bg-opacity-10 top-0 right-0 bottom-0 left-0 z-99 fixed">
          <div class="bg-white divide-y-2 right-0 bottom-0 left-0 absolute">
            {props.items.map(item => (
              <div
                key={item.key}
                class={[
                  'text-center text-sm py-3 text-dark-500 select-none',
                  item.key === selected.value ? 'bg-green-500 !text-white' : ''
                ]}
                onClick={() => (selected.value = item.key)}
              >
                {item.title}
              </div>
            ))}
            <div class="flex divide-x-1px items-center">
              <div class="flex-1 text-center text-sm py-3 text-red-500" onClick={cancel}>
                取消
              </div>
              <div class="flex-1 text-center text-sm py-3 text-green-500" onClick={confirm}>
                确定
              </div>
            </div>
          </div>
        </div>
      ) : null
  }
})

export default ActionSheet

// export function showActionSheet({items, onClick }: {
//   items: ActionSheetItem[],
//   onClick: (key: string) => void
// }) {
//   mount(ActionSheet, { props: { items, onClick } })
// }
