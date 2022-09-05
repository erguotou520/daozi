import { defineConfig } from 'vite'
import { resolve } from 'path'
import vueJsx from '@vitejs/plugin-vue-jsx'
import legacy from '@vitejs/plugin-legacy'
import Pages from 'vite-plugin-pages'
import WindiCSS from 'vite-plugin-windicss'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  plugins: [
    vueJsx(),
    WindiCSS(),
    legacy(),
    Pages({
      extensions: ['tsx'],
      pagesDir: 'src/pages',
      exclude: ['**/components/**/*.*', '**/blocks/**/*.*', '**/hooks/**/*.*', '**/_*.*'],
      importMode: 'async',
      routeStyle: 'next'
    }),
    VitePWA({
      injectRegister: 'auto',
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true
      },
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: '和县刀子',
        short_name: '和县刀子',
        description: '和县刀子工具箱',
        theme_color: '#ffffff',
        icons: [
          {
            src: 'logo-192_192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'logo-512_512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ]
})
