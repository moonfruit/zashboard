import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const src = fileURLToPath(new URL('../src', import.meta.url))

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
    __APP_REPO__: JSON.stringify('moonfruit/zashboard'),
  },
  resolve: {
    alias: { '@': src },
  },
  server: {
    fs: { allow: ['..'] },
  },
  test: {
    environment: 'happy-dom',
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**'],
  },
})
