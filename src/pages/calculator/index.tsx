import { useTitle } from '@/hooks'
import { convertNumberToChinese } from '@/utils'
import { defineComponent, ref } from 'vue'
import CalcGroup from './components/CalcGroup'
import CalcItem from './components/CalcItem'

// 对子数
const pairList = [1, 2, 3, 4]
// 只子数
const countList = [8, 9, 10, 11, 12, 13, 14]
// 联通数
const sameList = [5, 6, 7, 8]

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

    return () => (
      <div>
        <div class="flex bg-[#535455] bg-opacity-75 h-12 items-center relative"></div>
        <CalcGroup title="对子数">
          {pairList.map(pair => (
            <CalcItem key={pair}>{convertNumberToChinese(pair)}对</CalcItem>
          ))}
        </CalcGroup>
        <CalcGroup title="只子数">
          {countList.map(count => (
            <CalcItem key={count}>{convertNumberToChinese(count)}只</CalcItem>
          ))}
        </CalcGroup>
        <CalcGroup title="联通数">
          {sameList.map(same => (
            <CalcItem key={same}>{convertNumberToChinese(same)}通</CalcItem>
          ))}
        </CalcGroup>
        <CalcGroup title="加点子">
          <CalcItem>小连号</CalcItem>
          <CalcItem>大连号</CalcItem>
          <CalcItem>棒棒</CalcItem>
          <CalcItem>不动手</CalcItem>
          <CalcItem>四活</CalcItem>
          <CalcItem>草一色</CalcItem>
          <CalcItem>对对胡</CalcItem>
          <CalcItem>七对</CalcItem>
        </CalcGroup>
        <CalcGroup title="加摸子">
          <CalcItem>枯只压</CalcItem>
          <CalcItem>三打一</CalcItem>
          <CalcItem>自摸</CalcItem>
          <CalcItem>杠开</CalcItem>
          <CalcItem>清水</CalcItem>
        </CalcGroup>
        <CalcGroup title="大拿">
          <CalcItem>双连号</CalcItem>
          <CalcItem>双棒棒</CalcItem>
          <CalcItem>双通</CalcItem>
          <CalcItem>双四活</CalcItem>
          <CalcItem>一一九</CalcItem>
          <CalcItem>清一色</CalcItem>
          <CalcItem>双杠</CalcItem>
          <CalcItem>三杠</CalcItem>
          <CalcItem>三大坎</CalcItem>
          <CalcItem>乱分</CalcItem>
        </CalcGroup>
      </div>
    )
  }
})

export default CalculatorPage
