import { _decorator, Node, Label, UITransform, Color, Graphics, Button, EditBox, Widget, Overflow, HorizontalTextAlignment, VerticalTextAlignment, Size, Sprite, UIOpacity } from 'cc';
import type { Tile, Suit, Meld } from './types';

/** 颜色常量 - Liquid Glass 风格 */
export const C = {
  gold:      new Color(255, 215, 0, 255),
  goldLight: new Color(255, 224, 102, 255),
  goldDark:  new Color(204, 153, 0, 255),
  white:     new Color(255, 255, 255, 242),
  muted:     new Color(255, 255, 255, 128),
  green:     new Color(34, 197, 94, 192),
  darkGreen: new Color(26, 107, 60, 255),
  red:       new Color(220, 50, 50, 204),
  blue:      new Color(59, 130, 246, 192),
  orange:    new Color(249, 115, 22, 192),
  purple:    new Color(168, 85, 247, 192),
  disabled:  new Color(255, 255, 255, 30),
  bg:        new Color(10, 14, 26, 220),
  bgTable:   new Color(26, 107, 60, 255),
  suitWan:   new Color(220, 60, 60, 255),
  suitTiao:  new Color(50, 180, 50, 255),
  suitTong:  new Color(50, 120, 220, 255),
  // Liquid Glass 特有
  glass:        new Color(0, 0, 0, 38),
  glassBorder:  new Color(255, 255, 255, 20),
  glassLight:   new Color(255, 255, 255, 30),
  accent:       new Color(255, 215, 0, 255),
  accentGlow:   new Color(255, 215, 0, 76),
  tableFelt:    new Color(26, 107, 60, 255),
  tableEdge:    new Color(74, 50, 34, 255),
};

const SUIT_CN: Record<string, string> = { wan: '万', tiao: '条', tong: '筒' };

/** 牌尺寸 */
export const TILE_W = 50;
export const TILE_H = 68;
export const TILE_W_SMALL = 32;
export const TILE_H_SMALL = 44;

/** UI工厂辅助类 */
export class UIHelper {

  /** 创建一个带 UITransform 的空节点 */
  static createNode(name: string, w: number, h: number, parent?: Node): Node {
    const node = new Node(name);
    const ut = node.addComponent(UITransform);
    ut.setContentSize(new Size(w, h));
    if (parent) node.parent = parent;
    return node;
  }

  /** 创建文本标签 */
  static createLabel(
    parent: Node,
    text: string,
    opts: { size?: number; color?: Color; bold?: boolean; align?: number; name?: string } = {}
  ): Label {
    const node = new Node(opts.name || 'Label');
    node.parent = parent;
    const ut = node.addComponent(UITransform);
    ut.setContentSize(new Size(0, 0));
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = opts.size || 18;
    label.color = opts.color || C.white;
    label.isBold = opts.bold || false;
    label.horizontalAlign = opts.align ?? HorizontalTextAlignment.CENTER;
    label.overflow = Overflow.NONE;
    label.cacheMode = Label.CacheMode.NONE;
    return label;
  }

  /** 创建按钮 - Liquid Glass 风格 */
  static createButton(
    parent: Node,
    text: string,
    w: number,
    h: number,
    color: Color,
    callback: () => void
  ): Node {
    const node = new Node('Btn_' + text);
    node.parent = parent;
    const ut = node.addComponent(UITransform);
    ut.setContentSize(new Size(w, h));

    const g = node.addComponent(Graphics);
    // 玻璃底色
    g.fillColor = new Color(color.r, color.g, color.b, Math.min(color.a, 180));
    g.roundRect(-w / 2, -h / 2, w, h, 8);
    g.fill();
    // 顶部高光
    g.fillColor = new Color(255, 255, 255, 25);
    g.roundRect(-w / 2, -h / 2, w, h / 2, 8);
    g.fill();
    // 玻璃边框
    g.strokeColor = new Color(255, 255, 255, 40);
    g.lineWidth = 1;
    g.roundRect(-w / 2, -h / 2, w, h, 8);
    g.stroke();

    // 文字
    UIHelper.createLabel(node, text, { size: Math.min(18, h * 0.4), color: C.white, bold: true });

    // 按钮组件
    const btn = node.addComponent(Button);
    btn.transition = Button.Transition.SCALE;
    node.on(Button.EventType.CLICK, callback);

    return node;
  }

