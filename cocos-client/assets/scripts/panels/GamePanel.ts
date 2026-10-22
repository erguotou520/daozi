import { _decorator, Component, Node, Graphics, Color, EventTouch, UITransform, Vec3 } from 'cc';
import { UIHelper, C, TILE_W, TILE_H, TILE_W_SMALL, TILE_H_SMALL } from '../UIHelper';
import { gameState } from '../GameState';
import { wsManager } from '../WebSocketManager';
import { tilesEqual, parseSuit, SUIT_CN } from '../types';
import type { Tile, Suit, Meld } from '../types';
import type { GameManager } from '../GameManager';
const { ccclass } = _decorator;

@ccclass('GamePanel')
export class GamePanel extends Component {
  private manager!: GameManager;

  // UI容器节点
  private infoBarNode: Node | null = null;
  private otherPlayersNode: Node | null = null;
  private discardsNode: Node | null = null;
  private myMeldsNode: Node | null = null;
  private myHandNode: Node | null = null;
  private actionsNode: Node | null = null;
  private chooseLackNode: Node | null = null;
  private resultNode: Node | null = null;
  private toastNode: Node | null = null;

  private selectedTileIndex: number = -1;
  private showResult: boolean = false;
  private dirty: boolean = true;

  init(manager: GameManager): void {
    this.manager = manager;
  }

  onEnter(): void {
    this.selectedTileIndex = -1;
    this.showResult = false;
    this.dirty = true;
    this.setupEvents();
    this.rebuildAll();
  }

  onExit(): void {
    const events = [
      'lack_chosen', 'game_playing', 'tile_drawn', 'player_drew',
      'tile_discarded', 'action_available', 'player_ponged', 'player_konged',
      'your_turn', 'game_win', 'draw_game', 'reconnect_snapshot', 'game_start', 'error',
    ];
    events.forEach(e => wsManager.off(e));
    this.node.removeAllChildren();
  }

