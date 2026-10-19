import { TableView } from './ui/TableView'

const { regClass } = Laya

@regClass()
export class Main extends Laya.Script {
    private view: TableView | null = null
    private applying = false

    onStart() {
        this.applyLayout()
        Laya.stage.on(Laya.Event.RESIZE, this, this.onResize)
    }

    onDestroy() {
        Laya.stage.off(Laya.Event.RESIZE, this, this.onResize)
        this.view = null
    }

    private onResize() {
        if (this.applying) return
        this.applyLayout()
    }

    /**
     * 手机永远按横屏牌桌布局，不依赖 screenMode / 系统自动旋转：
     * - 竖屏：舞台设成 750 设计宽的竖屏，牌桌根节点整体旋转 90°，填满屏幕；
     *   用户把手机横过来只是把画面看正，布局本身始终是横屏。
     * - 横屏 / 桌面：正常横屏或竖屏布局。
     */
    private applyLayout() {
        if (this.applying) return
        this.applying = true

        const isWxMiniGame = typeof (globalThis as any).wx !== 'undefined'
        const isMobile = Laya.Browser.onMobile || isWxMiniGame
        const sw = Laya.Browser.clientWidth || Laya.stage.width
        const sh = Laya.Browser.clientHeight || Laya.stage.height

        let rotate = false
        let viewW = 0
        let viewH = 0

        if (isMobile && sh > sw) {
            // 手机竖着拿：画布仍是竖屏，但里面的牌桌是横屏尺寸，根节点旋转 90°
            Laya.stage.scaleMode = Laya.Stage.SCALE_FIXED_WIDTH
            Laya.stage.designWidth = 750
            Laya.stage.designHeight = Math.round((750 * sh) / Math.max(1, sw))
            Laya.stage.updateCanvasSize()
            viewW = Laya.stage.height
            viewH = Laya.stage.width
            rotate = true
        } else if (isMobile || sh < sw) {
            // 手机横屏 / 桌面横屏
            Laya.stage.scaleMode = Laya.Stage.SCALE_FIXED_HEIGHT
            Laya.stage.designWidth = 1334
            Laya.stage.designHeight = 750
            Laya.stage.updateCanvasSize()
            viewW = Laya.stage.width
            viewH = Laya.stage.height
        } else {
            // 桌面竖屏窗口保留竖屏布局
            Laya.stage.scaleMode = Laya.Stage.SCALE_FIXED_WIDTH
            Laya.stage.designWidth = 750
            Laya.stage.designHeight = 1334
            Laya.stage.updateCanvasSize()
            viewW = Laya.stage.width
            viewH = Laya.stage.height
        }

        Laya.stage.alignH = Laya.Stage.ALIGN_CENTER
        Laya.stage.alignV = Laya.Stage.ALIGN_MIDDLE

        if (!this.view) {
            this.view = new TableView(this.owner as Laya.Sprite, { rotate, width: viewW, height: viewH })
        } else {
            this.view.applyViewport(rotate, viewW, viewH)
        }

        this.applying = false
    }
}
