import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    resolve: { alias: { '@core': resolve('src/core') } }
  },
  preload: {},
  renderer: {
    resolve: { alias: { '@core': resolve('src/core') } },
    plugins: [react(), tailwindcss()]
  }
})
