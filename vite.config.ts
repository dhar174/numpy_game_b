import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {license: {fileName: 'dependency-licenses.md'}},
  worker: {format: 'es'},
});