  private setupEvents(): void {
    wsManager.on('lack_chosen', () => this.markDirty());

    wsManager.on('game_playing', (msg) => {
      gameState.currentTurn = msg.data.current_turn;
      gameState.dealer = msg.data.dealer;
      gameState.phase = 'playing';
      this.markDirty();
    });

    wsManager.on('tile_drawn', (msg) => {
      gameState.hand = msg.data.hand;
      gameState.remainingTiles = msg.data.remaining;
      if (msg.data.actions?.length > 0) {
        gameState.availableActions = msg.data.actions;
      }
      this.selectedTileIndex = -1;
      this.markDirty();
    });

    wsManager.on('player_drew', (msg) => {
      gameState.currentTurn = msg.data.seat;
      gameState.remainingTiles = msg.data.remaining;
      if (msg.data.seat !== gameState.seat) {
        gameState.otherHandCounts[msg.data.seat] = (gameState.otherHandCounts[msg.data.seat] || 0) + 1;
      }
      this.markDirty();
    });

    wsManager.on('tile_discarded', (msg) => {
      const seat = msg.data.seat;
      gameState.discards[seat] = gameState.discards[seat] || [];
      gameState.discards[seat].push(msg.data.tile);
      gameState.remainingTiles = msg.data.remaining;
      gameState.lastDiscardTile = msg.data.tile;
      gameState.lastDiscardSeat = seat;
      if (seat !== gameState.seat) {
        gameState.otherHandCounts[seat] = Math.max(0, (gameState.otherHandCounts[seat] || 0) - 1);
      }
      this.markDirty();
    });

    wsManager.on('action_available', (msg) => {
      gameState.availableActions = msg.data.actions || [];
      if (msg.data.tile) gameState.lastDiscardTile = msg.data.tile;
      this.markDirty();
    });

    wsManager.on('player_ponged', (msg) => {
      const seat = msg.data.seat;
      this.showToast(`${this.seatName(seat)} 碰!`);
      if (seat === gameState.seat) {
        if (msg.data.hand) gameState.hand = msg.data.hand;
        if (msg.data.melds) gameState.melds = msg.data.melds;
      } else {
        if (msg.data.melds) gameState.otherMelds[seat] = msg.data.melds;
        if (msg.data.hand_count !== undefined) gameState.otherHandCounts[seat] = msg.data.hand_count;
      }
      if (gameState.lastDiscardSeat >= 0) {
        const d = gameState.discards[gameState.lastDiscardSeat];
        if (d?.length > 0) d.pop();
      }
      gameState.currentTurn = seat;
      gameState.availableActions = [];
      this.markDirty();
    });

    wsManager.on('player_konged', (msg) => {
      const seat = msg.data.seat;
      this.showToast(`${this.seatName(seat)} ${msg.data.concealed ? '暗杠' : '杠'}!`);
      if (seat === gameState.seat) {
        if (msg.data.hand) gameState.hand = msg.data.hand;
        if (msg.data.melds) gameState.melds = msg.data.melds;
      } else {
        if (msg.data.melds) gameState.otherMelds[seat] = msg.data.melds;
        if (msg.data.hand_count !== undefined) gameState.otherHandCounts[seat] = msg.data.hand_count;
      }
      if (!msg.data.concealed && gameState.lastDiscardSeat >= 0) {
        const d = gameState.discards[gameState.lastDiscardSeat];
        if (d?.length > 0) d.pop();
      }
      gameState.currentTurn = seat;
      gameState.availableActions = [];
      this.markDirty();
    });

    wsManager.on('your_turn', (msg) => {
      gameState.hand = msg.data.hand;
      gameState.currentTurn = gameState.seat;
      this.markDirty();
    });

    wsManager.on('game_win', (msg) => {
      gameState.gameResult = msg.data;
      this.showResult = true;
      this.markDirty();
    });

    wsManager.on('draw_game', () => {
      gameState.gameResult = null;
      this.showResult = true;
      this.showToast('荒庄！无人胡牌');
      this.markDirty();
    });

    wsManager.on('reconnect_snapshot', (msg) => {
      gameState.seat = msg.data.seat;
      gameState.hand = msg.data.hand;
      gameState.melds = msg.data.melds || [];
      gameState.lackSuit = msg.data.lack_suit ? parseSuit(msg.data.lack_suit) : null;
      gameState.discards = msg.data.discards || [[], [], [], []];
      gameState.currentTurn = msg.data.current_turn;
      gameState.phase = msg.data.phase;
      gameState.remainingTiles = msg.data.remaining;
      gameState.bigHook = msg.data.big_hook;
      if (msg.data.all_melds) gameState.otherMelds = msg.data.all_melds;
      if (msg.data.hand_counts) gameState.otherHandCounts = msg.data.hand_counts;
      this.markDirty();
    });

    wsManager.on('game_start', (msg) => {
      if (msg.data.hand_counts) gameState.otherHandCounts = msg.data.hand_counts;
      this.markDirty();
    });

    wsManager.on('error', (msg) => {
      this.showToast(msg.data.message || '操作失败');
    });
  }

  private markDirty(): void {
    this.dirty = true;
  }

  update(_dt: number): void {
    if (this.dirty) {
      this.dirty = false;
      this.rebuildAll();
    }
  }

  private rebuildAll(): void {
    this.node.removeAllChildren();
    const { width: w, height: h } = this.manager.getDesignSize();

    if (this.showResult) {
      this.buildResult(w, h);
      return;
    }

    if (gameState.phase === 'choosing_lack' || gameState.phase === 'ChoosingLack') {
      this.buildChooseLack(w, h);
      return;
    }

    this.buildInfoBar(w, h);
    this.buildOtherPlayers(w, h);
    this.buildDiscards(w, h);
    this.buildMyMelds(w, h);
    this.buildMyHand(w, h);
    this.buildActions(w, h);
  }

