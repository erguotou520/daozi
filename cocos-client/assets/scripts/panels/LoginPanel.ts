import { _decorator, Component, Node, view, sys } from 'cc';
import { UIHelper, C } from '../UIHelper';
import { gameState } from '../GameState';
import { wsManager } from '../WebSocketManager';
import type { GameManager } from '../GameManager';
const { ccclass } = _decorator;

@ccclass('LoginPanel')
export class LoginPanel extends Component {
  private manager!: GameManager;
  private usernameInput: any = null;
  private passwordInput: any = null;
  private messageLabel: any = null;

  init(manager: GameManager): void {
    this.manager = manager;
  }

  onEnter(): void {
    this.buildUI();
  }

  onExit(): void {
    this.node.removeAllChildren();
  }

  private buildUI(): void {
    this.node.removeAllChildren();
    const { width: w, height: h } = this.manager.getDesignSize();

    // 标题
    UIHelper.createLabel(this.node, '倒子麻将', {
      size: 40, color: C.gold, bold: true,
    }).node.setPosition(0, h / 2 - 80);

    UIHelper.createLabel(this.node, '安徽和县传统麻将', {
      size: 14, color: C.muted,
    }).node.setPosition(0, h / 2 - 115);

    // 装饰牌
    const decorTiles = [
      { suit: 'wan' as const, value: 1 },
      { suit: 'tiao' as const, value: 5 },
      { suit: 'tong' as const, value: 9 },
    ];
    const tileGap = 60;
    decorTiles.forEach((tile, i) => {
      const x = (i - 1) * tileGap;
      const tNode = UIHelper.createTile(this.node, tile);
      tNode.setPosition(x, h / 2 - 170);
    });

    // 输入框
    this.usernameInput = UIHelper.createEditBox(this.node, '用户名', 220, 40);
    this.usernameInput.node.setPosition(0, 30);

    this.passwordInput = UIHelper.createEditBox(this.node, '密码', 220, 40, { password: true });
    this.passwordInput.node.setPosition(0, -25);

    // 按钮
    UIHelper.createButton(this.node, '登 录', 220, 44, C.green, () => this.onLogin());
    const loginBtn = this.node.children[this.node.children.length - 1];
    loginBtn.setPosition(0, -85);

    UIHelper.createButton(this.node, '注 册', 220, 44, C.blue, () => this.onRegister());
    const regBtn = this.node.children[this.node.children.length - 1];
    regBtn.setPosition(0, -140);

    // 消息
    this.messageLabel = UIHelper.createLabel(this.node, '', { size: 13, color: C.goldLight });
    this.messageLabel.node.setPosition(0, -190);
  }

  private async onLogin(): Promise<void> {
    const username = this.usernameInput?.string || '';
    const password = this.passwordInput?.string || '';
    if (!username || !password) {
      this.showMessage('请输入用户名和密码');
      return;
    }
    await this.doAuth('/api/auth/login', username, password);
  }

  private async onRegister(): Promise<void> {
    const username = this.usernameInput?.string || '';
    const password = this.passwordInput?.string || '';
    if (!username || !password) {
      this.showMessage('请输入用户名和密码');
      return;
    }
    await this.doAuth('/api/auth/register', username, password);
  }

  private async doAuth(url: string, username: string, password: string): Promise<void> {
    this.showMessage('处理中...');
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        this.showMessage(data.error || '操作失败');
        return;
      }
      const { token, user } = data;
      gameState.token = token;
      gameState.user = user;
      sys.localStorage.setItem('daozi_token', token);
      sys.localStorage.setItem('daozi_user', JSON.stringify(user));

      await wsManager.connect(token);
      this.manager.switchPanel('lobby');
    } catch (e: any) {
      this.showMessage(`连接失败: ${e.message || e}`);
    }
  }

  private showMessage(text: string): void {
    if (this.messageLabel) this.messageLabel.string = text;
  }
}
