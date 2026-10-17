import { defineComponent, PropType, type CSSProperties } from 'vue'
import { parseTile, type Tile } from '@/game/score'

/** 身份色：万朱、筒靛、条青、字墨。给牌面一点传统牌具的辨识度，不是装饰。 */
const SUIT_COLOR: Record<string, string> = {
  万: '#B2452C',
  筒: '#2F5D8C',
  条: '#2E6B45',
  字: '#4A4238'
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
 * 一张牌：牌面或牌背，宽度由令牌决定。
 * `rotate` 用来把左右两家的牌转 90°——真实码牌就是侧着摆的。
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
      const markedStyle: CSSProperties = props.marked
        ? { outline: '2px solid var(--brass)', outlineOffset: '1px', zIndex: 1 }
        : {}

      const inner = props.back ? (
        <span
          class={['tile-box inline-block shrink-0 rounded-[3px]', props.enter ? 'tile-in' : '', props.marked ? 'tile-mark' : '']}
          style={{
            width,
            backgroundImage: 'linear-gradient(180deg, #2E6A55 0%, #1A4A3B 100%)',
            boxShadow: '0 2px 0 #0C261F, inset 0 1px 0 rgba(255, 255, 255, 0.14)',
            opacity: props.dim ? '0.5' : '1',
            ...markedStyle
          }}
        />
      ) : (
        (() => {
          const info = parseTile(props.tile)
          const honor = info.suit === '字'
          return (
            <span
              class={[
              'tile-box tile-face-sm inline-flex shrink-0 flex-col items-center justify-center rounded-[4px]',
              props.enter ? 'tile-in' : '',
              props.marked ? 'tile-mark' : ''
            ]}
              style={{
                width,
                color: SUIT_COLOR[info.suit],
                opacity: props.dim ? '0.42' : '1',
                ...markedStyle
              }}
            >
              <span class="font-serif leading-none" style={{ fontSize: `calc(${width} * 0.52)` }}>
                {honor ? props.tile : info.rank}
              </span>
              {!honor && (
                <span
                  class="leading-none"
                  style={{ fontSize: `calc(${width} * 0.3)`, opacity: 0.7, marginTop: '0.08em' }}
                >
                  {info.suit}
                </span>
              )}
            </span>
          )
        })()
      )

      if (!props.rotate) return inner

      // 转 90° 后占位要换成"高 × 宽"，否则布局还是按原来的方向排
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
 * 牌山上的一墩：两层。哪一层被摸走了就留一个空位，
 * 所以整圈牌墙的长度不会变，只是从上往下、先上层后下层地空掉。
 */
export const WallStack = defineComponent({
  name: 'WallStack',
  props: {
    top: { type: Boolean, default: true },
    bottom: { type: Boolean, default: true },
    flat: { type: Boolean, default: false }
  },
  setup(props) {
    return () => (
      <span class={['wall-stack', props.flat ? 'is-flat' : '']}>
        <span class="wall-layer" style={{ visibility: props.top ? 'visible' : 'hidden' }} />
        <span class="wall-layer" style={{ visibility: props.bottom ? 'visible' : 'hidden' }} />
      </span>
    )
  }
})

/** 一整面牌墙：17 墩，每墩按 [上层, 下层] 画 */
export const WallLine = defineComponent({
  name: 'WallLine',
  props: {
    stacks: { type: Array as PropType<Array<[boolean, boolean]>>, required: true },
    flat: { type: Boolean, default: false }
  },
  setup(props) {
    return () => (
      <div class={['flex gap-[2px]', props.flat ? 'flex-col' : 'flex-row']}>
        {props.stacks.map(([top, bottom], index) => (
          <WallStack key={index} top={top} bottom={bottom} flat={props.flat} />
        ))}
      </div>
    )
  }
})

export default TileView