  // ===== 信息栏 =====
  private buildInfoBar(w: number, h: number): void {
    const bar = UIHelper.createNode('InfoBar', w, 36, this.node);
    bar.setPosition(0, h / 2 - 18);
    const g = bar.addComponent(Graphics);
    // Liquid Glass 信息栏
    g.fillColor = new Color(0, 0, 0, 120);
    g.rect(-w / 2, -18, w, 36);
    g.fill();
    g.fillColor = new Color(255, 255, 255, 6);
    g.rect(-w / 2, -18, w, 18);
    g.fill();

    UIHelper.createLabel(bar, `余牌: ${gameState.remainingTiles}`, {
      size: 13, color: C.goldLight,
    }).node.setPosition(-w / 2 + 50, 0);

    const isMyTurn = gameState.currentTurn === gameState.seat;
    UIHelper.createLabel(bar, isMyTurn ? '你的回合' : `${this.seatName(gameState.currentTurn)} 出牌`, {
      size: 14, color: isMyTurn ? C.green : C.white, bold: true,
    }).node.setPosition(0, 0);

    if (gameState.lackSuit) {
      UIHelper.createLabel(bar, `缺: ${SUIT_CN[gameState.lackSuit]}`, {
        size: 13, color: C.orange,
      }).node.setPosition(w / 2 - 40, 0);
    }
  }

  // ===== 其他玩家 =====
  private buildOtherPlayers(w: number, h: number): void {
    const room = gameState.room;
    if (!room) return;
    const container = UIHelper.createNode('OtherPlayers', w, h, this.node);

    // 对面 (seat+2)
    const oppSeat = (gameState.seat + 2) % 4;
    const opp = room.players[oppSeat];
    if (opp) {
      const avatar = UIHelper.createAvatar(container, 14, {
        isBot: opp.is_bot,
        isActive: gameState.currentTurn === oppSeat,
        name: opp.nickname,
      });
      avatar.setPosition(0, h / 2 - 70);

      // 牌背
      const hc = gameState.otherHandCounts[oppSeat] || 0;
      for (let i = 0; i < Math.min(hc, 14); i++) {
        const t = UIHelper.createTile(container, { suit: 'wan', value: 1 }, { small: true, faceDown: true });
        t.setPosition((i - hc / 2) * (TILE_W_SMALL + 1), h / 2 - 120);
      }

      // 面子
      const oppMelds = gameState.otherMelds[oppSeat] || [];
      let mx = (hc / 2) * (TILE_W_SMALL + 1) + 10;
      for (const meld of oppMelds) {
        const meldNode = UIHelper.createMeld(container, meld, true);
        meldNode.setPosition(mx, h / 2 - 120);
        const cnt = meld.type === 'Pong' ? 3 : 4;
        mx += cnt * (TILE_W_SMALL + 2) + 8;
      }
    }

    // 左边 (seat+1)
    const leftSeat = (gameState.seat + 1) % 4;
    const left = room.players[leftSeat];
    if (left) {
      const avatar = UIHelper.createAvatar(container, 12, {
        isBot: left.is_bot,
        isActive: gameState.currentTurn === leftSeat,
        name: left.nickname,
      });
      avatar.setPosition(-w / 2 + 25, 60);

      const hc = gameState.otherHandCounts[leftSeat] || 0;
      for (let i = 0; i < Math.min(hc, 14); i++) {
        const t = UIHelper.createTile(container, { suit: 'wan', value: 1 }, { small: true, faceDown: true });
        t.setPosition(-w / 2 + 25, 20 - i * (TILE_H_SMALL * 0.35));
      }
    }

    // 右边 (seat+3)
    const rightSeat = (gameState.seat + 3) % 4;
    const right = room.players[rightSeat];
    if (right) {
      const avatar = UIHelper.createAvatar(container, 12, {
        isBot: right.is_bot,
        isActive: gameState.currentTurn === rightSeat,
        name: right.nickname,
      });
      avatar.setPosition(w / 2 - 25, 60);

      const hc = gameState.otherHandCounts[rightSeat] || 0;
      for (let i = 0; i < Math.min(hc, 14); i++) {
        const t = UIHelper.createTile(container, { suit: 'wan', value: 1 }, { small: true, faceDown: true });
        t.setPosition(w / 2 - 25, 20 - i * (TILE_H_SMALL * 0.35));
      }
    }
  }

