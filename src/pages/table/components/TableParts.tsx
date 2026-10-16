import { defineComponent, PropType } from 'vue'
import { meldTiles, type Meld, type Tile } from '@/game/score'
import type { PlayerState } from '@/game/game'
import TileView from './TileView'

/** 牌的高宽比，跟 TileView 保持一致 */
const RATIO = 4.1 / 3

/** 副露：黄铜细框 + 实际牌面，放在各自手牌的右手侧 */
export const MeldRack = defineComponent({
  name: 'MeldRack',
  props: {
    melds: { type: Array as PropType<Meld[]>, required: true },
    vertical: { type: Boolean, default: false },
    rotate: { type: Number, default: 0 }
  },
  setup(props) {
    return () => (
      <div class={['flex gap-1', props.vertical ? 'flex-col' : 'flex-wrap']}>
        {props.melds.map((meld, index) => (
          <div
            key={index}
            class={['flex gap-[1px] rounded-[4px] p-[2px]', props.vertical ? 'flex-col' : 'flex-row']}
            style={{ border: '1px solid rgba(217, 180, 95, 0.32)', background: 'rgba(0, 0, 0, 0.2)' }}
          >
            {meldTiles(meld).map((tile, tileIndex) => (
              <TileView key={tileIndex} tile={tile} size="meld" rotate={props.rotate} />
            ))}
          </div>
        ))}
      </div>
    )
  }
})

/**
 * 牌河：紧挨着排，不留间距；横家每行最多 14 张，竖家每列最多 14 张。
 * 左右两家的牌跟手牌一样转 90°。
 */
export const DiscardLane = defineComponent({
  name: 'DiscardLane',
  props: {
    discards: { type: Array as PropType<Tile[]>, required: true },
    vertical: { type: Boolean, default: false },
    rotate: { type: Number, default: 0 },
    /** 这一条牌河里最后打出的那张要特殊标记 */
    markLast: { type: Boolean, default: false },
    /** 每次动作递增，标记牌的 key 跟着变，动画才会重播 */
    seq: { type: Number, default: 0 }
  },
  setup(props) {
    return () => {
      // 转 90° 之后占位方向也换过来
      const across = props.rotate ? `calc(var(--t-discard) * ${RATIO})` : 'var(--t-discard)'
      const along = props.rotate ? 'var(--t-discard)' : `calc(var(--t-discard) * ${RATIO})`

      return (
        <div
          class={['flex', props.vertical ? 'my-auto flex-col flex-wrap' : 'mx-auto flex-row flex-wrap']}
          style={{
            justifyContent: props.vertical ? 'flex-start' : 'center',
            alignContent: 'center',
            maxWidth: props.vertical ? across : `calc(14 * ${across})`,
            maxHeight: props.vertical ? `calc(14 * ${along})` : along,
            minWidth: across,
            minHeight: along
          }}
        >
          {props.discards.map((tile, index, list) => {
            const isLast = props.markLast && index === list.length - 1
            return (
              <TileView
                key={isLast ? `mark-${props.seq}` : `d-${index}`}
                tile={tile}
                size="discard"
                rotate={props.rotate}
                marked={isLast}
              />
            )
          })}
        </div>
      )
    }
  }
})

/** 三家 AI 的座位：名字 + 手牌（牌背，赢家亮牌）+ 副露 */
export const OpponentSeat = defineComponent({
  name: 'OpponentSeat',
  props: {
    player: { type: Object as PropType<PlayerState>, required: true },
    name: { type: String, required: true },
    side: { type: String as PropType<'top' | 'bottom' | 'left' | 'right'>, required: true },
    active: { type: Boolean, default: false },
    dealer: { type: Boolean, default: false },
    reveal: { type: Boolean, default: false }
  },
  setup(props) {
    return () => {
      const vertical = props.side === 'left' || props.side === 'right'
      // 左右两家的牌侧着摆，朝桌面中心
      const rotate = props.side === 'left' ? 90 : props.side === 'right' ? -90 : 0
      return (
        <div
          class={['flex gap-1.5 rounded-lg px-1.5 py-1 transition', vertical ? 'flex-col items-center' : 'flex-col']}
          style={
            props.active
              ? { background: 'rgba(217, 180, 95, 0.12)', boxShadow: 'inset 0 0 0 1px rgba(217,180,95,0.45)' }
              : undefined
          }
        >
          {/* 左右两家的名字窄，竖着排两行，免得把手牌和牌河挤歪 */}
          <div
            class={[
              'flex whitespace-nowrap text-[10px] leading-none',
              vertical ? 'flex-col items-center gap-1' : 'items-baseline gap-1.5'
            ]}
          >
            <span class="flex items-baseline gap-1">
              <span class="text-ivory">{props.name}</span>
              {props.dealer && <span class="rounded-[3px] bg-brass px-1 text-[9px] leading-4 text-ink">东</span>}
            </span>
            <span class="text-mist">
              {props.player.shortage ? `缺${props.player.shortage}` : '—'} {props.player.hand.length}
            </span>
          </div>

          <div class={['flex gap-[2px]', vertical ? 'flex-col' : 'flex-row']}>
            {props.player.hand.map((tile, index) =>
              props.reveal ? (
                <TileView key={index} tile={tile} size="seat" rotate={rotate} />
              ) : (
                <TileView key={index} back size="seat" rotate={rotate} />
              )
            )}
          </div>

          {props.player.melds.length > 0 && (
            <MeldRack melds={props.player.melds} vertical={vertical} rotate={rotate} />
          )}
        </div>
      )
    }
  }
})
