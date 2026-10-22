import { _decorator, Component, Node, Graphics, Color } from 'cc';
import { UIHelper, C } from '../UIHelper';
import { gameState } from '../GameState';
import { wsManager } from '../WebSocketManager';
import type { GameManager } from '../GameManager';
const { ccclass } = _decorator;

@ccclass('RoomPanel')
export class RoomPanel extends Component {
  private manager!: GameManager;
  private contentNode: Node | null = null;

  init(manager: GameManager): void {
    this.manager = manager;
  }

  onEnter(): void {
    this.setupEvents();
    this.buildUI();
  }

  onExit(): void {
    wsManager.off('room_update');
    wsManager.off('room_left');
    wsManager.off('game_start');
    this.node.removeAllChildren();
  }

  private setupEvents(): void {
    wsManager.on('room_update', (msg) => {
      if (msg.data.room) gameState.room = msg.data.room;
      this.buildUI();
    });

    wsManager.on('room_left', () => {
      gameState.room = null;
      this.manager.switchPanel('lobby');
    });

    wsManager.on('game_start', (msg) => {
      gameState.seat = msg.data.seat;
      gameState.hand = msg.data.hand;
      gameState.dealer = msg.data.dealer;
      gameState.phase = msg.data.phase;
      if (msg.data.hand_counts) gameState.otherHandCounts = msg.data.hand_counts;
      this.manager.switchPanel('game');
    });
  }

  private buildUI(): void {
    this.node.removeAllChildren();
    const { width: w, height: h } = this.manager.getDesignSize();
    const room = gameState.room;
    if (!room) return;

    // 房间标题
    UIHelper.createLabel(this.node, room.name, {
      size: 22, color: C.gold, bold: true,
    }).node.setPosition(0, h / 2 - 40);

    UIHelper.createLabel(this.node, `房间号: ${room.id}`, {
      size: 13, color: C.muted,
    }).node.setPosition(0, h / 2 - 65);

    // 牌桌 - Liquid Glass 风格
    const tableSize = Math.min(w - 60, 300);
    const tableNode = UIHelper.createNode('Table', tableSize, tableSize, this.node);
    tableNode.setPosition(0, 30);
    const tg = tableNode.addComponent(Graphics);
    // 深色玻璃桌面
    tg.fillColor = new Color(26, 107, 60, 200);
    tg.roundRect(-tableSize / 2, -tableSize / 2, tableSize, tableSize, 16);
    tg.fill();
    // 桌面高光
    tg.fillColor = new Color(255, 255, 255, 12);
    tg.roundRect(-tableSize / 2, -tableSize / 2, tableSize, tableSize / 3, 16);
    tg.fill();
    // 玻璃边框
    tg.strokeColor = new Color(255, 215, 0, 50);
    tg.lineWidth = 2;
    tg.roundRect(-tableSize / 2, -tableSize / 2, tableSize, tableSize, 16);
    tg.stroke();

    // 四个座位
    const windLabels = ['南', '东', '北', '西'];
    const seats = [
      { x: 0, y: -tableSize / 2 + 40 },       // 南
      { x: -tableSize / 2 + 40, y: 0 },        // 东
      { x: 0, y: tableSize / 2 - 40 },          // 北
      { x: tableSize / 2 - 40, y: 0 },          // 西
    ];

    for (let i = 0; i < 4; i++) {
      const s = seats[i];
      const player = room.players[i];

      if (player) {
        const avatar = UIHelper.createAvatar(tableNode, 22, {
          isBot: player.is_bot,
          isActive: true,
          name: player.nickname,
          score: player.score,
        });
        avatar.setPosition(s.x, s.y);
      } else {
        // 空位
        UIHelper.createLabel(tableNode, '?', {
          size: 20, color: C.muted,
        }).node.setPosition(s.x, s.y);
        UIHelper.createLabel(tableNode, '等待加入', {
          size: 11, color: C.muted,
        }).node.setPosition(s.x, s.y - 30);
      }

      // 方位标签
      UIHelper.createLabel(tableNode, windLabels[i], {
        size: 11, color: C.goldDark,
      }).node.setPosition(s.x, s.y + 36);
    }

    // 状态
    UIHelper.createLabel(this.node, `玩家 ${room.players.length}/4  等待开始...`, {
      size: 15, color: C.white,
    }).node.setPosition(0, 30 - tableSize / 2 - 30);

    // 配置信息
    const configText = [
      room.config.allow_double_sequence_dana ? '双连号大拿' : '',
      room.config.allow_double_kong_dana ? '双杠大拿' : '',
      room.config.settle_mode === 'FiftyDown' ? '50一倒' : '每局结算',
    ].filter(Boolean).join(' | ');
    UIHelper.createLabel(this.node, configText, {
      size: 12, color: C.muted,
    }).node.setPosition(0, 30 - tableSize / 2 - 52);

    // 按钮
    const hasEmpty = room.players.length < 4;
    if (hasEmpty) {
      UIHelper.createButton(this.node, '填充机器人', 200, 38, C.blue, () => {
        wsManager.send('room_add_bots');
      }).setPosition(0, -h / 2 + 115);
    }

    UIHelper.createButton(this.node, '离开房间', 140, 42, C.red, () => {
      wsManager.send('room_leave');
    }).setPosition(-80, -h / 2 + 65);

    const canStart = room.players.length >= 4;
    UIHelper.createButton(this.node, canStart ? '开始游戏' : '等待中...', 140, 42,
      canStart ? C.green : C.disabled,
      () => { if (canStart) wsManager.send('game_start_request'); }
    ).setPosition(80, -h / 2 + 65);
  }
}
