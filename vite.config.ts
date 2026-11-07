import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 使用相对 base，方便本地预览、GitHub Pages（项目页）以及任意子路径部署
export default defineConfig({
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
})
