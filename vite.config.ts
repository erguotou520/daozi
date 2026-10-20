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
  server: {
    // 必须显式绑 0.0.0.0：
    // 默认只监听 localhost，Node 在 IPv6 环境里会绑成 [::1]，
    // 浏览器 / 手机如果用 127.0.0.1 或局域网 IP 打开就是 connection refused ——
    // 页面加载不出来，看起来就是一片灰/白屏。
    host: '0.0.0.0',
    port: 5199
  },
  preview: {
    host: '0.0.0.0'
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
      // 开发时不要注册 Service Worker：改完代码后旧 SW 会继续喂缓存的旧 chunk，
      // 表现出来就是打开一片灰屏 / 白屏，只能手动清站点数据。构建产物里 SW 照常生效。
      devOptions: {
        enabled: false
      },
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: '和县刀子',
        short_name: '和县刀子',
        description: '和县刀子 · 算分与对局',
        theme_color: '#0B2A22',
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
