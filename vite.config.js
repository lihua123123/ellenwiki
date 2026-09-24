import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [],
  build: {
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