  // ===== 弃牌 =====
  private buildDiscards(w: number, h: number): void {
    const container = UIHelper.createNode('Discards', w, h, this.node);
    const cols = 9;
    const gap = 1;

    for (let offset = 0; offset < 4; offset++) {
      const actualSeat = (gameState.seat + offset) % 4;
      const discards = gameState.discards[actualSeat] || [];

      for (let i = 0; i < discards.length; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        let tx: number, ty: number;

        switch (offset) {
          case 0: // 自己 (下方)
            tx = (col - cols / 2) * (TILE_W_SMALL + gap);
            ty = -30 - row * (TILE_H_SMALL + gap);
            break;
          case 1: // 左边
            tx = -w / 4 + row * (TILE_W_SMALL + gap);
            ty = (col - cols / 2) * (TILE_H_SMALL * 0.4 + gap);
            break;
          case 2: // 对面
            tx = (col - cols / 2) * (TILE_W_SMALL + gap);
            ty = 80 + row * (TILE_H_SMALL + gap);
            break;
          default: // 右边
            tx = w / 4 - row * (TILE_W_SMALL + gap);
            ty = (col - cols / 2) * (TILE_H_SMALL * 0.4 + gap);
            break;
        }

        const isLast = actualSeat === gameState.lastDiscardSeat && i === discards.length - 1;
        const tNode = UIHelper.createTile(container, discards[i], {
          small: true,
          highlighted: isLast,
        });
        tNode.setPosition(tx, ty);
      }
    }

    // 中央最后出的牌
    if (gameState.lastDiscardTile && gameState.availableActions.length === 0) {
      const lastTile = UIHelper.createTile(container, gameState.lastDiscardTile, {
        small: true, highlighted: true,
      });
      lastTile.setPosition(0, 25);
    }
  }

  // ===== 我的面子 =====
  private meldsWidth: number = 0;

  private buildMyMelds(w: number, h: number): void {
    this.meldsWidth = 0;
    const melds = gameState.melds;
    if (melds.length === 0) return;

    const container = UIHelper.createNode('MyMelds', w, TILE_H, this.node);
    container.setPosition(0, -h / 2 + TILE_H / 2 + 16);

    let offsetX = -w / 2 + 20;
    for (const meld of melds) {
      const meldNode = UIHelper.createMeld(container, meld, true);
      const cnt = meld.type === 'Pong' ? 3 : 4;
      const meldW = cnt * (TILE_W_SMALL + 2);
      meldNode.setPosition(offsetX + meldW / 2, 0);
      offsetX += meldW + 8;
    }
    this.meldsWidth = offsetX + w / 2 + 8;
  }

  // ===== 我的手牌 =====
  private buildMyHand(w: number, h: number): void {
    const hand = gameState.hand;
    if (hand.length === 0) return;

    const container = UIHelper.createNode('MyHand', w, TILE_H + 20, this.node);
    container.setPosition(0, -h / 2 + TILE_H / 2 + 16);
    container.on(Node.EventType.TOUCH_END, (e: EventTouch) => this.onHandTouch(e), this);
    const ut = container.getComponent(UITransform)!;
    ut.setContentSize(w, TILE_H + 20);

    const hasLackTiles = gameState.lackSuit ? hand.some(t => t.suit === gameState.lackSuit) : false;

    const availW = w - this.meldsWidth - 20;
    const gap = Math.min(4, Math.max(-5, (availW - hand.length * TILE_W) / Math.max(1, hand.length - 1)));
    const totalW = hand.length * TILE_W + (hand.length - 1) * gap;
    const startX = this.meldsWidth / 2 + (availW - totalW) / 2 - w / 2 + TILE_W / 2 + 10;

    for (let i = 0; i < hand.length; i++) {
      const tile = hand[i];
      const isSelected = i === this.selectedTileIndex;
      const isLack = gameState.lackSuit === tile.suit;
      const mustPlayLack = hasLackTiles && !isLack;

      const tNode = UIHelper.createTile(container, tile, {
        selected: isSelected,
        highlighted: isSelected,
        disabled: mustPlayLack,
      });
      const x = startX + i * (TILE_W + gap);
      const y = isSelected ? 8 : 0;
      tNode.setPosition(x, y);
      tNode.name = `HandTile_${i}`;
    }
  }

