import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 前端 SPA 构建配置：
// - 入口 HTML 在 src/pages/（引用 ../app/main.tsx）
// - 产物输出到 public/app/，由 Node 网关以 /app/ 前缀静态托管
export default defineConfig({
  root: 'src/pages',
  base: '/app/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 开发模式下 API/WS 走本地 Node 网关
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
      '/pose-ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    outDir: '../../public/app',
    assetsDir: 'assets',
    // public/app 目录下只有本 SPA 的构建产物（index.html + assets/），
    // 每次构建先清空，否则带 hash 的旧 chunk 会无限堆积
    // （曾经积累到 90 多个文件 / 约 30MB，拖慢部署同步）。
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // pinyin-pro 体积大且仅「板式格律」页使用：
        // 单独拆包，脱离页面包，便于并行下载与长期缓存。
        manualChunks: {
          'pinyin-pro': ['pinyin-pro'],
        },
      },
    },
  },
});
