import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import { siteCrawlPlugin } from './vite-plugins/site-crawl.js';
import { uploadDataPlugin } from './vite-plugins/upload-data.js';

export default defineConfig({
  plugins: [react(), uploadDataPlugin(), siteCrawlPlugin()],
  server: {
    port: 5173,
    open: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