  private onHandTouch(e: EventTouch): void {
    if (gameState.currentTurn !== gameState.seat) return;

    const hand = gameState.hand;
    if (hand.length === 0) return;

    const target = e.target as Node;
    const location = e.getUILocation();
    const container = target.name.startsWith('HandTile_') ? target.parent! : target;

    // 查找点击的牌
    for (let i = 0; i < container.children.length; i++) {
      const child = container.children[i];
      if (!child.name.startsWith('HandTile_')) continue;

      const ut = child.getComponent(UITransform);
      if (!ut) continue;

      const localPos = ut.convertToNodeSpaceAR(new Vec3(location.x, location.y, 0));
      const hw = TILE_W / 2;
      const hh = TILE_H / 2;
      if (localPos.x >= -hw && localPos.x <= hw && localPos.y >= -hh && localPos.y <= hh) {
        const idx = parseInt(child.name.replace('HandTile_', ''));
        if (this.selectedTileIndex === idx) {
          // 双击出牌
          this.discardTile(hand[idx]);
          this.selectedTileIndex = -1;
        } else {
          this.selectedTileIndex = idx;
        }
        this.markDirty();
        return;
      }
    }
  }

  private discardTile(tile: Tile): void {
    if (gameState.currentTurn !== gameState.seat) return;

    // 缺门检查
    if (gameState.lackSuit) {
      const hasLackTiles = gameState.hand.some(t => t.suit === gameState.lackSuit);
      if (hasLackTiles && tile.suit !== gameState.lackSuit) {
        this.showToast('必须先打缺门的牌!');
        return;
      }
    }

    wsManager.send('game_discard', { suit: tile.suit, value: tile.value });
    const idx = gameState.hand.findIndex(t => tilesEqual(t, tile));
    if (idx >= 0) gameState.hand.splice(idx, 1);
    this.markDirty();
  }

  // ===== 操作按钮 =====
  private buildActions(w: number, h: number): void {
    const actions = gameState.availableActions;
    if (actions.length === 0) return;

    const container = UIHelper.createNode('Actions', w, 50, this.node);
    container.setPosition(0, -h / 2 + TILE_H + 50);

    const btnW = 65;
    const gap = 10;
    const totalW = actions.length * (btnW + gap);
    let x = -totalW / 2 + btnW / 2;

    for (const action of actions) {
      let label = '';
      let color = C.green;

      if (action.includes('Win')) { label = '胡'; color = C.red; }
      else if (action.includes('Kong')) { label = '杠'; color = C.purple; }
      else if (action === 'Pong') { label = '碰'; color = C.blue; }
      else if (action === 'Pass') { label = '过'; color = C.disabled; }
      else { label = action; }

      UIHelper.createButton(container, label, btnW, 36, color, () => {
        this.handleAction(action);
      }).setPosition(x, 0);
      x += btnW + gap;
    }
  }

  private handleAction(action: string): void {
    switch (action) {
      case 'Pong':
        wsManager.send('game_pong');
        gameState.availableActions = [];
        break;
      case 'Pass':
        wsManager.send('game_pass');
        gameState.availableActions = [];
        break;
      default:
        if (action.includes('Win')) {
          wsManager.send('game_win');
          gameState.availableActions = [];
        } else if (action.includes('Kong')) {
          const tile = gameState.lastDiscardTile;
          if (tile) wsManager.send('game_kong', { suit: tile.suit, value: tile.value });
          gameState.availableActions = [];
        }
        break;
    }
    this.markDirty();
  }

