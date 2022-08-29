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
        primary: '#2160FF',
        title: '#232C4C',
        subtitle: '#273257',
        desc: '#838EB3',
        border: '#DCE1F2',
        page: '#F8F9FC',
        error: '#ff0000'
      }
    },
    plugins: [lineClampPlugin]
  }
})
