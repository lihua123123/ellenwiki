import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [],
  build: {
    // 沙箱/CI 环境下 dist/api 由 wrangler 产物构成，整体清空会触发批量删除保护，
    // 这里关闭自动清空 outDir，由 build-api.mjs 负责覆盖写入。
    emptyOutDir: false,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    // 本地开发：/api/* 交给 wrangler dev（`npm run api`）的 Worker 处理
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
});