  // ===== 选缺 =====
  private buildChooseLack(w: number, h: number): void {
    UIHelper.createLabel(this.node, '请选择缺门', {
      size: 28, color: C.gold, bold: true,
    }).node.setPosition(0, h / 2 - 100);

    UIHelper.createLabel(this.node, '选择一门花色，游戏中需打完该花色才能胡牌', {
      size: 14, color: C.muted,
    }).node.setPosition(0, h / 2 - 135);

    const suits: { suit: Suit; label: string; color: Color }[] = [
      { suit: 'wan', label: '万', color: C.red },
      { suit: 'tiao', label: '条', color: C.green },
      { suit: 'tong', label: '筒', color: C.blue },
    ];

    suits.forEach((s, i) => {
      const x = (i - 1) * 100;
      const count = gameState.hand.filter(t => t.suit === s.suit).length;

      UIHelper.createButton(this.node, `${s.label}\n${count}张`, 80, 80, s.color, () => {
        gameState.lackSuit = s.suit;
        gameState.phase = 'playing';
        wsManager.send('game_choose_lack', { suit: s.suit });
        this.markDirty();
      }).setPosition(x, h / 2 - 210);
    });

    // 手牌
    const hand = gameState.hand;
    const totalW = hand.length * (TILE_W + 2);
    hand.forEach((tile, i) => {
      const tNode = UIHelper.createTile(this.node, tile);
      tNode.setPosition((i - hand.length / 2) * (TILE_W + 2), -h / 2 + TILE_H / 2 + 20);
    });
  }

  // ===== 结果 =====
  private buildResult(w: number, h: number): void {
    UIHelper.createOverlay(this.node, w, h);

    const result = gameState.gameResult;
    if (!result) {
      UIHelper.createLabel(this.node, '荒 庄', {
        size: 36, color: C.gold, bold: true,
      }).node.setPosition(0, 0);
    } else {
      const isMe = result.winner_seat === gameState.seat;
      UIHelper.createLabel(this.node, isMe ? '你赢了！' : `${this.seatName(result.winner_seat)} 胡牌`, {
        size: 30, color: isMe ? C.gold : C.white, bold: true,
      }).node.setPosition(0, h / 2 - 80);

      if (result.is_dana) {
        UIHelper.createLabel(this.node, '大  拿', {
          size: 24, color: C.red, bold: true,
        }).node.setPosition(0, h / 2 - 120);
      }

      UIHelper.createLabel(this.node, `${result.score} 分`, {
        size: 28, color: C.goldLight, bold: true,
      }).node.setPosition(0, h / 2 - 160);

      UIHelper.createLabel(this.node, result.is_self_drawn ? '自摸' : '点炮', {
        size: 16, color: C.muted,
      }).node.setPosition(0, h / 2 - 190);

      if (result.mozi_big > 0 || result.mozi_small > 0) {
        UIHelper.createLabel(this.node, `摸子: ${result.mozi_big}大 ${result.mozi_small}小`, {
          size: 16, color: C.orange,
        }).node.setPosition(0, h / 2 - 215);
      }

      let detailY = h / 2 - 245;
      for (const detail of result.details) {
        UIHelper.createLabel(this.node, detail, {
          size: 14, color: C.muted,
        }).node.setPosition(0, detailY);
        detailY -= 22;
      }

      // 胡牌手牌
      if (result.hand) {
        result.hand.forEach((tile, i) => {
          const tNode = UIHelper.createTile(this.node, tile, { small: true });
          tNode.setPosition((i - result.hand.length / 2) * (TILE_W_SMALL + 2), -h / 2 + 120);
        });
      }
    }

    UIHelper.createButton(this.node, '返回大厅', 160, 44, C.green, () => {
      gameState.reset();
      this.showResult = false;
      this.manager.switchPanel('lobby');
    }).setPosition(0, -h / 2 + 60);
  }

  // ===== 工具方法 =====
  private seatName(seat: number): string {
    if (seat === gameState.seat) return '你';
    const room = gameState.room;
    if (room?.players[seat]) return room.players[seat].nickname;
    return `玩家${seat}`;
  }

  private showToast(text: string): void {
    UIHelper.showToast(this.node, text);
  }
}
