import { defineComponent } from 'vue'
import { RouterLink } from 'vue-router'
import { TileLink } from '@/components'
import { useTitle } from '@/hooks'

/**
 * 工具页（/helper）：算分和记分是辅助功能，主路由 / 直接是牌桌。
 */
const HelperPage = defineComponent({
  name: 'HelperPage',
  setup() {
    useTitle('工具')

    return () => (
      <div class="flex flex-1 flex-col px-7 pb-7 pt-16">
        <header class="rise">
          <div class="flex items-start gap-3">
            <h1 class="font-serif text-[2.5rem] leading-none tracking-[0.16em] text-ivory">工具</h1>
            <span
              class="seal-in mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-vermillion font-serif text-[15px] leading-none text-ivory"
              style={{ transform: 'rotate(-8deg)', animationDelay: '240ms' }}
            >
              刀
            </span>
          </div>
          <p class="mt-5 max-w-[19rem] text-[13px] leading-[2] text-mist">
            不打牌的时候用：
            <br />
            算点数、记输赢。
          </p>
        </header>

        <div class="brass-rule mt-9 h-px w-full" />

        <nav class="mt-14 flex flex-1 items-center justify-center gap-8 pb-6">
          <TileLink url="/helper/calculator" char="算" label="算分" size="lg" delay={80} class="mt-8" />
          <TileLink url="/helper/scoreboard" char="记" label="记分" delay={200} class="-mt-1" />
        </nav>

        <RouterLink
          to="/"
          class="mx-auto block rounded-full px-5 py-2 text-[12px] text-mist"
          style={{ border: '1px solid rgba(217, 180, 95, 0.22)' }}
        >
          回牌桌
        </RouterLink>

        <footer class="mb-3 mt-7 space-y-1 text-center text-[10px] leading-4 text-mist" style={{ opacity: 0.5 }}>
          <div>抵制不良游戏，拒绝盗版游戏。注意自我保护，谨防受骗上当。</div>
          <div>适度游戏益脑，沉迷游戏伤身。合理安排时间，享受健康生活。</div>
        </footer>
      </div>
    )
  }
})

export default HelperPage
