import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src')
      }
    },
    define: {
      __FEATURE_FLAGS__: env.VITE_FEATURE_FLAGS ? env.VITE_FEATURE_FLAGS.split(',') : []
    },
    server: {
      port: 5173,
      host: '0.0.0.0'
    }
  };
});
