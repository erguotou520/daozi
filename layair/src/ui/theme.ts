/**
 * 倒子麻将 · LayAir 主题
 *
 * 视觉沿用 web 端：深毡绿底、象牙牌面、黄铜描边、朱红印章。
 * 牌面用一张 92KB 的图集贴图（见 tileArt.ts），其它 UI 仍用 Canvas 矢量绘制。
 */

export const COLORS = {
  felt900: '#071C17',
  felt800: '#0B2A22',
  felt700: '#10382E',
  felt600: '#16483A',
  felt500: '#1E5C49',
  ivory: '#F4ECDC',
  ivoryDim: '#E2D5B8',
  ivoryDeep: '#CDBC98',
  edge: '#B8A483',
  edgeDark: '#8E7C5D',
  brass: '#D9B45F',
  brassDim: '#8A7338',
  vermillion: '#C8452F',
  mist: '#9DB8AD',
  ink: '#0A1F1A',
  wood: '#6B4F2E',
  woodLight: '#8A6A3F',
  woodDark: '#2B2118',
  table: '#0F3D31',
  tableLight: '#2A7A5F',
  warn: '#E08A72'
}

/** 万朱、筒靛、条青——按真实牌具的颜色 */
export const SUIT_COLOR: Record<string, string> = {
  万: '#B03A26',
  筒: '#2861A4',
  条: '#1F7A46',
  字: '#4A4238'
}

/** 分牌按传统配色：中红、发绿、白蓝，东南西北用墨色 */
export const HONOR_COLOR: Record<string, string> = {
  中: '#C0392B',
  发: '#1F7A46',
  白: '#2861A4',
  东: '#3D3830',
  南: '#3D3830',
  西: '#3D3830',
  北: '#3D3830'
}

export const FONT_SANS = 'PingFang SC, Microsoft YaHei, Heiti SC, sans-serif'
export const FONT_SERIF = 'Songti SC, STSong, Noto Serif SC, SimSun, serif'

/** 牌面（贴图）的高宽比：和牌面图集单格 128×176 完全一致，贴图才能 100% 铺满 */
export const TILE_FACE_RATIO = 176 / 128

/** 立牌顶部厚度带的厚度 / 牌宽；带内绿 30% + 白 70% */
export const TILE_BAND_RATIO = 0.18

/** 立牌整体的高宽比 = 牌面 + 顶部厚度带 */
export const TILE_RATIO = TILE_FACE_RATIO + TILE_BAND_RATIO

export const SEAT_NAMES = ['自己', '下家', '对面', '上家']
