const ChineseNumberArray = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const ChineseUnitArray = ['', '十', '百', '千', '万']

/**
 * 数字转中文
 * @param num 数字
 */
export function convertNumberToChinese(num: number) {
  const str = num.toString()
  const len = str.length
  const sb: string[] = []
  for (let i = len - 1; i >= 0; i--) {
    const char = str[len - 1 - i]
    sb.push(`${ChineseNumberArray[+char]}${ChineseUnitArray[i]}`)
  }
  return sb
    .join('')
    .replace(/^零+/, '')
    .replace(/零+$/, '')
    .replace(/零+/g, '零')
    .replace(/^一十/, '十')
}
