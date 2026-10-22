import { _decorator, Component, Node, view, UITransform, Canvas, Camera, Size, Vec3, Widget, sys, Graphics, Color } from 'cc';
import { gameState } from './GameState';
import { wsManager } from './WebSocketManager';
import { UIHelper, C } from './UIHelper';
import { LoginPanel } from './panels/LoginPanel';
import { LobbyPanel } from './panels/LobbyPanel';
import { RoomPanel } from './panels/RoomPanel';
import { GamePanel } from './panels/GamePanel';
const { ccclass, property } = _decorator;

/**
 * 游戏主管理器 - 挂载到 Canvas 节点
 * 管理所有面板的生命周期和切换
 */
@ccclass('GameManager')
export class GameManager extends Component {
  private panels: Map<string, Node> = new Map();
  private currentPanel: string = '';
  private designWidth: number = 960;
  private designHeight: number = 640;

  start(): void {
    this.setupCanvas();
    this.createPanels();
    this.setupGlobalEvents();

    // 注册切换回调
    gameState.onSwitchPanel = (name: string) => this.switchPanel(name);

    // 尝试自动登录
    this.tryAutoLogin();
  }

  private setupCanvas(): void {
    // 设置适配策略：宽度适配
    const size = view.getVisibleSize();
    this.designWidth = size.width;
    this.designHeight = size.height;
  }

  private createPanels(): void {
    const size = view.getVisibleSize();
    const w = size.width;
    const h = size.height;

    // 背景 (深色 Liquid Glass 风格)
    const bgNode = UIHelper.createNode('Background', w, h, this.node);
    bgNode.setPosition(0, 0);
    const bgG = bgNode.addComponent(Graphics);
    bgG.fillColor = new Color(10, 14, 26, 255);
    bgG.rect(-w / 2, -h / 2, w, h);
    bgG.fill();

    // 创建四个面板
    const loginNode = UIHelper.createNode('LoginPanel', w, h, this.node);
    const loginPanel = loginNode.addComponent(LoginPanel);
    loginPanel.init(this);
    this.panels.set('login', loginNode);

    const lobbyNode = UIHelper.createNode('LobbyPanel', w, h, this.node);
    const lobbyPanel = lobbyNode.addComponent(LobbyPanel);
    lobbyPanel.init(this);
    this.panels.set('lobby', lobbyNode);

    const roomNode = UIHelper.createNode('RoomPanel', w, h, this.node);
    const roomPanel = roomNode.addComponent(RoomPanel);
    roomPanel.init(this);
    this.panels.set('room', roomNode);

    const gameNode = UIHelper.createNode('GamePanel', w, h, this.node);
    const gamePanel = gameNode.addComponent(GamePanel);
    gamePanel.init(this);
    this.panels.set('game', gameNode);

    // 全部隐藏
    this.panels.forEach(p => p.active = false);
  }

  private setupGlobalEvents(): void {
    wsManager.on('room_joined', (msg) => {
      gameState.room = msg.data.room;
      this.switchPanel('room');
    });

    wsManager.on('stats', (msg) => {
      gameState.onlineCount = msg.data.online || 0;
      gameState.roomCount = msg.data.rooms || 0;
    });

    wsManager.on('sign_in_result', (msg) => {
      if (msg.data.success && gameState.user) {
        gameState.user.score = msg.data.new_score;
      }
    });
  }

  private async tryAutoLogin(): Promise<void> {
    const savedToken = sys.localStorage.getItem('daozi_token');
    const savedUser = sys.localStorage.getItem('daozi_user');

    if (savedToken && savedUser) {
      try {
        const user = JSON.parse(savedUser);
        gameState.token = savedToken;
        gameState.user = user;
        await wsManager.connect(savedToken);
        this.switchPanel('lobby');
        return;
      } catch {
        sys.localStorage.removeItem('daozi_token');
        sys.localStorage.removeItem('daozi_user');
      }
    }
    this.switchPanel('login');
  }

  switchPanel(name: string): void {
    // 退出当前面板
    if (this.currentPanel) {
      const oldNode = this.panels.get(this.currentPanel);
      if (oldNode) {
        const comp = this.getPanelComponent(oldNode, this.currentPanel);
        if (comp && 'onExit' in comp) (comp as any).onExit();
        oldNode.active = false;
      }
    }

    // 进入新面板
    const newNode = this.panels.get(name);
    if (newNode) {
      newNode.active = true;
      const comp = this.getPanelComponent(newNode, name);
      if (comp && 'onEnter' in comp) (comp as any).onEnter();
      this.currentPanel = name;
    }
  }

  private getPanelComponent(node: Node, name: string): Component | null {
    switch (name) {
      case 'login': return node.getComponent(LoginPanel);
      case 'lobby': return node.getComponent(LobbyPanel);
      case 'room': return node.getComponent(RoomPanel);
      case 'game': return node.getComponent(GamePanel);
      default: return null;
    }
  }

  getDesignSize(): { width: number; height: number } {
    const size = view.getVisibleSize();
    return { width: size.width, height: size.height };
  }
}