  /** 创建输入框 - Liquid Glass 风格 */
  static createEditBox(
    parent: Node,
    placeholder: string,
    w: number,
    h: number,
    opts: { password?: boolean } = {}
  ): EditBox {
    const node = new Node('EditBox');
    node.parent = parent;
    const ut = node.addComponent(UITransform);
    ut.setContentSize(new Size(w, h));

    const g = node.addComponent(Graphics);
    // 玻璃背景
    g.fillColor = new Color(255, 255, 255, 12);
    g.roundRect(-w / 2, -h / 2, w, h, 6);
    g.fill();
    // 玻璃边框
    g.strokeColor = new Color(255, 255, 255, 30);
    g.lineWidth = 1;
    g.roundRect(-w / 2, -h / 2, w, h, 6);
    g.stroke();

    const editBox = node.addComponent(EditBox);
    editBox.placeholder = placeholder;
    editBox.maxLength = 20;
    if (opts.password) editBox.inputFlag = EditBox.InputFlag.PASSWORD;
    editBox.placeholderFontSize = 14;
    editBox.fontSize = 16;
    editBox.placeholderFontColor = new Color(255, 255, 255, 80);
    editBox.fontColor = C.white;

    return editBox;
  }

  /** 绘制一张麻将牌节点 */
  static createTile(
    parent: Node,
    tile: Tile,
    opts: { small?: boolean; faceDown?: boolean; selected?: boolean; highlighted?: boolean; disabled?: boolean } = {}
  ): Node {
    const w = opts.small ? TILE_W_SMALL : TILE_W;
    const h = opts.small ? TILE_H_SMALL : TILE_H;
    const node = new Node(`Tile_${tile.suit}_${tile.value}`);
    node.parent = parent;
    const ut = node.addComponent(UITransform);
    ut.setContentSize(new Size(w, h));

    const g = node.addComponent(Graphics);

    if (opts.faceDown) {
      // 牌背 - 深色玻璃
      g.fillColor = new Color(20, 50, 30, 240);
      g.roundRect(-w / 2, -h / 2, w, h, 4);
      g.fill();
      // 牌背高光
      g.fillColor = new Color(255, 255, 255, 15);
      g.roundRect(-w / 2, -h / 2, w, h / 3, 4);
      g.fill();
      g.strokeColor = new Color(80, 160, 80, 120);
      g.lineWidth = 1;
      g.roundRect(-w / 2, -h / 2, w, h, 4);
      g.stroke();
    } else {
      // 牌面 - 象牙白 + 玻璃质感
      g.fillColor = new Color(250, 248, 240, 255);
      g.roundRect(-w / 2, -h / 2, w, h, 4);
      g.fill();
      // 顶部光泽
      g.fillColor = new Color(255, 255, 255, 50);
      g.roundRect(-w / 2, -h / 2, w, h * 0.35, 4);
      g.fill();
      g.strokeColor = new Color(200, 195, 180, 200);
      g.lineWidth = 1;
      g.roundRect(-w / 2, -h / 2, w, h, 4);
      g.stroke();

      if (opts.highlighted) {
        g.strokeColor = C.gold;
        g.lineWidth = 2;
        g.roundRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2, 5);
        g.stroke();
      }

      // 数字
      const suitColor = tile.suit === 'wan' ? C.suitWan : tile.suit === 'tiao' ? C.suitTiao : C.suitTong;
      const numLabel = UIHelper.createLabel(node, `${tile.value}`, {
        size: opts.small ? 14 : 20,
        color: opts.disabled ? C.disabled : suitColor,
        bold: true,
      });
      numLabel.node.setPosition(0, opts.small ? 5 : 7);

      // 花色
      const cnLabel = UIHelper.createLabel(node, SUIT_CN[tile.suit], {
        size: opts.small ? 9 : 13,
        color: opts.disabled ? C.disabled : suitColor,
      });
      cnLabel.node.setPosition(0, opts.small ? -7 : -10);
    }

    if (opts.disabled && !opts.faceDown) {
      const opacity = node.addComponent(UIOpacity);
      opacity.opacity = 160;
    }

