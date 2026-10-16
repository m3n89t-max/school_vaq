import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0', // 네트워크에서 접근 가능하도록 설정
    proxy: {
      '/api': {
        target: 'http://localhost:8000', // PLC 브릿지 서버 포트
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true
      }
    }
  }
});

