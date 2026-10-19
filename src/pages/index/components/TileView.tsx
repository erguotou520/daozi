import { defineComponent, PropType, type CSSProperties } from 'vue'
import { parseTile, type Tile } from '@/game/score'

/** 身份色：万朱、筒靛、条青——按真实牌具的颜色，比通用墨色更醒目 */
const SUIT_COLOR: Record<string, string> = {
  万: '#B03A26',
  筒: '#2861A4',
  条: '#1F7A46',
  字: '#4A4238'
}

/** 分牌按传统配色：中红、发绿、白蓝，东南西北用墨色 */
const HONOR_COLOR: Record<string, string> = {
  中: '#C0392B',
  发: '#1F7A46',
  白: '#2861A4',
  东: '#3D3830',
  南: '#3D3830',
  西: '#3D3830',
  北: '#3D3830'
}

export type TileSizeKey = 'hand' | 'seat' | 'discard' | 'meld'

/** 尺寸令牌 → 牌桌上定义的 CSS 变量，手机到桌面共用一套布局 */
const SIZE_VAR: Record<TileSizeKey, string> = {
  hand: 'var(--t-hand)',
  seat: 'var(--t-seat)',
  discard: 'var(--t-discard)',
  meld: 'var(--t-meld)'
}

/** 牌的高宽比（和 `.tile-box` 的 aspect-ratio 保持一致） */
const RATIO = 4.1 / 3

/**
 * 一张牌：牌面或牌背。
 * 3D 效果做在牌体上——牌面是一块有厚度的象牙砖，镜头从斜上方看下来（2.5D），
 * 所以每张牌自己带一点 rotateX，底部的厚度边就是牌的「侧面」。
 */
const TileView = defineComponent({
  name: 'TileView',
  props: {
    tile: { type: String as PropType<Tile>, default: '' },
    back: { type: Boolean, default: false },
    size: { type: String as PropType<TileSizeKey>, default: 'hand' },
    dim: { type: Boolean, default: false },
    raised: { type: Boolean, default: false },
    /** 桌面最近打出的那张：加黄铜描边做标记 */
    marked: { type: Boolean, default: false },
    /** 刚上手的新牌，播一下入场 */
    enter: { type: Boolean, default: false },
    rotate: { type: Number, default: 0 }
  },
  setup(props) {
    return () => {
      const width = SIZE_VAR[props.size]
      const height = `calc(${width} * ${RATIO})`
      const markedStyle: CSSProperties = props.marked
        ? { outline: '2px solid var(--brass)', outlineOffset: '1px', zIndex: 2 }
        : {}

      const body = props.back ? (
        <span class="tile3d-body tile3d-back" />
      ) : (
        (() => {
          const info = parseTile(props.tile)
          const honor = info.suit === '字'
          return (
            <span
              class="tile3d-body tile3d-face"
              style={{ color: honor ? HONOR_COLOR[props.tile] ?? SUIT_COLOR['字'] : SUIT_COLOR[info.suit] }}
            >
              <span class="tile3d-rank" style={{ fontSize: `calc(${width} * 0.54)` }}>
                {honor ? props.tile : info.rank}
              </span>
              {!honor && (
                <span class="tile3d-suit" style={{ fontSize: `calc(${width} * 0.3)` }}>
                  {info.suit}
                </span>
              )}
            </span>
          )
        })()
      )

      const inner = (
        <span
          class={['tile3d', props.enter ? 'tile-in' : '', props.marked ? 'tile-mark' : '']}
          style={{ width, height, opacity: props.dim ? '0.45' : '1', ...markedStyle }}
        >
          {body}
          {/* 牌正对镜头的那道厚度边 */}
          <span class={['tile3d-side', props.back ? 'is-back' : '']} />
        </span>
      )

      if (!props.rotate) return inner

      // 转 90° 后占位要换成「高 × 宽」，否则布局还是按原来的方向排
      return (
        <span
          class="relative inline-block shrink-0"
          style={{
            width: `calc(${width} * ${RATIO})`,
            height: width,
            transform: props.raised ? 'translateY(-4px)' : undefined
          }}
        >
          <span
            class="absolute left-1/2 top-1/2"
            style={{ transform: `translate(-50%, -50%) rotate(${props.rotate}deg)` }}
          >
            {inner}
          </span>
        </span>
      )
    }
  }
})

/**
 * 牌山上的一墩。
 *
 * 一墩两只牌，前后叠着放：每只都是一张躺平的牌，画成「淡绿顶面 + 象牙侧厚」，
 * 正正经经的矩形——**不切斜**。后层在上（远离桌心），前层在下（贴着桌心），
 * 前层压住后层的下缘，所以一墩从上到下是「绿 / 白 / 绿 / 白」，
 * 两层各自露出一段完整的绿+白，一眼就能读出是两只牌。
 *
 * **摸走一只就少一只**：摸走一只后，这一墩改成「一整只牌铺满整格」——
 * 绿顶面只剩一条、象牙侧厚占满剩下的高度，牌墙的外形始终是一整条，
 * 不会在墩里留下半格空洞（以前只画剩下的那一层，横墙缺下半截、竖墙缺半边）。
 * 两只都摸走才整个空出来。
 */
export const WallStack = defineComponent({
  name: 'WallStack',
  props: {
    /** 后层（上层，先被摸走的那只） */
    top: { type: Boolean, default: true },
    /** 前层（下层） */
    bottom: { type: Boolean, default: true },
    /** 竖着的墙：整墩转 90° */
    flat: { type: Boolean, default: false },
    /** 左墙转另一边 */
    flip: { type: Boolean, default: false }
  },
  setup(props) {
    return () => {
      const empty = !props.top && !props.bottom
      // 摸走哪一层就少哪一层：只剩上层只画上半格，只剩下层只画下半格，
      // 整墩不会因为剩一只牌就撑满两格高度（会在墙上留一个真实的缺口）。
      const cls = ['wall-stack', empty ? 'is-none' : 'is-full', props.flat ? 'is-flat' : '', props.flip ? 'is-flipped' : '']
        .filter(Boolean)
        .join(' ')
      if (empty) return <span class={cls} />
      // 后层先画（被前层压住下半截），前层后画盖在上面
      const tile = (pos: 'front' | 'back') => (
        <span class={`wall-tile is-${pos}`}>
          <span class="wall-tile-face" />
          <span class="wall-tile-side" />
        </span>
      )
      return (
        <span class={cls}>
          <span class="wall-body">
            {props.top && tile('back')}
            {props.bottom && tile('front')}
          </span>
        </span>
      )
    }
  }
})

/** 一整面牌墙：17 墩按 [上层, 下层] 原位渲染，抓空的墩是空占位（墙从抓牌端变短） */
export const WallLine = defineComponent({
  name: 'WallLine',
  props: {
    stacks: { type: Array as PropType<Array<[boolean, boolean]>>, required: true },
    flat: { type: Boolean, default: false },
    flip: { type: Boolean, default: false }
  },
  setup(props) {
    return () => (
      <div class={['flex gap-[var(--wall-gap)]', props.flat ? 'flex-col' : 'flex-row']}>
        {props.stacks.map(([top, bottom], index) => (
          <WallStack key={index} top={top} bottom={bottom} flat={props.flat} flip={props.flip} />
        ))}
      </div>
    )
  }
})

export default TileView
