import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Backend server IP arenduses (muuda vastavalt oma võrgule)
const DEV_BACKEND = '172.17.120.146';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/meili': {
            target: `http://${DEV_BACKEND}:7700`,
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/meili/, ''),
          },
          '/api/images': {
            target: `http://${DEV_BACKEND}:8001`,
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/images/, ''),
          },
          '/api/files': {
            target: `http://${DEV_BACKEND}:8002`,
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/files/, ''),
          },
        },
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.MEILI_API_KEY': JSON.stringify(env.MEILI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
