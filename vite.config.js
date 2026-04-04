import { defineConfig } from 'vite';

export default defineConfig({
  base: '/fit-analyzer/',
  optimizeDeps: {
    exclude: ['@garmin/fitsdk']
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          chart: ['chart.js', 'chartjs-plugin-zoom'],
          leaflet: ['leaflet'],
          fitsdk: ['@garmin/fitsdk']
        }
      }
    }
  }
});
