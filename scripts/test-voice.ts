/**
 * 倒子麻将 · 语音播报编排回归
 *
 * 只测纯逻辑：牌名映射、成牌组合顺序、自摸/杠后赛花互斥、大拿压轴、条数上限。
 * 音频文件由 scripts/voice/generate.py 生成，不在这里断言。
 */

import {
  buildDiscardVoice,
  buildWinAnnouncement,
  tileVoice,
  voiceTierFor,
  type VoiceClip
} from '../layair/src/audio/announce'
import { scoreHand, type ScoreResult } from '../layair/src/game/score'
import { comboFor, comboPlan, VOICE_COMBOS } from '../layair/src/audio/combos'

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed += 1
    return
  }
  failed += 1
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`)
}

function equal(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  check(name, a === e, `期望 ${e}，实际 ${a}`)
}

function fakeScore(opts: {
  total?: number
  bigWin?: boolean
  patterns?: Record<string, boolean>
  items?: string[]
  mozi?: string[]
} = {}): ScoreResult {
  const items = (opts.items ?? ['成牌']).map(name => ({
    name,
    points: name === '成牌' ? 4 : 1,
    count: 1,
    detail: ''
  }))
  return {
    isWinningHand: true,
    problems: [],
    patterns: opts.patterns ?? {},
    points: {
      base: 4,
      items,
      subtotal: opts.total ?? 4,
      multipliers: [],
      multiplier: 1,
      total: opts.total ?? 4
    },
    bigWin: { isBigWin: !!opts.bigWin, reasons: [] },
    mozi: {
      items: (opts.mozi ?? []).map(name => ({ name, units: 1, detail: '' })),
      units: 0,
      multiplier: 1,
      big: 0,
      small: 0,
      money: 0
    },
    money: {
      pointMoneyPerOpponent: 0,
      moziMoneyPerOpponent: 0,
      bigWinMoneyPerOpponent: 0,
      perOpponentTotal: 0,
      shares: 3,
      payerCount: 3,
      amountPerPayer: 0,
      total: 0
    },
    details: []
  }
}

const ids = (clips: VoiceClip[]) => clips.map(clip => clip.id)
const tiers = (clips: VoiceClip[]) => clips.map(clip => clip.tier)

// —— 牌名 ——
const allTiles = [
  ...['万', '筒', '条'].flatMap(suit => Array.from({ length: 9 }, (_, i) => `${i + 1}${suit}`)),
  '东',
  '南',
  '西',
  '北',
  '中',
  '发',
  '白'
]
check('34 种牌都有独立语音', new Set(allTiles.map(tileVoice)).size === 34)
equal('一万', tileVoice('1万'), 'wan1')
equal('九筒', tileVoice('9筒'), 'tong9')
equal('一条', tileVoice('1条'), 'tiao1')
equal('红中', tileVoice('中'), 'red')
equal('白板', tileVoice('白'), 'white')
equal('打牌播报', buildDiscardVoice('5条'), [{ id: 'tiao5', tier: 1 }])

// —— 档位 ——
equal('平胡 1 档', voiceTierFor(fakeScore({ total: 8 }), false), 1)
equal('自摸 2 档', voiceTierFor(fakeScore({ total: 8 }), true), 2)
equal('清一色 2 档', voiceTierFor(fakeScore({ total: 14, patterns: { 清一色: true } }), false), 2)
equal('大拿 3 档', voiceTierFor(fakeScore({ total: 31, bigWin: true }), false), 3)
equal('50 点 3 档', voiceTierFor(fakeScore({ total: 50 }), false), 3)

// —— 单条 ——
equal('平胡', ids(buildWinAnnouncement({ selfDraw: false, afterKong: false, score: fakeScore() })), ['hu'])
equal('自摸', ids(buildWinAnnouncement({ selfDraw: true, afterKong: false, score: fakeScore() })), ['zimo'])
equal('抢杠', ids(buildWinAnnouncement({ selfDraw: false, afterKong: false, robKong: true, score: fakeScore() })), ['qianggang'])

// —— 自摸 + 杠后赛花互斥 ——
const afterKong = buildWinAnnouncement({
  selfDraw: true,
  afterKong: true,
  score: fakeScore({ total: 30, items: ['成牌', '杠开'], mozi: ['杠开'] })
})
equal('杠后赛花顶掉自摸', ids(afterKong), ['ganghousaihua'])
check('杠后赛花组合里没有自摸', !ids(afterKong).includes('zimo'))

// 抢杠时状态里可能还带着 afterKong，不能误喊成杠后赛花
const rob = buildWinAnnouncement({
  selfDraw: false,
  afterKong: true,
  robKong: true,
  score: fakeScore({ total: 30 })
})
equal('抢杠不误喊杠后赛花', ids(rob), ['qianggang'])

// —— 组合顺序：自摸第一、大拿压轴 ——
const big = buildWinAnnouncement({
  selfDraw: true,
  afterKong: false,
  score: fakeScore({
    total: 60,
    bigWin: true,
    patterns: { 清一色: true },
    items: ['成牌', '清一色', '对对胡', '碰'],
    mozi: ['枯只压', '三打一']
  })
})
equal('自摸清一色对对胡枯只压大拿', ids(big), ['zimo', 'qingyise', 'duiduihu', 'kuzhiya', 'dana'])
equal('整条同档', tiers(big), [3, 3, 3, 3, 3])
equal('大拿最后且不留间隔', big[big.length - 1].gapMs, 0)

const medium = buildWinAnnouncement({
  selfDraw: true,
  afterKong: false,
  score: fakeScore({
    total: 28,
    patterns: { 清一色: true },
    items: ['成牌', '清一色']
  })
})
equal('自摸清一色 2 档', tiers(medium), [2, 2])

// —— 乱分算清一色 ——
const luanfen = buildWinAnnouncement({
  selfDraw: false,
  afterKong: false,
  score: fakeScore({
    total: 40,
    bigWin: true,
    patterns: { 清一色: true, 乱分: true },
    items: ['成牌', '清一色']
  })
})
equal('乱分只喊清一色', ids(luanfen), ['hu', 'qingyise', 'dana'])

// —— 三打一：成牌不喊，触发时另有提示 ——
const three = buildWinAnnouncement({
  selfDraw: true,
  afterKong: false,
  score: fakeScore({
    total: 18,
    items: ['成牌', '三打一'],
    mozi: ['三打一']
  })
})
check('成牌不喊三打一', !ids(three).includes('sandayi'), ids(three).join(','))

// —— 连号 / 不动手不播 ——
const quiet = buildWinAnnouncement({
  selfDraw: true,
  afterKong: false,
  score: fakeScore({
    total: 28,
    patterns: { 清一色: true },
    items: ['成牌', '清一色', '小连号', '大连号', '双连号', '不动手']
  })
})
check('连号不播', !ids(quiet).includes('lianhao'), ids(quiet).join(','))
check('不动手不播', !ids(quiet).includes('budongshou'), ids(quiet).join(','))
check('去掉小牌型后仍保留清一色', ids(quiet).includes('qingyise'), ids(quiet).join(','))

// —— 条数上限 ——
const many = buildWinAnnouncement({
  selfDraw: true,
  afterKong: false,
  score: fakeScore({
    total: 60,
    bigWin: true,
    patterns: { 清一色: true, 七对: true, 一一九: true, 双通: true, 双四活: true, 三杠: true },
    items: ['成牌', '清一色', '对对胡']
  })
})
check('最多 5 条', many.length === 5, `实际 ${many.length}`)
equal('上限时大拿仍在最后', many[many.length - 1].id, 'dana')
check('上限时自摸仍在最前', many[0].id === 'zimo')

// —— 整句组合：常见组合必须命中，避免拼接停顿 ——
equal('自摸清一色走整句', comboFor([
  { id: 'zimo', tier: 2 },
  { id: 'qingyise', tier: 2 }
])?.id, 'c_zimo_qingyise')
equal('自摸清一色大拿走整句', comboFor([
  { id: 'zimo', tier: 3 },
  { id: 'qingyise', tier: 3 },
  { id: 'dana', tier: 3 }
])?.id, 'c_zimo_qingyise_dana')
equal('自摸枯只压走整句', comboFor([
  { id: 'zimo', tier: 2 },
  { id: 'kuzhiya', tier: 2 }
])?.id, 'c_zimo_kuzhiya')
equal('不动手不挡整句匹配', comboFor([
  { id: 'zimo', tier: 3 },
  { id: 'qingyise', tier: 3 },
  { id: 'budongshou', tier: 3 },
  { id: 'dana', tier: 3 }
])?.id, 'c_zimo_qingyise_dana')
equal('未知组合回退逐段', comboFor([
  { id: 'zimo', tier: 2 },
  { id: 'caoyise', tier: 2 }
]), null)
equal('接牌清一色 + 大拿：整句 + 补大拿', comboPlan([
  { id: 'hu', tier: 3 },
  { id: 'qingyise', tier: 3 },
  { id: 'dana', tier: 3 }
])?.suffix, ['dana'])
equal('整句已含大拿不补', comboPlan([
  { id: 'zimo', tier: 3 },
  { id: 'qingyise', tier: 3 },
  { id: 'dana', tier: 3 }
])?.suffix, [])
check('整句组合 id 不重复', new Set(VOICE_COMBOS.map(c => c.id)).size === VOICE_COMBOS.length)
check('整句组合 id 都有 3 档', VOICE_COMBOS.every(c => /^c_/.test(c.id)))

// —— 真实结算：清一色自摸 ——
const real = scoreHand({
  concealed: ['1万', '1万', '1万', '2万', '2万', '2万', '3万', '3万', '3万', '4万', '5万', '6万', '7万', '7万'],
  winTile: '7万',
  selfDraw: true
})
check('真实清一色成牌', real.isWinningHand, real.problems.join('；'))
const realClips = buildWinAnnouncement({ selfDraw: true, afterKong: false, score: real })
check('真实清一色会喊清一色', ids(realClips).includes('qingyise'), ids(realClips).join(','))
check('真实清一色自摸在最前', realClips[0].id === 'zimo')

// —— 真实结算：对对胡 ——
const realDui = scoreHand({
  concealed: ['1万', '1万', '1万', '2万', '2万', '2万', '3万', '3万', '3万', '4万', '4万', '4万', '5万', '5万'],
  winTile: '5万',
  selfDraw: true
})
const duiClips = buildWinAnnouncement({ selfDraw: true, afterKong: false, score: realDui })
check('真实对对胡会喊对对胡', ids(duiClips).includes('duiduihu'), ids(duiClips).join(','))

console.log(`\n语音播报：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
