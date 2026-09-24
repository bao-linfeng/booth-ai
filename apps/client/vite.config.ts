import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import autoprefixer from 'autoprefixer'
import tailwind from 'tailwindcss'
import { defineConfig } from 'vite'

export default defineConfig({
  css: {
    postcss: {
      plugins: [tailwind(), autoprefixer()],
    },
    devSourcemap: false,
  },
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve('./src')
    }
  },
  build: {
    target: 'esnext',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info'],
        passes: 2
      },
      format: {
        comments: false,
        preserve_annotations: false
      },
      mangle: {
        toplevel: true
      }
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('vue')) {
              return 'vue-core';
            }
            if (id.includes('@vueuse')) {
              return 'vue-use';
            }
            if (id.includes('radix-vue')) {
              return 'radix';
            }
            return 'vendors';
          }
        }
      }
    },
    assetsInlineLimit: 4096,
    sourcemap: false,
    cssCodeSplit: true,
    modulePreload: {
      polyfill: true
    }
  },
  server: {
    hmr: {
      overlay: false
    }
  },
  optimizeDeps: {
    include: ['@/composables/useFont']
  }
})