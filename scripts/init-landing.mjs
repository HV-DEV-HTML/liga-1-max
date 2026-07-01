import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer.trim()));
  });
}

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const globalCssWithTailwind = `@import "tailwindcss" important;
@theme {
  --font-roboto: "Roboto", sans-serif; 
  --font-amx-bold: "AMX", sans-serif;
  --font-amx-regular: 'AMX Regular', sans-serif;
  --font-amx-medium: 'AMX Medium', sans-serif;
  --font-amx-black: 'AMX Black', sans-serif;
  --breakpoint-2xl: 94rem;
  --breakpoint-container-2xl: 1440px;
  --color-claro: #DA291C;
  --color-claro-dark: #9F1C12;
}

@utility container {
  @media (width >= theme(--breakpoint-xl)) {
    max-width: 1280px;
  }
  @media (width >= theme(--breakpoint-2xl)) {
    max-width: var(--breakpoint-container-2xl);
  }
}

:root{
  --swiper-pagination-bullet-width: 10px;
  --swiper-pagination-bullet-height: 10px;
  --swiper-navigation-color: #DE187D;
  --swiper-pagination-color: #DA291C;
}

.headerEv .hdMainLeft .logo img{
  max-width: fit-content;
}

.claro_fixed{
  position: fixed;
}
`;

const globalCssNoTailwind = `:root{
  --swiper-pagination-bullet-width: 10px;
  --swiper-pagination-bullet-height: 10px;
  --swiper-navigation-color: #DE187D;
  --swiper-pagination-color: #DA291C;
}

.headerEv .hdMainLeft .logo img{
  max-width: fit-content;
}

.claro_fixed{
  position: fixed;
}
`;

async function main() {
  console.log('\n🚀  Inicializar landing\n');

  const name = await ask('  Nombre de la landing (ej: Prepago Móvil): ');
  if (!name) {
    console.log('\n  ✋  Cancelado — el nombre es obligatorio.\n');
    rl.close();
    return;
  }

  const slug = slugify(name);
  const defaultMosaic = slug;
  const mosaicInput = await ask(`  Carpeta en Mosaic (ej: prepago) [${defaultMosaic}]: `);
  const mosaicFolder = mosaicInput || defaultMosaic;

  const assetsPrefix = `https://www.claro.com.pe/assets/havas/${mosaicFolder}`;

  const cmsUrl = await ask('  URL del CMS — backoffice authoring (opcional, ej: https://pe-backoffice-portal.../wps/myportal/...): ');

  let extraCmsTargets = [];
  if (cmsUrl) {
    const multiVisorInput = await ask('  ¿Esta landing se subirá a múltiples visores de contenido en el CMS? (s/N): ');
    const multiVisor = multiVisorInput.toLowerCase() === 's' || multiVisorInput.toLowerCase() === 'y';

    if (multiVisor) {
      console.log('\n  Configurar visores adicionales (podés dejar el cmsContentId vacío para completarlo después con el snippet)\n');
      let addAnother = true;
      while (addAnother) {
        const targetId = await ask('    ID del target (ej: "banner", "secondary"): ');
        if (!targetId) { console.log('    ✋  ID requerido. Saliendo del loop.\n'); break; }
        const targetContentId = await ask(`    cmsContentId para "${targetId}" (opcional, completar después): `);
        const targetCmsUrl = await ask(`    cmsUrl para "${targetId}" (Enter para usar el mismo que el principal): `);
        const entry = { id: targetId, cmsContentId: targetContentId || '' };
        if (targetCmsUrl) entry.cmsUrl = targetCmsUrl;
        extraCmsTargets.push(entry);
        console.log(`    ✅  Target "${targetId}" agregado\n`);
        const moreInput = await ask('  ¿Agregar otro visor? (s/N): ');
        addAnother = moreInput.toLowerCase() === 's' || moreInput.toLowerCase() === 'y';
      }
    }
  }

  const publicUrl = await ask('  URL pública de la landing (opcional, ej: https://www.claro.com.pe/test): ');

  const basecampUrl = await ask('  URL de Basecamp (opcional — link al requerimiento): ');

  const tailwindInput = await ask('  ¿Usar Tailwind CSS? (S/n): ');
  const useTailwind = tailwindInput === '' || tailwindInput.toLowerCase() === 's' || tailwindInput.toLowerCase() === 'y';

  // --- Resumen ---
  console.log('\n  📋  Resumen');
  console.log(`       Nombre:        ${name}`);
  console.log(`       Mosaic folder: ${mosaicFolder}`);
  console.log(`       assetsPrefix:  ${assetsPrefix}`);
  console.log(`       Tailwind CSS:  ${useTailwind ? 'Sí' : 'No'}`);
  if (cmsUrl) console.log(`       CMS authoring: ${cmsUrl}`);
  if (extraCmsTargets.length > 0) {
    console.log(`       Visores extra:  ${extraCmsTargets.map(t => t.id).join(', ')}`);
  }
  if (publicUrl) console.log(`       URL pública:   ${publicUrl}`);
  if (basecampUrl) console.log(`       Basecamp:      ${basecampUrl}`);

  if (!useTailwind) {
    console.log('\n  ⚠️  AVISO: Al no usar Tailwind, los componentes del template');
    console.log('       (Button, Header, etc.) no funcionarán porque usan');
    console.log('       clases Tailwind. Vas a tener que crearlos desde cero.');
  }

  const confirm = await ask('\n  ¿Proceder? (S/n): ');
  const proceed = confirm === '' || confirm.toLowerCase() === 's' || confirm.toLowerCase() === 'y';

  if (!proceed) {
    console.log('\n  ✋  Cancelado.\n');
    rl.close();
    return;
  }

  // --- 1. Escribir landing.config.json ---
  const landingConfig = {
    initialized: true,
    useTailwind,
    name,
    slug,
    mosaicFolder,
    assetsPrefix,
    cmsUrl: cmsUrl || '',
    publicUrl: publicUrl || '',
    cmsContentId: '',
    _cmsContentId_howto: "UUID del componente 'CP HTML Avanzado' en WCM. Para descubrirlo: activar Modalidad de edición en el portal y ejecutar el snippet de consola del README §Descubrir el cmsContentId.",
    ...(extraCmsTargets.length > 0 && { extraCmsTargets }),
    basecampUrl: basecampUrl || '',
  };
  writeFileSync(
    resolve(rootDir, 'landing.config.json'),
    JSON.stringify(landingConfig, null, 2) + '\n',
    'utf-8',
  );
  console.log('\n  ✅  landing.config.json');

  // --- 2. Actualizar package.json ---
  const pkgPath = resolve(rootDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  pkg.name = slug;

  if (!useTailwind) {
    delete pkg.dependencies.tailwindcss;
    delete pkg.dependencies['@tailwindcss/vite'];
    // Clean up empty deps object if needed
    if (Object.keys(pkg.dependencies).length === 0) {
      delete pkg.dependencies;
    }
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  console.log('  ✅  package.json' + (!useTailwind ? ' (name, sin Tailwind)' : ' (name → ' + slug + ')'));

  // --- 3. Generar global.css según elección ---
  const cssPath = resolve(rootDir, 'src', 'styles', 'global.css');
  writeFileSync(cssPath, useTailwind ? globalCssWithTailwind : globalCssNoTailwind, 'utf-8');
  console.log(`  ✅  src/styles/global.css (${useTailwind ? 'con Tailwind' : 'CSS plano'})`);

  console.log(`\n  🎉  Landing "${name}" inicializada. Corré "pnpm run dev" para probar.\n`);
  rl.close();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
