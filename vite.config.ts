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
          '@': path.resolve(__dirname, 'src'),
        }
      },
      build: {
        rollupOptions: {
          output: {
            // Automaatne chunk'imine jättis 26 faili alla 2 kB — peamiselt
            // üksikud lucide ikoonid, mida jagavad mitu lazy marsruuti. Tootmine
            // vastab HTTP/1.1-ga (vt #177), kus brauseril on ~6 paralleelset
            // ühendust: kümnete pisifailide järjekord maksab rohkem kui nende
            // kogumaht. Vt #188.
            manualChunks(id: string) {
              // Tõlked keele kaupa (#187). Nimetame selgelt, muidu tekivad
              // `index-*.js` nimelised chunkid (kaustade index.ts järgi).
              if (id.includes('/src/locales/et/')) return 'locale-et';
              if (id.includes('/src/locales/en/')) return 'locale-en';

              if (!id.includes('node_modules')) return undefined;

              // Kõik ikoonid ühte chunki ühe päringu asemel kümnete asemel.
              if (id.includes('/lucide-react/')) return 'icons';

              // Raamistik muutub harva → püsib brauseri vahemälus üle deploy'de,
              // samal ajal kui rakenduse kood uueneb.
              if (/\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(id)) {
                return 'vendor-react';
              }

              return undefined;
            },
          },
        },
      }
    };
});
