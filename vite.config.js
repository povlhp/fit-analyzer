import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    exclude: ['@garmin/fitsdk']
  },
  build: {
    target: 'esnext'
  }
});
