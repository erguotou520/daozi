import { ActionSheet } from '@/components'
import { useTitle } from '@/hooks'
import { convertNumberToChinese, omitArray } from '@/utils'
import { computed, defineComponent, Ref, ref } from 'vue'
import CalcGroup from './components/CalcGroup'
import CalcItem from './components/CalcItem'

// TODO 单吊

// 对子数
const pairList = [1, 2, 3, 4]
// 只子数
const countList = [8, 9, 10, 11, 12]
// 连通数
const sameList = [5, 6, 7, 8]
// 额外加分
const extraList = [
  '压裆',
  '小连号',
  '大连号',
  '棒棒',
  '不动手',
  '四活',
  '草一色',
  '对对胡',
  '七对',
  '大吊车',
  '老小对'
]
// 加摸子
const moziList = ['枯只压', '三打一', '自摸(小)', '自摸(大)', '杠开', '清水']
// 大拿
const superList = [
  '双连号',
  '双棒棒',
  '双通',
  '双四活',
  '一一九',
  '清一色',
  '双杠',
  '三杠',
  '三大坎+同门2张',
  '乱分'
]

// 加点子中互斥的牌型
const mutexedExtra = [
  ['小连号', '大连号', '对对胡', '七对'],
  ['大连号', '棒棒', '对对胡'],
  ['四活', '对对胡']
]

// 单独点子数
const extraScoreMap = {
  压裆: 1,
  小连号: 5,
  大连号: 20,
  棒棒: 5,
  不动手: 5,
  四活: 10,
  草一色: 10,
  对对胡: 10,
  七对: 31,
  大吊车: 31,
  老小对: 5
} as const

// 摸子点子数
const moziScoreMap = {
  枯只压: 21,
  杠开: 5
} as const

