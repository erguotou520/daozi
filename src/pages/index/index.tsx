import { defineComponent } from 'vue'
import { AppCard } from '@/components'
import calculatorIcon from '@/assets/calculator.png'
import scoreboardIcon from '@/assets/scoreboard.png'

const HomePage = defineComponent({
  name: 'HomePage',
  setup() {
    return () => (
      <>
        <div>
          <AppCard title="计算器" img={calculatorIcon} url="/calculator" />
          <AppCard title="记分板" img={scoreboardIcon} url="/scoreboard" />
        </div>
        <div class="text-xs text-desc text-center right-2 bottom-2 left-2 text-opacity-75 fixed">
          <div>抵制不良游戏，拒绝盗版游戏。注意自我保护，谨防受骗上当。</div>
          <div>适度游戏益脑，沉迷游戏伤身。合理安排时间，享受健康生活。</div>
        </div>
      </>
    )
  }
})

export default HomePage
