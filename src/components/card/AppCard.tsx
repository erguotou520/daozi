import { defineComponent } from 'vue'
import { RouterLink } from 'vue-router'

const AppCard = defineComponent({
  name: 'AppCard',
  props: {
    img: {
      type: String,
      required: true
    },
    url: {
      type: String,
      required: true
    },
    title: {
      type: String,
      required: true
    }
  },
  setup(props, ctx) {

    return () => (
      <RouterLink to={props.url} class="flex-col m-4 p-3 inline-flex">
        <img src={props.img} class="rounded-lg h-16 w-16" />
        <div class="font-medium mt-2 text-title text-center w-16">{props.title}</div>
      </RouterLink>
    )
  }
})

export default AppCard
