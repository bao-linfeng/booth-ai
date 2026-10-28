import { defineConfig } from '@vben/vite-config';

export default defineConfig(async () => {
  return {
    application: {},
    vite: {
      server: {
        // Fixed here (not only VITE_PORT in the git-ignored .env.development): falling back to the next
        // port would take another local project's port (agent-template, nyz-rag).
        port: 5031,
        strictPort: true,
        proxy: {
          '/api': {
            changeOrigin: true,
            target: 'http://localhost:3030',
            ws: true,
          },
        },
      },
    },
  };
});
