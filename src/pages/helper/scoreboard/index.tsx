import { computed, defineComponent, onMounted, ref, watch } from 'vue'
import { useTitle } from '@/hooks'

const STORAGE_KEY = 'daozi:scoreboard'
const SEAT_NAMES = ['自己', '下家', '对面', '上家']

interface ScoreRecord {
  id: number
  winnerSeat: number
  /** 每家付多少元 */
  perOpponent: number
  note: string
  at: number
}

const load = (): ScoreRecord[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ScoreRecord[]) : []
  } catch {
    return []
  }
}

const ScoreboardPage = defineComponent({
  name: 'ScoreboardPage',
  setup() {
    useTitle('记分')

    const records = ref<ScoreRecord[]>([])
    const winnerSeat = ref<number | null>(null)
    const amount = ref('50')
    const note = ref('')

    onMounted(() => {
      records.value = load()
    })

    watch(
      records,
      value => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
        } catch {
          /* 隐私模式下写不进去，忽略 */
        }
      },
      { deep: true }
    )

    /** 按座位统计：赢了收三家，输的每家付一份 */
    const totals = computed(() => {
      const result = [0, 0, 0, 0]
      for (const record of records.value) {
        result[record.winnerSeat] += record.perOpponent * 3
        for (let seat = 0; seat < 4; seat += 1) {
          if (seat !== record.winnerSeat) result[seat] -= record.perOpponent
        }
      }
      return result
    })

    const handCount = computed(() => records.value.length)

    const add = () => {
      const perOpponent = Number(amount.value)
      if (winnerSeat.value === null || !Number.isFinite(perOpponent) || perOpponent <= 0) return
      records.value = [
        ...records.value,
        {
          id: Date.now(),
          winnerSeat: winnerSeat.value,
          perOpponent,
          note: note.value.trim(),
          at: Date.now()
        }
      ]
      note.value = ''
      winnerSeat.value = null
    }

    const remove = (id: number) => {
      records.value = records.value.filter(record => record.id !== id)
    }

    const reset = () => {
      records.value = []
    }

    const amountNumber = computed(() => Number(amount.value) || 0)
    const canAdd = computed(() => winnerSeat.value !== null && amountNumber.value > 0)

    return () => (
      <div class="flex flex-1 flex-col px-5 pb-8 pt-5">
        {/* 总账 */}
        <section class="brass-card rounded-2xl p-4">
          <div class="mb-3 flex items-baseline gap-2">
            <h2 class="font-serif text-[12px] tracking-[0.3em] text-brass">总账</h2>
            <span class="text-[10px] text-mist">已记 {handCount.value} 把</span>
            {handCount.value > 0 && (
              <button type="button" class="ghost-btn ml-auto rounded-full px-3 py-1 text-[11px]" onClick={reset}>
                清空
              </button>
            )}
          </div>
          <div class="grid grid-cols-2 gap-2">
            {SEAT_NAMES.map((name, seat) => {
              const value = totals.value[seat]
              return (
                <div key={name} class="flex items-baseline justify-between rounded-xl bg-white/4 px-3 py-2.5">
                  <span class="text-[12px] text-mist">{name}</span>
                  <span
                    class={[
                      'font-serif text-[1.25rem] leading-none',
                      value > 0 ? 'text-brass' : value < 0 ? 'text-ivory' : 'text-mist'
                    ]}
                    style={value < 0 ? { opacity: 0.72 } : undefined}
                  >
                    {value > 0 ? `+${value}` : value}
                  </span>
                </div>
              )
            })}
          </div>
        </section>

        {/* 记一把 */}
        <section class="mt-7">
          <div class="mb-3 flex items-baseline gap-2.5">
            <h2 class="font-serif text-[13px] tracking-[0.3em] text-brass">记一把</h2>
            <span class="brass-rule ml-auto h-px flex-1 self-center" />
          </div>

          <div class="space-y-3">
            <div class="grid grid-cols-4 gap-2">
              {SEAT_NAMES.map((name, seat) => (
                <button
                  key={name}
                  type="button"
                  class={['chip flex h-12 items-center justify-center rounded-xl text-[13px]', winnerSeat.value === seat ? 'chip-on' : '']}
                  onClick={() => (winnerSeat.value = winnerSeat.value === seat ? null : seat)}
                >
                  {name}
                </button>
              ))}
            </div>

            <div class="flex items-center gap-2">
              <div class="chip flex h-12 flex-1 items-center gap-2 rounded-xl px-3">
                <span class="text-[11px] text-mist">每家付</span>
                <input
                  class="min-w-0 flex-1 bg-transparent text-[15px] text-ivory outline-none"
                  inputmode="decimal"
                  value={amount.value}
                  onInput={event => (amount.value = (event.target as HTMLInputElement).value)}
                />
                <span class="text-[11px] text-mist">元</span>
              </div>
              <button
                type="button"
                disabled={!canAdd.value}
                class={[
                  'tile-face tile-press h-12 shrink-0 rounded-xl px-5 font-serif text-[14px] tracking-[0.2em] text-ink',
                  canAdd.value ? '' : 'opacity-40'
                ]}
                onClick={add}
              >
                记下
              </button>
            </div>

            <div class="chip flex h-11 items-center gap-2 rounded-xl px-3">
              <span class="text-[11px] text-mist">备注</span>
              <input
                class="min-w-0 flex-1 bg-transparent text-[13px] text-ivory outline-none placeholder:text-mist placeholder:opacity-50"
                placeholder="大拿 / 枯只压，可不填"
                value={note.value}
                onInput={event => (note.value = (event.target as HTMLInputElement).value)}
              />
            </div>
          </div>
        </section>

        {/* 明细 */}
        {records.value.length > 0 && (
          <section class="mt-8">
            <div class="mb-3 flex items-baseline gap-2.5">
              <h2 class="font-serif text-[13px] tracking-[0.3em] text-brass">明细</h2>
              <span class="brass-rule ml-auto h-px flex-1 self-center" />
            </div>
            <ul class="space-y-1.5">
              {[...records.value].reverse().map(record => (
                <li key={record.id} class="flex items-center gap-3 rounded-xl bg-white/4 px-3 py-2.5">
                  <span class="w-14 shrink-0 text-[12px] text-ivory">{SEAT_NAMES[record.winnerSeat]}</span>
                  <span class="text-[12px] text-mist">每家 {record.perOpponent} 元</span>
                  {record.note && <span class="truncate text-[11px] text-mist">{record.note}</span>}
                  <span class="ml-auto font-serif text-[13px] text-brass">+{record.perOpponent * 3}</span>
                  <button
                    type="button"
                    aria-label="删除"
                    class="shrink-0 text-[15px] leading-none text-mist"
                    style={{ opacity: 0.6 }}
                    onClick={() => remove(record.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {records.value.length === 0 && (
          <p class="mt-10 text-center text-[12px] leading-6 text-mist" style={{ opacity: 0.7 }}>
            选一个成牌的人，填上每家付多少，
            <br />
            账就记下了。
          </p>
        )}
      </div>
    )
  }
})

export default ScoreboardPage
