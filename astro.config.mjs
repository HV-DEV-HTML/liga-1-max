// @ts-check
import { defineConfig } from 'astro/config';
import { readFileSync } from 'fs';

const landingConfig = JSON.parse(
  readFileSync(new URL('./landing.config.json', import.meta.url), 'utf-8')
);

const vitePlugins = [];

if (landingConfig.useTailwind) {
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  vitePlugins.push(tailwindcss());
}

// https://astro.build/config
export default defineConfig({
  compressHTML: false,
  build: {
    assets: '_assets',
    assetsPrefix: landingConfig.assetsPrefix,
  },
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
    plugins: vitePlugins,
  },
});