import { defineConfig } from 'windicss/helpers'
import lineClampPlugin from 'windicss/plugin/line-clamp'

export default defineConfig({
  prefixer: false,
  extract: {
    include: ['src/**/*.{html,jsx,tsx}'],
    // 忽略部分文件夹
    exclude: ['node_modules', '.git', 'dist']
  },
  corePlugins: {
    // 禁用掉在小程序环境中不可能用到的 plugins
    container: false
  },
  theme: {
    extend: {
      colors: {
        // 牌桌毡面
        felt: {
          900: '#071C17',
          800: '#0B2A22',
          700: '#10382E',
          600: '#16483A',
          500: '#1E5C49'
        },
        // 牌面象牙
        ivory: {
          DEFAULT: '#F4ECDC',
          dim: '#E2D5B8',
          deep: '#CDBC98'
        },
        // 牌背 / 厚度
        edge: {
          DEFAULT: '#B8A483',
          dark: '#8E7C5D'
        },
        brass: {
          DEFAULT: '#D9B45F',
          dim: '#8A7338'
        },
        vermillion: '#C8452F',
        mist: '#9DB8AD',
        ink: '#0A1F1A'
      },
      fontFamily: {
        serif: ['Songti SC', 'STSong', 'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'serif']
      },
      boxShadow: {
        tile: '0 4px 0 #B8A483, 0 10px 18px rgba(0, 0, 0, 0.35)',
        'tile-sm': '0 3px 0 #B8A483, 0 6px 10px rgba(0, 0, 0, 0.3)'
      },
      animation: {
        rise: 'rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fadeIn 0.3s ease-out both'
      },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'none' }
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' }
        }
      }
    }
  },
  plugins: [lineClampPlugin]
})
