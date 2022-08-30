import { defineComponent } from 'vue'
import { RouterView } from 'vue-router'
import { CommonLayout, ResizeDetection } from './components'

const App = defineComponent({
  name: 'App',
  setup() {
    return () => (
      <ResizeDetection>
        <CommonLayout>
          <RouterView />
        </CommonLayout>
      </ResizeDetection>
    )
  }
})

export default App
