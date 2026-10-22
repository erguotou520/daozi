/**
 * Cocos Creator 3.8 类型存根 - 用于本地 TypeScript 编译验证
 * 实际项目在 Cocos Creator 编辑器中打开时会使用引擎自带的完整类型定义
 */

declare module 'cc' {
  export namespace _decorator {
    function ccclass(name?: string): ClassDecorator;
    function property(options?: any): PropertyDecorator;
    function property(type: any): PropertyDecorator;
  }

  export class Vec2 {
    x: number;
    y: number;
    constructor(x?: number, y?: number);
  }

  export class Vec3 {
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number);
  }

  export class Size {
    width: number;
    height: number;
    constructor(width?: number, height?: number);
  }

  export class Color {
    r: number;
    g: number;
    b: number;
    a: number;
    constructor(r?: number, g?: number, b?: number, a?: number);
  }

  export class Rect {
    x: number;
    y: number;
    width: number;
    height: number;
    constructor(x?: number, y?: number, width?: number, height?: number);
  }

  export class Node {
    name: string;
    active: boolean;
    parent: Node | null;
    children: readonly Node[];
    constructor(name?: string);
    setPosition(x: number, y: number, z?: number): void;
    getPosition(): Vec3;
    addComponent<T extends Component>(type: new () => T): T;
    addComponent(type: any): any;
    getComponent<T extends Component>(type: new () => T): T | null;
    getComponent(type: any): any;
    removeAllChildren(): void;
    destroy(): void;
    on(type: string, callback: Function, target?: any): void;
    off(type: string, callback?: Function, target?: any): void;
    static EventType: {
      TOUCH_START: string;
      TOUCH_MOVE: string;
      TOUCH_END: string;
      TOUCH_CANCEL: string;
      TRANSFORM_CHANGED: string;
    };
  }

  export class Component {
    node: Node;
    enabled: boolean;
    start(): void;
    update(dt: number): void;
    onDestroy(): void;
  }

  export class UITransform extends Component {
    contentSize: Size;
    setContentSize(size: Size): void;
    setContentSize(width: number, height: number): void;
    convertToNodeSpaceAR(worldPoint: Vec3, out?: Vec3): Vec3;
  }

  export class Label extends Component {
    string: string;
    fontSize: number;
    color: Color;
    isBold: boolean;
    horizontalAlign: number;
    verticalAlign: number;
    overflow: number;
    cacheMode: number;
    static CacheMode: { NONE: number; BITMAP: number; CHAR: number };
  }

  export class Graphics extends Component {
    fillColor: Color;
    strokeColor: Color;
    lineWidth: number;
    rect(x: number, y: number, w: number, h: number): void;
    roundRect(x: number, y: number, w: number, h: number, r: number): void;
    circle(cx: number, cy: number, r: number): void;
    fill(): void;
    stroke(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    close(): void;
    clear(): void;
  }

  export class Sprite extends Component {
    spriteFrame: any;
    color: Color;
  }

  export class Button extends Component {
    transition: number;
    static Transition: { NONE: number; COLOR: number; SPRITE: number; SCALE: number };
    static EventType: { CLICK: string };
  }

  export class EditBox extends Component {
    string: string;
    placeholder: string;
    maxLength: number;
    inputFlag: number;
    fontSize: number;
    placeholderFontSize: number;
    fontColor: Color;
    placeholderFontColor: Color;
    static InputFlag: { PASSWORD: number; SENSITIVE: number; INITIAL_CAPS_WORD: number; INITIAL_CAPS_SENTENCE: number; INITIAL_CAPS_ALL_CHARACTERS: number };
  }

  export class Widget extends Component {
    isAlignTop: boolean;
    isAlignBottom: boolean;
    isAlignLeft: boolean;
    isAlignRight: boolean;
    top: number;
    bottom: number;
    left: number;
    right: number;
  }

  export class UIOpacity extends Component {
    opacity: number;
  }

  export class Canvas extends Component {}
  export class Camera extends Component {}

  export class EventTouch {
    getUILocation(): Vec2;
    target: any;
  }

  export const Overflow: { NONE: number; CLAMP: number; SHRINK: number; RESIZE_HEIGHT: number };
  export const HorizontalTextAlignment: { LEFT: number; CENTER: number; RIGHT: number };
  export const VerticalTextAlignment: { TOP: number; CENTER: number; BOTTOM: number };

  export const view: {
    getVisibleSize(): Size;
    setDesignResolutionSize(width: number, height: number, resolutionPolicy: number): void;
  };

  export const sys: {
    localStorage: {
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
      removeItem(key: string): void;
    };
  };

  export const director: {
    loadScene(sceneName: string, onLaunched?: Function): void;
    getScene(): any;
  };

  export const resources: {
    load(path: string, type: any, callback: (err: Error | null, asset: any) => void): void;
  };
}
