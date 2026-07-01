import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, '..', 'landing.config.json');

if (!existsSync(configPath)) {
  console.error('\n❌  No se encontró landing.config.json.');
  console.error('   Ejecutá "pnpm o npm run init-landing" antes de hacer build o dev.\n');
  process.exit(1);
}

let config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch {
  console.error('\n❌  landing.config.json inválido. Revisá el formato.');
  console.error('   Si es un proyecto nuevo, corré "pnpm run init-landing".\n');
  process.exit(1);
}

if (!config.initialized) {
  console.error('\n❌  La landing no ha sido inicializada.');
  console.error('   Ejecutá "pnpm o npm run init-landing" para configurar el proyecto.\n');
  process.exit(1);
}