const CalculatorPage = defineComponent({
  name: 'CalculatorPage',
  setup(props, ctx) {
    useTitle('计算器')
    const playerVisible = ref(false)
    // const timesArray = ref<number[]>([])
    // const valueArray = ref<number[]>([])
    // // 摸子 小摸子算0.5 大摸子算1
    // const moziArray = ref<number[]>([])
    const pairSelected = ref<number[]>([])
    const countSelected = ref<number[]>([])
    const sameSelected = ref<number[]>([])
    const extraSelected = ref<string[]>([])
    const moziSelected = ref<string[]>([])
    const superSelected = ref<string[]>([])
    // 最小的杂牌 5点
    const smallestSelected = ref(false)

    /**
     * 是否选了成牌
     */
    const toggleSmallest = () => {
      if (smallestSelected.value) {
        if (
          !(
            pairSelected.value.length ||
            countSelected.value.length ||
            sameSelected.value.length ||
            extraSelected.value.length ||
            moziSelected.value.length ||
            superSelected.value.length
          )
        ) {
          // 只要有成牌 就不可取消
          smallestSelected.value = false
        }
      } else {
        smallestSelected.value = true
      }
    }

    /**
     * 切换选中/未选中
     * @param list 列表
     * @param item 选中的项
     * @param mutex 互斥选项 默认 false，只解决本组互斥性
     */
    const toggleSelected = (
      list: Ref<(string | number)[]>,
      item: string | number,
      mutex: boolean = false
    ) => {
      const index = list.value.indexOf(item)
      if (index > -1) {
        list.value.splice(index, 1)
      } else {
        if (mutex === true) {
          list.value = [item]
        } else {
          list.value.push(item)
        }
        // 选中后校验和其它已选项之间的互斥性
        checkMutex(list, item)
      }
      // 自动选择成牌
      if (!smallestSelected.value) {
        if (pairSelected.value.length ||
          countSelected.value.length ||
          sameSelected.value.length ||
          extraSelected.value.length ||
          moziSelected.value.length ||
          superSelected.value.length) {
            smallestSelected.value = true
          }
      }
    }

    /**
     * 检验成牌互斥性
     * 1. 选中大拿则清空除摸子以外的牌
     * 2. 加点子里的一些互斥牌
     * @param list 列表
     * @param item 选中的项
     */
    const checkMutex = (list: Ref<(string | number)[]>, item: string | number) => {
      // 如果已选择成拍
      if (smallestSelected.value) {
        if (list !== moziSelected || ['杠开', '清水'].includes(item as string)) {
          smallestSelected.value = false
        }
      }
      // 草一色和通冲突
      if (item === '草一色') {
        sameSelected.value = []
      }
      if (list === sameSelected) {
        const index = extraSelected.value.indexOf('草一色')
        if (~index) {
          extraSelected.value.splice(index, 1)
        }
      }
      // 大拿牌
      if (list === superSelected) {
        pairSelected.value = []
        countSelected.value = []
        sameSelected.value = []
      } else {
        // 非大拿 清空大拿牌
        if (superSelected.value.length) {
          superSelected.value = []
        }
        if (list === extraSelected) {
          // 加点子之间的冲突
          for (const _list of mutexedExtra) {
            if (_list.includes(item as string)) {
              for (const _item of _list) {
                if (_item !== item) {
                  const index = list.value.indexOf(_item)
                  if (~index) {
                    list.value.splice(index, 1)
                  }
                }
              }
            }
          }
        }
      }
    }

    /**
     * 计算得分
     */
    const calcScore = () => {
      let isSuper = false
      // 直接大拿牌
      if (superSelected.value.length) {
        isSuper = true
      }
      let score = []
      // 成牌
      if (smallestSelected.value) {
        score.push(4)
      }
      // 对子
      if (pairSelected.value.length) {
        score.push(pairSelected.value[0])
      }
      // 只子
      if (countSelected.value.length) {
        score.push(countSelected.value[0] - 7)
      }
      // 通
      if (sameSelected.value.length) {
        score.push(sameSelected.value[0])
      }
      // 额外点子
      if (extraSelected.value.length) {
        for (const item of extraSelected.value) {
          score.push(extraScoreMap[item as keyof typeof extraScoreMap])
        }
      }
      // 点数加倍
      const times: number[] = []
      // 加摸子
      const mozi: number[] = []
      // 摸子加倍
      const moziTimes: number[] = []
      if (moziSelected.value.length) {
        if (moziSelected.value.includes('枯只压')) {
          score.push(21)
          mozi.push(1)
        }
        if (moziSelected.value.includes('三打一')) {
          mozi.push(0.5)
        }
        if (moziSelected.value.includes('自摸(小)')) {
          times.push(2)
          mozi.push(0.5)
        }
        if (moziSelected.value.includes('自摸(大)')) {
          times.push(2)
          mozi.push(1)
        }
        if (moziSelected.value.includes('杠开')) {
          score.push(5)
          times.push(2)
          mozi.push(1)
          moziTimes.push(2)
        }
        if (moziSelected.value.includes('清水')) {
          mozi.push(1.5)
        }
      }
      return { isSuper, score, mozi, times, moziTimes }
    }

    const calcArray = (arr: number[]) => arr.reduce<number>((count, item) => (count += item), 0)

    const scoreText = computed(() => {
      let scoreTxt = ''
      let moziTxt = ''
      const { isSuper, score, mozi, times, moziTimes } = calcScore()
      if (isSuper) {
        scoreTxt = '大拿'
      } else {
        // 2大牌
        if (score.includes(31) && score.includes(10)) {
          scoreTxt = '大拿'
        } else {
          const scoreCount = (times.length ? calcArray(times) : 1) * calcArray(score)
          if (scoreCount >= 50) {
            scoreTxt = '大拿'
          } else {
            scoreTxt = `${times.length ? `${times.join(' * ')} * (` : ''}${score.join(' + ')}${
              times.length ? ')' : ''
            } = ${scoreCount}`
          }
        }
        if (mozi.length) {
          const moziCount = (calcArray(moziTimes) || 1) * calcArray(mozi)
          // 大摸子
          const bigMozi = Math.floor(moziCount)
          // 小摸子
          const smallMozi = (moziCount - bigMozi) * 2
          const arr = []
          if (bigMozi) {
            arr.push(`${bigMozi}个大摸子`)
          }
          if (smallMozi) {
            arr.push(`${smallMozi}个小摸子`)
          }
          moziTxt = arr.join(' + ')
        }
      }
      const scoreDom = <div class="text-lg">{scoreTxt}</div>
      if (mozi.length) {
        return (
          <div>
            {scoreDom}
            <div class="text-sm">{moziTxt}</div>
          </div>
        )
      }
      return scoreDom
    })

    const save = () => {
      playerVisible.value = true
    }

    return () => (
      <div>
        <ActionSheet v-model:visible={playerVisible.value} items={[
          { title: '玩家1', key: 'player1' },
          { title: '玩家2', key: 'player2' },
          { title: '玩家3', key: 'player3' },
          { title: '玩家4', key: 'player4' },
        ]} onConfirm={console.log} />
        <div class="flex bg-[#535455] bg-opacity-75 h-12 text-white px-4 items-center relative">
          {scoreText.value}
          {smallestSelected.value && <button class="rounded bg-green-500 border-green-700 text-white text-sm py-1 px-2 top-2.5 right-2 absolute" onClick={save}>保存点子</button>}
        </div>
        <CalcGroup title="对子数">
          {pairList.map(pair => (
            <CalcItem
              key={pair}
              selected={pairSelected.value.includes(pair)}
              point={pair}
              onClick={() => toggleSelected(pairSelected, pair, true)}
            >
              {convertNumberToChinese(pair)}对
            </CalcItem>
          ))}
          <CalcItem
            class="bg-purple-100 border-purple-200"
            selected={smallestSelected.value}
            point={4}
            onClick={toggleSmallest}
          >
            成牌
          </CalcItem>
        </CalcGroup>
        <CalcGroup title="只子数">
          {countList.map(count => (
            <CalcItem
              key={count}
              point={count - 7}
              selected={countSelected.value.includes(count)}
              onClick={() => toggleSelected(countSelected, count, true)}
            >
              {convertNumberToChinese(count)}只
            </CalcItem>
          ))}
        </CalcGroup>
        <CalcGroup title="连通数">
          {sameList.map(same => (
            <CalcItem
              key={same}
              point={same}
              selected={sameSelected.value.includes(same)}
              onClick={() => toggleSelected(sameSelected, same, true)}
            >
              {convertNumberToChinese(same)}通
            </CalcItem>
          ))}
        </CalcGroup>
        <CalcGroup title="加点子">
          {extraList.map(extra => (
            <CalcItem
              key={extra}
              point={extraScoreMap[extra as keyof typeof extraScoreMap]}
              selected={extraSelected.value.includes(extra)}
              onClick={() => toggleSelected(extraSelected, extra)}
            >
              {extra}
            </CalcItem>
          ))}
        </CalcGroup>
        <CalcGroup title="加摸子">
          {moziList.map(mozi => (
            <CalcItem
              key={mozi}
              point={moziScoreMap[mozi as keyof typeof moziScoreMap]}
              selected={moziSelected.value.includes(mozi)}
              onClick={() => toggleSelected(moziSelected, mozi)}
            >
              {mozi}
            </CalcItem>
          ))}
        </CalcGroup>
        <CalcGroup title="大拿">
          {superList.map(sup => (
            <CalcItem
              key={sup}
              selected={superSelected.value.includes(sup)}
              onClick={() => toggleSelected(superSelected, sup, true)}
            >
              {sup}
            </CalcItem>
          ))}
        </CalcGroup>
      </div>
    )
  }
})

export default CalculatorPage