    return node;
  }

  /** 绘制面子（碰/杠） */
  static createMeld(parent: Node, meld: Meld, small: boolean = true): Node {
    const count = meld.type === 'Pong' ? 3 : 4;
    const tw = small ? TILE_W_SMALL : TILE_W;
    const th = small ? TILE_H_SMALL : TILE_H;
    const gap = 2;
    const totalW = count * (tw + gap);

    const node = UIHelper.createNode('Meld', totalW, th, parent);

    for (let i = 0; i < count; i++) {
      const faceDown = meld.type === 'ConcealedKong' && (i === 0 || i === 3);
      const tileNode = UIHelper.createTile(node, meld.tile, { small, faceDown });
      const x = -totalW / 2 + tw / 2 + i * (tw + gap);
      tileNode.setPosition(x, 0);
    }

    return node;
  }

  /** 绘制玩家头像 */
  static createAvatar(
    parent: Node,
    radius: number,
    opts: { isBot?: boolean; isActive?: boolean; name?: string; score?: number } = {}
  ): Node {
    const node = new Node('Avatar');
    node.parent = parent;
    const ut = node.addComponent(UITransform);
    ut.setContentSize(new Size(radius * 2 + 6, radius * 2 + 50));

    const g = node.addComponent(Graphics);

    // 外圈 - 玻璃光环
    if (opts.isActive) {
      g.strokeColor = C.gold;
      g.lineWidth = 2.5;
    } else {
      g.strokeColor = new Color(255, 255, 255, 30);
      g.lineWidth = 1.5;
    }
    g.circle(0, 15, radius + 3);
    g.stroke();

    // 内圈 - 深色玻璃
    g.fillColor = opts.isBot ? new Color(60, 40, 80, 220) : new Color(30, 70, 50, 220);
    g.circle(0, 15, radius);
    g.fill();
    // 头像高光
    g.fillColor = new Color(255, 255, 255, 20);
    g.circle(0, 15 + radius * 0.2, radius * 0.7);
    g.fill();

    // 文字
    UIHelper.createLabel(node, opts.isBot ? '机' : '人', {
      size: radius * 0.9,
      color: C.white,
    }).node.setPosition(0, 16);

    if (opts.name) {
      UIHelper.createLabel(node, opts.name, {
        size: 11,
        color: C.white,
      }).node.setPosition(0, 15 - radius - 16);
    }

    if (opts.score !== undefined) {
      UIHelper.createLabel(node, `${opts.score}`, {
        size: 10,
        color: C.goldLight,
      }).node.setPosition(0, 15 - radius - 30);
    }

    return node;
  }

  /** 创建半透明遮罩 - 毛玻璃 */
  static createOverlay(parent: Node, w: number, h: number): Node {
    const node = UIHelper.createNode('Overlay', w, h, parent);
    const g = node.addComponent(Graphics);
    g.fillColor = new Color(5, 8, 15, 200);
    g.rect(-w / 2, -h / 2, w, h);
    g.fill();
    return node;
  }

  /** 创建 Liquid Glass 面板 */
  static createPanel(parent: Node, w: number, h: number, name: string = 'Panel'): Node {
    const node = UIHelper.createNode(name, w, h, parent);
    const g = node.addComponent(Graphics);
    // 玻璃底色
    g.fillColor = new Color(15, 20, 35, 210);
    g.roundRect(-w / 2, -h / 2, w, h, 12);
    g.fill();
    // 顶部高光
    g.fillColor = new Color(255, 255, 255, 12);
    g.roundRect(-w / 2, -h / 2, w, h / 3, 12);
    g.fill();
    // 玻璃边框
    g.strokeColor = new Color(255, 255, 255, 25);
    g.lineWidth = 1;
    g.roundRect(-w / 2, -h / 2, w, h, 12);
    g.stroke();
    return node;
  }

  /** 创建 Liquid Glass 风格面板（带发光边框） */
  static createGlassPanel(parent: Node, w: number, h: number, name: string = 'GlassPanel'): Node {
    const node = UIHelper.createNode(name, w, h, parent);
    const g = node.addComponent(Graphics);
    // 半透明玻璃
    g.fillColor = new Color(255, 255, 255, 10);
    g.roundRect(-w / 2, -h / 2, w, h, 10);
    g.fill();
    // 光泽
    g.fillColor = new Color(255, 255, 255, 8);
    g.roundRect(-w / 2, -h / 2, w, h * 0.4, 10);
    g.fill();
    // 边框
    g.strokeColor = new Color(255, 255, 255, 20);
    g.lineWidth = 1;
    g.roundRect(-w / 2, -h / 2, w, h, 10);
    g.stroke();
    return node;
  }

  /** 创建消息提示 */
  static showToast(parent: Node, text: string, duration: number = 2): void {
    const w = 240;
    const h = 40;
    const node = UIHelper.createPanel(parent, w, h, 'Toast');
    node.setPosition(0, 80);
    UIHelper.createLabel(node, text, { size: 16, color: C.gold, bold: true });

    // 自动移除
    let elapsed = 0;
    const update = (dt: number) => {
      elapsed += dt;
      if (elapsed >= duration) {
        node.off(Node.EventType.TRANSFORM_CHANGED, update);
        node.destroy();
      }
    };
    // 使用 setTimeout 作为简单的定时器
    setTimeout(() => node.destroy(), duration * 1000);
  }
}
