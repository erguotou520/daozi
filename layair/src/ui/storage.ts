/**
 * 倒子麻将 · 本地存储
 *
 * 浏览器用 Laya.LocalStorage，微信小游戏优先用 wx 的同步存储。
 * 保存两样东西：
 * - 累计战绩（每家成牌次数/点数、摸子、输赢金额）
 * - 当前对局（牌局状态 + 结算面板），下次进入从当前继续
 */

const HISTORY_KEY = 'daozi.history.v1'
const GAME_KEY = 'daozi.game.v1'
const VOICE_KEY = 'daozi.voice.v1'

export interface SeatHistory {
  wins: number
  /** 成牌时那手牌的点数合计 */
  points: number
  moziBig: number
  moziSmall: number
  /** 输赢金额（元） */
  money: number
}

export interface HistoryState {
  seats: SeatHistory[]
  hands: number
  rounds: number
}

export interface SavedGame {
  board: any
  hand: any
  roundSummary: any
  dice: { a: number; b: number } | null
  shownDice: { a: number; b: number }
}

function wxStorage(): any {
  try {
    const wx = (globalThis as any).wx
    if (wx && typeof wx.getStorageSync === 'function') return wx
  } catch {
    // ignore
  }
  return null
}

function readRaw(key: string): any {
  try {
    const wx = wxStorage()
    if (wx) {
      const value = wx.getStorageSync(key)
      if (typeof value === 'string' && value) return JSON.parse(value)
      return value ?? null
    }
    const raw = Laya.LocalStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeRaw(key: string, value: any) {
  try {
    const wx = wxStorage()
    const text = JSON.stringify(value)
    if (wx) {
      wx.setStorageSync(key, text)
    } else {
      Laya.LocalStorage.setItem(key, text)
    }
  } catch {
    // 存储失败不影响游戏
  }
}

function removeRaw(key: string) {
  try {
    const wx = wxStorage()
    if (wx) wx.removeStorageSync?.(key)
    else Laya.LocalStorage.removeItem(key)
  } catch {
    // ignore
  }
}

export function emptySeatHistory(): SeatHistory {
  return { wins: 0, points: 0, moziBig: 0, moziSmall: 0, money: 0 }
}

export function createHistory(): HistoryState {
  return {
    seats: [emptySeatHistory(), emptySeatHistory(), emptySeatHistory(), emptySeatHistory()],
    hands: 0,
    rounds: 0
  }
}

export function loadHistory(): HistoryState {
  const saved = readRaw(HISTORY_KEY)
  const history = createHistory()
  if (saved && Array.isArray(saved.seats)) {
    for (let seat = 0; seat < 4; seat += 1) {
      const row = saved.seats[seat]
      if (!row) continue
      history.seats[seat] = {
        wins: Number(row.wins) || 0,
        points: Number(row.points) || 0,
        moziBig: Number(row.moziBig) || 0,
        moziSmall: Number(row.moziSmall) || 0,
        money: Number(row.money) || 0
      }
    }
    history.hands = Number(saved.hands) || 0
    history.rounds = Number(saved.rounds) || 0
  }
  return history
}

export function saveHistory(history: HistoryState) {
  writeRaw(HISTORY_KEY, history)
}

export function loadSavedGame(): SavedGame | null {
  const saved = readRaw(GAME_KEY)
  if (!saved || typeof saved !== 'object') return null
  return {
    board: saved.board ?? null,
    hand: saved.hand ?? null,
    roundSummary: saved.roundSummary ?? null,
    dice: saved.dice ?? null,
    shownDice: saved.shownDice ?? { a: 1, b: 1 }
  }
}

export function saveGame(game: SavedGame) {
  writeRaw(GAME_KEY, game)
}

/** 语音默认开启；只有明确存过 false 才静音 */
export function loadVoiceEnabled(): boolean {
  const saved = readRaw(VOICE_KEY)
  if (saved && typeof saved === 'object' && typeof saved.enabled === 'boolean') return saved.enabled
  return true
}

export function saveVoiceEnabled(enabled: boolean) {
  writeRaw(VOICE_KEY, { enabled })
}

export function clearAllData() {
  removeRaw(HISTORY_KEY)
  removeRaw(GAME_KEY)
}
