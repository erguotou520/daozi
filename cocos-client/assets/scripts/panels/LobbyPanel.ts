import { _decorator, Component, Node, Graphics, Color } from 'cc';
import { UIHelper, C, TILE_W, TILE_H } from '../UIHelper';
import { gameState } from '../GameState';
import { wsManager } from '../WebSocketManager';
import type { GameManager } from '../GameManager';
const { ccclass } = _decorator;

@ccclass('LobbyPanel')
export class LobbyPanel extends Component {
  private manager!: GameManager;
  private infoLabel: any = null;
  private messageLabel: any = null;
  private showCreateDialog: boolean = false;
  private showCalculator: boolean = false;
  private dialogNode: Node | null = null;

  // 房间设置
  private allowDoubleSequenceDana: boolean = true;
  private allowDoubleKongDana: boolean = true;
  private settleMode: string = 'per_round';

  // 计分器
  private calcScore: number = 0;
  private calcMultiplier: number = 1;

  init(manager: GameManager): void {
    this.manager = manager;
  }

  onEnter(): void {
    this.showCreateDialog = false;
    this.showCalculator = false;
    this.buildUI();
  }

  onExit(): void {
    this.node.removeAllChildren();
  }

  private buildUI(): void {
    this.node.removeAllChildren();
    const { width: w, height: h } = this.manager.getDesignSize();

    // 顶部信息栏
    const infoBar = UIHelper.createNode('InfoBar', w, 35, this.node);
    infoBar.setPosition(0, h / 2 - 17);
    const ibg = infoBar.addComponent(Graphics);
    // Liquid Glass 信息栏
    ibg.fillColor = new Color(0, 0, 0, 120);
    ibg.rect(-w / 2, -17, w, 35);
    ibg.fill();
    ibg.fillColor = new Color(255, 255, 255, 6);
    ibg.rect(-w / 2, -17, w, 17);
    ibg.fill();

    const user = gameState.user;
    if (user) {
      UIHelper.createLabel(infoBar, `${user.nickname}  金币: ${user.score}`, {
        size: 13, color: C.goldLight,
      }).node.setPosition(0, 0);
    }

    this.infoLabel = UIHelper.createLabel(infoBar, `在线: ${gameState.onlineCount}`, {
      size: 12, color: C.muted,
    });
    this.infoLabel.node.setPosition(w / 2 - 60, 0);

    // 标题
    UIHelper.createLabel(this.node, '倒子麻将', {
      size: 34, color: C.gold, bold: true,
    }).node.setPosition(0, h / 2 - 80);

    // 菜单按钮
    const btnW = 220;
    const btnH = 46;
    let y = h / 2 - 150;

    UIHelper.createButton(this.node, '快速匹配', btnW, btnH, C.green, () => {
      wsManager.send('match_start');
      this.showMsg('正在匹配中...');
    }).setPosition(0, y);

    y -= 60;
    UIHelper.createButton(this.node, '创建房间', btnW, btnH, C.blue, () => {
      this.openCreateDialog();
    }).setPosition(0, y);

    y -= 60;
    UIHelper.createButton(this.node, '每日签到 (+500)', btnW, btnH, C.orange, () => {
      wsManager.send('sign_in');
    }).setPosition(0, y);

    y -= 60;
    UIHelper.createButton(this.node, '计分器', btnW, btnH, C.purple, () => {
      this.openCalculator();
    }).setPosition(0, y);

    // 消息
    this.messageLabel = UIHelper.createLabel(this.node, '', {
      size: 13, color: C.goldLight,
    });
    this.messageLabel.node.setPosition(0, -h / 2 + 60);

    // 底部
    UIHelper.createLabel(this.node, '安徽和县倒子麻将', {
      size: 11, color: C.muted,
    }).node.setPosition(0, -h / 2 + 22);
  }

  private showMsg(text: string): void {
    if (this.messageLabel) this.messageLabel.string = text;
  }

