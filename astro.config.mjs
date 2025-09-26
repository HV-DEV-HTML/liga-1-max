// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// import vue from '@astrojs/vue';

// https://astro.build/config
export default defineConfig({
  compressHTML: false,

  build: {
    assets: '_assets',
    assetsPrefix: 'https://www.claro.com.pe/assets/havas/liga-1-max'
  },

  vite: {
    plugins: [tailwindcss()]
  },

  // integrations: [vue()]
});