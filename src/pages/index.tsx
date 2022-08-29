import { defineComponent } from 'vue'
import { RouterView } from 'vue-router'
import { CommonLayout } from '../components'

const MainLayout = defineComponent({
  name: 'MainLayout',
  setup() {
    return () => (
      <CommonLayout>
        <RouterView />
      </CommonLayout>
    )
  }
})

export default MainLayout
