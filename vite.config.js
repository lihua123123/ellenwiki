import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [],
  build: {
    // 默认清空 outDir：dist/api 由本构建脚本的 build-api.mjs 在 vite build 之后重新生成，
    // 清空不会丢失数据；保留旧产物只会让每次发版把孤儿 chunk 越堆越大（曾达 125MB）。
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
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
