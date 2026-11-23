import { defineConfig, type ProxyOptions } from 'vite';

/**
 * Сервер SIGÉOM отклоняет запросы с заголовком Origin (fetch из браузера),
 * поэтому запросы информации об объекте (GetFeatureInfo) идут через прокси Vite,
 * который этот заголовок убирает. Тайлы-картинки грузятся напрямую.
 */
const sigeom: ProxyOptions = {
  target: 'https://servicesvectoriels.atlas.gouv.qc.ca',
  changeOrigin: true,
  rewrite: (p) => p.replace(/^\/sigeom/, ''),
  configure: (proxy) => {
    proxy.on('proxyReq', (req) => {
      req.removeHeader('origin');
      req.removeHeader('referer');
    });
  },
};

const proxy = { '/sigeom': sigeom };

export default defineConfig({
  server: { host: true, port: 5173, proxy },
  preview: { host: true, port: 4173, proxy },
  build: { target: 'es2022', chunkSizeWarningLimit: 1000 },
});
