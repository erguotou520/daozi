import type { User, RoomInfo, Tile, Meld, Suit, GameResult } from './types';

class GameStateStore {
  // 认证
  token: string = '';
  user: User | null = null;

  // 大厅
  onlineCount: number = 0;
  roomCount: number = 0;

  // 房间
  room: RoomInfo | null = null;

  // 游戏
  seat: number = -1;
  hand: Tile[] = [];
  melds: Meld[] = [];
  lackSuit: Suit | null = null;
  discards: Tile[][] = [[], [], [], []];
  currentTurn: number = -1;
  dealer: number = -1;
  phase: string = '';
  remainingTiles: number = 0;
  availableActions: string[] = [];
  lastDiscardTile: Tile | null = null;
  lastDiscardSeat: number = -1;

  // 其他玩家
  otherMelds: Meld[][] = [[], [], [], []];
  otherHandCounts: number[] = [13, 13, 13, 13];

  // 大吊车
  bigHook: { player_seat: number; danger_tile: Tile; restricted_range: Tile[] } | null = null;

  // 游戏结果
  gameResult: GameResult | null = null;

  // 场景切换回调
  onSwitchPanel: ((name: string) => void) | null = null;

  switchPanel(name: string): void {
    if (this.onSwitchPanel) this.onSwitchPanel(name);
  }

  reset(): void {
    this.room = null;
    this.seat = -1;
    this.hand = [];
    this.melds = [];
    this.lackSuit = null;
    this.discards = [[], [], [], []];
    this.currentTurn = -1;
    this.dealer = -1;
    this.phase = '';
    this.remainingTiles = 0;
    this.availableActions = [];
    this.lastDiscardTile = null;
    this.lastDiscardSeat = -1;
    this.otherMelds = [[], [], [], []];
    this.otherHandCounts = [13, 13, 13, 13];
    this.bigHook = null;
    this.gameResult = null;
  }
}

export const gameState = new GameStateStore();
