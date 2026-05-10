import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: __dirname,
  base: './',
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
});
