import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: process.env.GITHUB_PAGES ? '/my-projects/' : '/',
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  server: {
    open: true,
  },
});
