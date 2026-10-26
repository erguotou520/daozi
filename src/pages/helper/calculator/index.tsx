import { computed, defineComponent, ref } from 'vue'
import { useTitle } from '@/hooks'
import {
  EMPTY_SELECTION,
  PAIR_OPTIONS,
  TONG_OPTIONS,
  ZHIZI_OPTIONS,
  bigWinOptions,
  extraOptions,
  moziOptions,
  scoreManualSelection,
  type ManualSelection,
  type MoziOption
} from '@/game/manual'
import CalcChip from './components/CalcChip'
import CalcSection from './components/CalcSection'

type PickKey = 'pairs' | 'zhizi' | 'tong'
type ListKey = 'extras' | 'mozi' | 'bigWin'

const freshSelection = (): ManualSelection => ({
  ...EMPTY_SELECTION,
  extras: [],
  mozi: [],
  bigWin: []
})

const CalculatorPage = defineComponent({
  name: 'CalculatorPage',
  setup() {
    useTitle('算分')

    const selection = ref<ManualSelection>(freshSelection())
    const extras = extraOptions()
    const moziTable = moziOptions()
    const bigWins = bigWinOptions()
    const result = computed(() => scoreManualSelection(selection.value))

    const pick = (key: PickKey, value: number) => {
      selection.value = { ...selection.value, [key]: selection.value[key] === value ? null : value }
    }

    const toggle = (key: ListKey, name: string) => {
      const list = selection.value[key]
      selection.value = {
        ...selection.value,
        [key]: list.includes(name) ? list.filter(item => item !== name) : [...list, name]
      }
    }

    // 同一手牌只会是一种成牌方式：自摸 / 自摸压当 / 枯只压 三选一
    const toggleMozi = (option: MoziOption) => {
      const list = selection.value.mozi
      if (list.includes(option.name)) {
        selection.value = { ...selection.value, mozi: list.filter(name => name !== option.name) }
        return
      }
      const group = option.exclusiveGroup
      const kept = group
        ? list.filter(name => moziTable.find(item => item.name === name)?.exclusiveGroup !== group)
        : list
      selection.value = { ...selection.value, mozi: [...kept, option.name] }
    }

    const clear = () => {
      selection.value = freshSelection()
    }

    const hasSelection = computed(
      () =>
        selection.value.pairs !== null ||
        selection.value.zhizi !== null ||
        selection.value.tong !== null ||
        selection.value.extras.length > 0 ||
        selection.value.mozi.length > 0 ||
        selection.value.bigWin.length > 0
    )

    return () => {
      const data = result.value
      return (
        <div class="flex min-h-0 flex-1 flex-col">
          {/* 结果条：一直贴在顶上，算分时不用来回滚 */}
          <div class="result-bar sticky top-14 z-10 px-5 py-3.5">
            <div class="flex items-end justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-baseline gap-1.5">
                  {data.isBigWin ? (
                    <span class="font-serif text-[2.1rem] leading-none text-vermillion">大拿</span>
                  ) : (
                    <>
                      <span class="font-serif text-[2.1rem] leading-none text-ivory">{data.total}</span>
                      <span class="text-[12px] text-mist">点</span>
                    </>
                  )}
                </div>
                <div class="mt-1.5 truncate text-[11px] text-mist">
                  {data.isBigWin
                    ? `大拿不算点数${data.moziUnits > 0 ? ` · 摸子 ${data.moziBig} 大 ${data.moziSmall} 小` : ''}`
                    : `${data.multiplier > 1 ? `${data.subtotal} 点 × 2` : `${data.subtotal} 点`}${data.moziUnits > 0 ? ` · 摸子 ${data.moziBig} 大 ${data.moziSmall} 小` : ''}`}
                </div>
              </div>
              <div class="shrink-0 text-right">
                <div class="flex items-baseline justify-end gap-1">
                  <span class="font-serif text-[1.4rem] leading-none text-brass">{data.perOpponent}</span>
                  <span class="text-[10px] text-mist">元/家</span>
                </div>
                <div class="mt-2 text-[11px] text-mist">三家合计 {data.moneyTotal}</div>
              </div>
            </div>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-28">
            <CalcSection title="对子" hint="碰 1 / 暗刻 2 / 杠 2">
              {PAIR_OPTIONS.map(value => (
                <CalcChip
                  key={value}
                  label={`${value} 对`}
                  point={value}
                  selected={selection.value.pairs === value}
                  onClick={() => pick('pairs', value)}
                />
              ))}
            </CalcSection>

            <CalcSection title="只子" hint="同一门 8 张起">
              {ZHIZI_OPTIONS.map(value => (
                <CalcChip
                  key={value}
                  label={`${value} 张`}
                  point={value - 7}
                  selected={selection.value.zhizi === value}
                  onClick={() => pick('zhizi', value)}
                />
              ))}
            </CalcSection>

            <CalcSection title="通" hint="同一数字跨两门 5 张起">
              {TONG_OPTIONS.map(value => (
                <CalcChip
                  key={value}
                  label={`${value} 通`}
                  point={value}
                  selected={selection.value.tong === value}
                  onClick={() => pick('tong', value)}
                />
              ))}
            </CalcSection>

            <CalcSection title="加点子" hint="符合多少就加多少，没有互斥" columns={3}>
              {extras.map(option => (
                <CalcChip
                  key={option.name}
                  label={option.name}
                  point={option.points}
                  hint={option.hint}
                  selected={selection.value.extras.includes(option.name)}
                  onClick={() => toggle('extras', option.name)}
                />
              ))}
            </CalcSection>

            <CalcSection title="摸子" hint="大摸子 10 元 / 小摸子 5 元" columns={2}>
              {moziTable.map(option => (
                <CalcChip
                  key={option.name}
                  label={option.name}
                  point={option.points}
                  hint={option.hint}
                  selected={selection.value.mozi.includes(option.name)}
                  onClick={() => toggleMozi(option)}
                />
              ))}
            </CalcSection>

            <CalcSection title="大拿" hint="命中即大拿，每家 40 元" columns={2}>
              {bigWins.map(name => (
                <CalcChip
                  key={name}
                  label={name}
                  selected={selection.value.bigWin.includes(name)}
                  onClick={() => toggle('bigWin', name)}
                />
              ))}
            </CalcSection>

            {/* 明细 */}
            <section class="brass-card mt-8 rounded-2xl p-4">
              <div class="mb-2.5 flex items-center gap-2">
                <h2 class="font-serif text-[12px] tracking-[0.3em] text-brass">明细</h2>
                {hasSelection.value && (
                  <button type="button" class="ghost-btn ml-auto rounded-full px-3 py-1 text-[11px]" onClick={clear}>
                    清空
                  </button>
                )}
              </div>
              <div class="space-y-1.5 text-[12px] leading-5 text-ivory" style={{ opacity: 0.85 }}>
                {data.lines.map((line, index) => (
                  <div key={index} class={index === data.lines.length - 1 ? 'text-brass' : ''}>
                    {line}
                  </div>
                ))}
              </div>
              {data.isBigWin && (
                <div class="mt-3 text-[11px] leading-5 text-mist">
                  大拿原因：{data.bigWinReasons.join('；')}
                </div>
              )}
            </section>
          </div>
        </div>
      )
    }
  }
})

export default CalculatorPage
