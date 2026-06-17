import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: resolve('./src/renderer'),
    envDir: resolve('.'),
    build: {
      rollupOptions: {
        input: {
          index: resolve('./src/renderer/index.html')
        }
      }
    },
    plugins: [react()]
  }
})
