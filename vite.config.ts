import { defineConfig } from 'vite'
import { resolve } from 'path'
import vueJsx from '@vitejs/plugin-vue-jsx'
import legacy from '@vitejs/plugin-legacy'
import Pages from 'vite-plugin-pages'
import WindiCSS from 'vite-plugin-windicss'

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  plugins: [vueJsx(), WindiCSS(), legacy(), Pages({
    extensions: ['tsx'],
    pagesDir: 'src/pages',
    exclude: ['**/components/**/*.*', '**/blocks/**/*.*', '**/hooks/**/*.*', '**/_*.*'],
    importMode: 'async',
    routeStyle: 'next'
  })]
})