  // ===== 创建房间对话框 =====
  private openCreateDialog(): void {
    if (this.dialogNode) this.dialogNode.destroy();
    const { width: w, height: h } = this.manager.getDesignSize();

    this.dialogNode = UIHelper.createOverlay(this.node, w, h);
    const panel = UIHelper.createPanel(this.dialogNode, 340, 300, 'CreatePanel');
    panel.setPosition(0, 20);

    UIHelper.createLabel(panel, '房间设置', {
      size: 22, color: C.gold, bold: true,
    }).node.setPosition(0, 120);

    // 双连号大拿
    let optY = 70;
    this.addCheckbox(panel, '允许双连号大拿', optY, this.allowDoubleSequenceDana, (v) => {
      this.allowDoubleSequenceDana = v;
    });

    optY -= 35;
    this.addCheckbox(panel, '允许双杠大拿', optY, this.allowDoubleKongDana, (v) => {
      this.allowDoubleKongDana = v;
    });

    // 结算方式
    optY -= 40;
    UIHelper.createLabel(panel, '结算方式:', {
      size: 14, color: C.white,
    }).node.setPosition(-100, optY);

    optY -= 30;
    UIHelper.createButton(panel, '每局结算', 120, 32,
      this.settleMode === 'per_round' ? C.green : C.disabled,
      () => { this.settleMode = 'per_round'; this.openCreateDialog(); }
    ).setPosition(-70, optY);

    UIHelper.createButton(panel, '50一倒', 120, 32,
      this.settleMode === 'fifty_down' ? C.green : C.disabled,
      () => { this.settleMode = 'fifty_down'; this.openCreateDialog(); }
    ).setPosition(70, optY);

    // 操作按钮
    UIHelper.createButton(panel, '创建', 120, 40, C.green, () => {
      wsManager.send('room_create', {
        name: `${gameState.user?.nickname}的房间`,
        allow_double_sequence_dana: this.allowDoubleSequenceDana,
        allow_double_kong_dana: this.allowDoubleKongDana,
        settle_mode: this.settleMode,
      });
      this.closeDialog();
    }).setPosition(-70, -115);

    UIHelper.createButton(panel, '取消', 120, 40, C.red, () => {
      this.closeDialog();
    }).setPosition(70, -115);
  }

  private addCheckbox(parent: Node, label: string, y: number, checked: boolean, onChange: (v: boolean) => void): void {
    const g = parent.addComponent(Graphics);
    // 简化：用按钮模拟 checkbox
    const text = `${checked ? '☑' : '☐'} ${label}`;
    UIHelper.createButton(parent, text, 260, 28, checked ? C.blue : C.disabled, () => {
      onChange(!checked);
      this.openCreateDialog(); // 重建刷新
    }).setPosition(0, y);
  }

  private closeDialog(): void {
    if (this.dialogNode) {
      this.dialogNode.destroy();
      this.dialogNode = null;
    }
  }

  // ===== 计分器 =====
  private openCalculator(): void {
    if (this.dialogNode) this.dialogNode.destroy();
    this.calcScore = 0;
    this.calcMultiplier = 1;
    this.rebuildCalculator();
  }

  private rebuildCalculator(): void {
    if (this.dialogNode) this.dialogNode.destroy();
    const { width: w, height: h } = this.manager.getDesignSize();

    this.dialogNode = UIHelper.createOverlay(this.node, w, h);
    const panel = UIHelper.createPanel(this.dialogNode, 360, 440, 'CalcPanel');
    panel.setPosition(0, 0);

    UIHelper.createLabel(panel, '倒子计分器', {
      size: 22, color: C.gold, bold: true,
    }).node.setPosition(0, 195);

    // 分数
    const total = this.calcScore * this.calcMultiplier;
    UIHelper.createLabel(panel, `当前: ${this.calcScore} 分`, {
      size: 20, color: C.goldLight, bold: true,
    }).node.setPosition(0, 160);

    if (this.calcMultiplier > 1) {
      UIHelper.createLabel(panel, `× ${this.calcMultiplier} = ${total}`, {
        size: 16, color: C.orange,
      }).node.setPosition(0, 138);
    }

    // 计分项
    const items = [
      { label: '压裆 +1', score: 1 },
      { label: '棒棒 +5', score: 5 },
      { label: '不动手 +5', score: 5 },
      { label: '老小对 +5', score: 5 },
      { label: '小连号 +5', score: 5 },
      { label: '四活 +10', score: 10 },
      { label: '草一色 +10', score: 10 },
      { label: '对对胡 +10', score: 10 },
      { label: '大连号 +20', score: 20 },
      { label: '七对 +31', score: 31 },
      { label: '大吊车 +31', score: 31 },
    ];

    const cols = 2;
    const bw = 150;
    const bh = 30;
    const gap = 6;

    items.forEach((item, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = (col === 0 ? -80 : 80);
      const y = 105 - row * (bh + gap);
      UIHelper.createButton(panel, item.label, bw, bh, C.blue, () => {
        this.calcScore += item.score;
        this.rebuildCalculator();
      }).setPosition(x, y);
    });

    // 自摸按钮
    const zimoY = 105 - Math.ceil(items.length / cols) * (bh + gap) - 10;
    UIHelper.createButton(panel, this.calcMultiplier === 2 ? '自摸 ×2 ✓' : '自摸 ×2', 150, 28,
      this.calcMultiplier === 2 ? C.green : C.disabled,
      () => {
        this.calcMultiplier = this.calcMultiplier === 2 ? 1 : 2;
        this.rebuildCalculator();
      }
    ).setPosition(0, zimoY);

    // 底部按钮
    UIHelper.createButton(panel, '清零', 100, 36, C.orange, () => {
      this.calcScore = 0;
      this.calcMultiplier = 1;
      this.rebuildCalculator();
    }).setPosition(-70, -190);

    UIHelper.createButton(panel, '关闭', 100, 36, C.red, () => {
      this.closeDialog();
    }).setPosition(70, -190);
  }
}
