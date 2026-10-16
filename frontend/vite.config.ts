import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from any sub-path (GitHub Pages, S3, etc.).
  base: './',
  server: {
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://localhost:3002' },
  },
});
