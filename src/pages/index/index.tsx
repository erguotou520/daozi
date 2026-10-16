import { defineComponent } from 'vue'
import { TileLink } from '@/components'
import { useTitle } from '@/hooks'

const HomePage = defineComponent({
  name: 'HomePage',
  setup() {
    useTitle('和县刀子')

    return () => (
      <div class="flex flex-1 flex-col px-7 pb-7 pt-16">
        <header class="rise">
          <div class="flex items-start gap-3">
            <h1 class="font-serif text-[2.5rem] leading-none tracking-[0.16em] text-ivory">和县刀子</h1>
            <span
              class="seal-in mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-vermillion font-serif text-[15px] leading-none text-ivory"
              style={{ transform: 'rotate(-8deg)', animationDelay: '240ms' }}
            >
              刀
            </span>
          </div>
          <p class="mt-5 max-w-[19rem] text-[13px] leading-[2] text-mist">
            缺一门，可碰可杠不可吃。
            <br />
            算点子、记摸子、记输赢。
          </p>
        </header>

        <div class="brass-rule mt-9 h-px w-full" />

        <nav class="mt-14 flex flex-1 items-center justify-center gap-6 pb-6">
          <TileLink url="/table" char="局" label="牌桌" size="lg" delay={80} class="mt-8" />
          <TileLink url="/calculator" char="算" label="算分" delay={170} class="-mt-1" />
          <TileLink url="/scoreboard" char="记" label="记分" delay={260} class="mt-12" />
        </nav>

        <footer class="mb-7 space-y-1 text-center text-[10px] leading-4 text-mist" style={{ opacity: 0.5 }}>
          <div>抵制不良游戏，拒绝盗版游戏。注意自我保护，谨防受骗上当。</div>
          <div>适度游戏益脑，沉迷游戏伤身。合理安排时间，享受健康生活。</div>
        </footer>
      </div>
    )
  }
})

export default HomePage
