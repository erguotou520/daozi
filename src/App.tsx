import { defineComponent } from 'vue'
import { RouterView } from 'vue-router'
import { ResizeDetection } from './components'

const App = defineComponent({
  name: 'App',
  setup() {
    return () => (
      <ResizeDetection>
        <RouterView />
      </ResizeDetection>
    )
  }
})

export default App
