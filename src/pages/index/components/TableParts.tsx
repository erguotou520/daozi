import { defineComponent, PropType, type CSSProperties } from 'vue'
import { meldTiles, parseTile, type Meld, type NumberSuit, type Tile } from '@/game/score'
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
            {meldTiles(meld).map((tile, tileIndex) => {
              const hidden = meld.kind === '暗杠' && tileIndex === meldTiles(meld).length - 1
              return <TileView key={tileIndex} tile={hidden ? '' : tile} back={hidden} size="meld" rotate={props.rotate} />
            })}
          </div>
        ))}
      </div>
    )
  }
})

/**
 * 牌河：紧挨着排，不留间距。
 * bounds 模式：尺寸完全交给外层容器（牌桌中央的牌河槽位），放不下自动换行/换列。
 * 每行最多 13 张，多出来的换到下一行，**整条牌河居中**——四家看起来一样整齐。
 * 换行一律往**桌心**长：自家/下家的牌河贴着自己那一边，所以要用 wrap-reverse
 * 把第二行甩到靠桌心的一侧（以前默认换行是往家里长，越打越贴手牌）。
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
    seq: { type: Number, default: 0 },
    /** 尺寸交给外层容器约束（牌河槽位），不再自己按 14 张算宽高 */
    bounds: { type: Boolean, default: false },
    /** 换行方向反过来：第二行往「桌心」那一侧长（自家、下家用） */
    wrapReverse: { type: Boolean, default: false }
  },
  setup(props) {
    return () => {
      // 转 90° 之后占位方向也换过来
      const across = props.rotate ? `calc(var(--t-discard) * ${RATIO})` : 'var(--t-discard)'
      const along = props.rotate ? 'var(--t-discard)' : `calc(var(--t-discard) * ${RATIO})`
      // 一行最多 13 张：再长就换行，整块居中
      const PER_LINE = 13
      // 类名写全，Windi 才扫得到
      const flow = props.vertical
        ? props.wrapReverse
          ? 'flex-col flex-wrap-reverse'
          : 'flex-col flex-wrap'
        : props.wrapReverse
          ? 'flex-row flex-wrap-reverse'
          : 'flex-row flex-wrap'

      return (
        <div
          class={['flex', flow]}
          style={{
            justifyContent: 'center',
            alignContent: 'center',
            maxWidth: props.bounds ? `calc(${PER_LINE} * ${across})` : props.vertical ? across : `calc(${PER_LINE} * ${across})`,
            maxHeight: props.bounds ? `calc(${PER_LINE} * ${along})` : props.vertical ? `calc(${PER_LINE} * ${along})` : along,
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

/** 骰点位置：3×3 格子里哪几格有点 */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8]
}

/** 桌面上的一颗骰子 */
export const Dice = defineComponent({
  name: 'Dice',
  props: {
    value: { type: Number, default: 1 },
    rolling: { type: Boolean, default: false },
    size: { type: String, default: '34px' }
  },
  setup(props) {
    return () => {
      const pips = PIPS[props.value] ?? PIPS[1]
      return (
        <span class={['dice3d', props.rolling ? 'dice-rolling' : '']} style={{ '--dice': props.size } as CSSProperties}>
          {Array.from({ length: 9 }, (_, index) => (
            <span key={index} class={pips.includes(index) ? 'dice-pip' : ''} />
          ))}
        </span>
      )
    }
  }
})

/**
 * 三家 AI 的座位：名字 + 手牌（牌背，赢家亮牌）+ 副露。
 * 副露按「这一家自己的右手边」摆——从桌心看过去，各家右手方向不同：
 * 对面在屏幕左、上家在屏幕下、下家在屏幕上。
 */
export const OpponentSeat = defineComponent({
  name: 'OpponentSeat',
  props: {
    player: { type: Object as PropType<PlayerState | null>, default: null },
    tiles: { type: Array as PropType<Tile[]>, required: true },
    name: { type: String, required: true },
    side: { type: String as PropType<'top' | 'bottom' | 'left' | 'right'>, required: true },
    /** 本局剩余点数 */
    points: { type: Number, default: 50 },
    active: { type: Boolean, default: false },
    dealer: { type: Boolean, default: false },
    reveal: { type: Boolean, default: false },
    /** 三打一：缺另一门的那家把「三家缺的那门」翻开，其余手牌不亮 */
    open: { type: Boolean, default: false },
    openSuit: { type: String as PropType<NumberSuit | null>, default: null },
    /** 发牌动画中：最后一张带入场动画 */
    dealing: { type: Boolean, default: false }
  },
  setup(props) {
    return () => {
      const vertical = props.side === 'left' || props.side === 'right'
      // 左右两家的牌侧着摆，朝桌面中心
      const rotate = props.side === 'left' ? 90 : props.side === 'right' ? -90 : 0
      // 副露在各自的右手边：对面 → 屏幕左；上家 → 屏幕下；下家 → 屏幕上
      const meldFirst = props.side === 'top' || props.side === 'right'

      const hand = (
        <div class={['flex', vertical ? 'flex-col' : 'flex-row']}>
          {props.tiles.map((tile, index) => {
            const face = props.reveal || (props.openSuit !== null && parseTile(tile).suit === props.openSuit)
            return face ? (
              <TileView key={index} tile={tile} size="seat" rotate={rotate} />
            ) : (
              <TileView
                key={index}
                back
                size="seat"
                rotate={rotate}
                enter={props.dealing && index === props.tiles.length - 1}
              />
            )
          })}
        </div>
      )

      const melds =
        props.player && props.player.melds.length > 0 ? (
          <MeldRack melds={props.player.melds} vertical={vertical} rotate={rotate} />
        ) : null

      return (
        <div
          class={[
            'flex gap-1.5 rounded-lg px-1.5 py-1 transition',
            vertical ? 'flex-col items-center' : 'flex-col',
            props.active ? 'seat-active' : ''
          ]}
        >
          {/* 左右两家的名字竖着排（名字 / 点数 / 缺门+张数），免得把手牌和牌墙挤歪 */}
          {vertical ? (
            <div class="flex flex-col items-center gap-[3px] whitespace-nowrap text-[9px] leading-none">
              <span class="flex flex-col items-center gap-[2px]">
                <span class="text-ivory">{props.name}</span>
                {props.dealer && <span class="rounded-[2px] bg-brass px-0.5 text-[8px] leading-3 text-ink">东</span>}
              </span>
              <span class="text-brass">{props.points} 点</span>
              <span class={props.open ? 'text-brass' : 'text-mist'}>
                {props.player?.shortage ? `缺${props.player.shortage}` : '—'} · {props.tiles.length}
                {props.open ? ` · 亮${props.openSuit ?? ''}` : ''}
              </span>
            </div>
          ) : (
            <div class="flex items-baseline gap-1.5 whitespace-nowrap text-[10px] leading-none">
              <span class="flex items-baseline gap-1">
                <span class="text-ivory">{props.name}</span>
                {props.dealer && <span class="rounded-[3px] bg-brass px-1 text-[9px] leading-4 text-ink">东</span>}
                {props.open && <span class="rounded-[3px] bg-brass px-1 text-[9px] leading-4 text-ink">亮{props.openSuit}</span>}
              </span>
              <span class="text-mist">
                {props.player?.shortage ? `缺${props.player.shortage}` : '—'}
              </span>
              <span class="text-brass">{props.points} 点</span>
              <span class="text-mist">{props.tiles.length}</span>
            </div>
          )}

          <div class={['flex gap-[2px]', vertical ? 'flex-col items-center' : 'flex-row items-end']}>
            {meldFirst ? melds : null}
            {hand}
            {meldFirst ? null : melds}
          </div>
        </div>
      )
    }
  }
})
