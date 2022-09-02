import { useTitle } from '@/hooks'
import { convertNumberToChinese, omitArray } from '@/utils'
import { computed, defineComponent, Ref, ref } from 'vue'
import CalcGroup from './components/CalcGroup'
import CalcItem from './components/CalcItem'

// 对子数
const pairList = [1, 2, 3, 4]
// 只子数
const countList = [8, 9, 10, 11, 12, 13, 14]
// 连通数
const sameList = [5, 6, 7, 8]
// 额外加分
const extraList = ['小连号', '大连号', '棒棒', '不动手', '四活', '草一色', '对对胡', '七对', '大吊车', '老小对']
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
  '三大坎',
  '乱分'
]

// 加点子中互斥的牌型
const mutexedExtra = [
  ['小连号', '大连号', '对对胡', '七对'],
  ['大连号', '棒棒', '对对胡'],
  ['四活', '对对胡']
] as const

// 单独点子数
const extraScoreMap = {
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

const CalculatorPage = defineComponent({
  name: 'CalculatorPage',
  setup(props, ctx) {
    useTitle('计算器')
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

    /**
     * 切换选中/未选中
     * @param list 列表
     * @param item 选中的项
     * @param mutex 互斥选项 默认 false，只解决本组互斥性
     */
    const toggleSelected = (list: Ref<(string | number)[]>, item: string | number, mutex: boolean = false) => {
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
    }

    /**
     * 检验成牌互斥性
     * 1. 选中大拿则清空除摸子以外的牌
     * 2. 加点子里的一些互斥牌
     * @param list 列表
     * @param item 选中的项
     */
    const checkMutex = (list: Ref<(string | number)[]>, item: string | number) => {
      if (list === superSelected) {
        pairSelected.value = []
        countSelected.value = []
        sameSelected.value = []
      } else {
        if (superSelected.value.length) {
          superSelected.value = []
        }
        if (list === extraSelected) {
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
      // 对子
      if (pairSelected.value.length) {
        score.push(pairSelected.value[0])
      }
      // 只子
      if (countSelected.value.length) {
        score.push(countSelected.value[0] - 2)
      }
      // 通
      if (sameSelected.value.length) {
        score.push(countSelected.value[0])
      }
      // 额外点子
      if (extraSelected.value.length) {
        for (const item of extraSelected.value) {
          score.push(extraScoreMap[item as keyof typeof extraScoreMap])
        }
      }
      // 加倍
      const times: number[] = []
      // 加摸子
      const mozi: number[] = []
      if (moziSelected.value.length) {
        if (moziSelected.value.includes('枯只压')) {
          score.push(20)
          mozi.push(0.5)
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
          times.push(2)
          mozi.push(1)
        }
        if (moziSelected.value.includes('清水')) {
          mozi.push(1.5)
        }
      }
      return { isSuper, score, mozi, times }
    }

    const calcArray = (arr: number[]) => arr.reduce<number>((count, item) => count += item, 0)

    const scoreText = computed(() => {
      let scoreTxt = ''
      let moziTxt = ''
      const { isSuper, score, mozi, times } = calcScore()
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
            scoreTxt = `${times.length ? `${times.join(' * ')} * (` : ''}${score.join(' + ')}${times.length ? ')' : ''} = ${scoreCount}`
          }
        }
        if (mozi.length) {
          const moziCount = calcArray(mozi)
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
        return <div>
          {scoreDom}
          <div class="text-sm">{moziTxt}</div>
        </div>
      }
      return scoreDom
    })

    return () => (
      <div>
        <div class="flex bg-[#535455] bg-opacity-75 h-12 text-white px-4 items-center relative">
          {scoreText.value}
        </div>
        <CalcGroup title="对子数">
          {pairList.map(pair => (
            <CalcItem
              key={pair}
              selected={pairSelected.value.includes(pair)}
              onClick={() => toggleSelected(pairSelected, pair, true)}
            >
              {convertNumberToChinese(pair)}对
            </CalcItem>
          ))}
        </CalcGroup>
        <CalcGroup title="只子数">
          {countList.map(count => (
            <CalcItem
              key={count}
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
