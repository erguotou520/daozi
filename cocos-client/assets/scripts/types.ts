/** 麻将花色 */
export type Suit = 'wan' | 'tiao' | 'tong';

/** 一张麻将牌 */
export interface Tile {
  suit: Suit;
  value: number; // 1-9
}

/** 面子 */
export interface Meld {
  type: 'Pong' | 'ExposedKong' | 'ConcealedKong' | 'AddedKong';
  tile: Tile;
}

/** 用户信息 */
export interface User {
  id: string;
  username: string;
  nickname: string;
  avatar: string;
  score: number;
  is_bot: boolean;
}

/** 玩家信息 */
export interface PlayerInfo {
  user_id: string;
  nickname: string;
  avatar: string;
  score: number;
  is_bot: boolean;
  is_ready: boolean;
  is_online: boolean;
  seat: number;
}

/** 房间配置 */
export interface RoomConfig {
  allow_double_sequence_dana: boolean;
  allow_double_kong_dana: boolean;
  settle_mode: string;
}

/** 房间信息 */
export interface RoomInfo {
  id: string;
  name: string;
  config: RoomConfig;
  status: string;
  players: PlayerInfo[];
  created_by: string;
  allow_bot: boolean;
}

/** WebSocket 消息 */
export interface WsMessage {
  type: string;
  data: any;
  seq: number;
}

/** 游戏结果 */
export interface GameResult {
  winner_seat: number;
  is_self_drawn: boolean;
  is_dana: boolean;
  score: number;
  mozi_big: number;
  mozi_small: number;
  details: string[];
  hand: Tile[];
}

export function tilesEqual(a: Tile, b: Tile): boolean {
  return a.suit === b.suit && a.value === b.value;
}

export function parseSuit(s: string): Suit {
  if (s === 'Wan' || s === 'wan') return 'wan';
  if (s === 'Tiao' || s === 'tiao') return 'tiao';
  return 'tong';
}

export const SUIT_CN: Record<Suit, string> = { wan: '万', tiao: '条', tong: '筒' };
