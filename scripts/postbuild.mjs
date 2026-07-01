import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import readline from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '..', 'dist');

const indexHtml = readFileSync(resolve(distDir, 'index.html'), 'utf-8');

const bodyMatch = indexHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
if (!bodyMatch) {
  console.error('No se encontró <body> en index.html');
  process.exit(1);
}
const bodyContent = bodyMatch[1].trim();

// Extraer secciones CMS-TARGET del body y removerlas del output principal
const extractedTargets = {};
const primaryBody = bodyContent.replace(
  /<!--\s*CMS-TARGET:([\w-]+)\s*-->([\s\S]*?)<!--\s*\/CMS-TARGET:\1\s*-->/g,
  (match, id, content) => {
    extractedTargets[id] = content.trim();
    return '';
  }
).trim();

const assetsDir = resolve(distDir, '_assets');

// El output del CMS siempre usa link al CDN — los assets ya están en Mosaic, el CSS inline no aporta nada
const cssFile = readdirSync(assetsDir).find(f => f.startsWith('index.') && f.endsWith('.css'));
if (!cssFile) {
  console.error('No se encontró el archivo CSS generado por Astro');
  process.exit(1);
}
const landingConfigForCss = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'landing.config.json'), 'utf-8')
);
const assetsPrefix = landingConfigForCss.assetsPrefix || '';
const cssTag = `<link rel="stylesheet" href="${assetsPrefix}/_assets/${cssFile}">`;

// Capturar scripts que Astro coloca fuera del <html> (los hoistea como módulos)
const externalScripts = [];
const scriptRegex = /<script[^>]*>[\s\S]*?<\/script>/gi;
let scriptMatch;
while ((scriptMatch = scriptRegex.exec(indexHtml)) !== null) {
  const beforeScript = indexHtml.substring(0, scriptMatch.index);
  if (beforeScript.includes('</html>')) {
    externalScripts.push(scriptMatch[0]);
  }
}

const now = new Date();
const buildTimestampISO = now.toISOString();
const buildTimestampDisplay = now.toLocaleString('es-PE', {
  timeZone: 'America/Lima',
  dateStyle: 'long',
  timeStyle: 'medium',
});

// --- Generar metadata de deploy ---

function runGit(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', cwd: resolve(__dirname, '..') }).trim();
  } catch {
    return 'unknown';
  }
}

const landingConfig = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'landing.config.json'), 'utf-8')
);
const remoteUrl = runGit('git remote get-url origin');

const deployMeta = {
  landing: landingConfig.name,
  slug: landingConfig.slug,
  remote: remoteUrl !== 'unknown' ? remoteUrl : undefined,
  commit: runGit('git rev-parse HEAD'),
  branch: runGit('git rev-parse --abbrev-ref HEAD'),
  timestamp: buildTimestampISO,
  author: runGit('git log -1 --format="%an"'),
  basecampUrl: landingConfig.basecampUrl || undefined,
  cmsUrl: landingConfig.cmsUrl || undefined,
  publicUrl: landingConfig.publicUrl || undefined,
  mosaic: landingConfig.assetsPrefix || undefined
};

// --- Landing info para consola del navegador ---

const shortHash = deployMeta.commit && deployMeta.commit !== 'unknown'
  ? deployMeta.commit.substring(0, 7)
  : 'unknown';

const updatedAtDisplay = now.toLocaleString('es-PE', {
  timeZone: 'America/Lima',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const landingScript = `<script>window.__LANDING__=${JSON.stringify({
  landing: deployMeta.landing,
  version: shortHash,
  branch: deployMeta.branch === 'unknown' ? undefined : deployMeta.branch,
  updatedAt: updatedAtDisplay,
  author: deployMeta.author === 'unknown' ? undefined : deployMeta.author,
})}</script>`;

// --- Generar cms-output.txt con todo incluido ---

let output = `<!-- Generado: ${buildTimestampDisplay} -->\n${landingScript}\n${cssTag}\n\n${primaryBody}\n`;
if (externalScripts.length) {
  output += '\n' + externalScripts.join('\n') + '\n';
}

const outputPath = resolve(distDir, 'cms-output.txt');
writeFileSync(outputPath, output, 'utf-8');

console.log(`✅ cms-output.txt generado en ${outputPath}`);

// Generar outputs para cada CMS-TARGET encontrado
const extraCmsTargets = landingConfig.extraCmsTargets || [];
const generatedTargets = [];

for (const [targetId, targetContent] of Object.entries(extractedTargets)) {
  const configEntry = extraCmsTargets.find(t => t.id === targetId);
  if (!configEntry) {
    console.warn(`⚠️  CMS-TARGET "${targetId}" encontrado en el HTML pero sin configuración en extraCmsTargets — ignorado.`);
    continue;
  }
  const targetOutput = `<!-- Generado: ${buildTimestampDisplay} (target: ${targetId}) -->\n${landingScript}\n${cssTag}\n\n${targetContent}\n`;
  const targetOutputPath = resolve(distDir, `cms-output-${targetId}.txt`);
  writeFileSync(targetOutputPath, targetOutput, 'utf-8');
  console.log(`✅ cms-output-${targetId}.txt generado en ${targetOutputPath}`);
  generatedTargets.push({ id: targetId, config: configEntry });
}

// Inject __LANDING__ into dist/index.html so pnpm preview exposes it in the browser console
const patchedIndexHtml = indexHtml.replace('</body>', `${landingScript}\n</body>`);
writeFileSync(resolve(distDir, 'index.html'), patchedIndexHtml, 'utf-8');
console.log('✅ dist/index.html inyectado con window.__LANDING__');

const deployMetaStr = JSON.stringify(deployMeta, null, 2);
// En raíz del proyecto — versionado, visible para el PM
const rootMetaPath = resolve(__dirname, '..', 'cms-deploy.json');
writeFileSync(rootMetaPath, deployMetaStr, 'utf-8');
console.log(`✅ cms-deploy.json generado en ${rootMetaPath}`);

// --- Preguntar si subir a Mosaic ---

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const answer = await new Promise((resolve) => {
  rl.question('\n  ¿Subir assets a Mosaic? (s/N): ', (ans) => {
    resolve(ans.trim().toLowerCase());
  });
});
rl.close();

if (answer === 's' || answer === 'y') {
  console.log('\n  Subiendo assets a Mosaic…\n');
  try {
    execSync('node scripts/upload-mosaic.mjs', {
      stdio: 'inherit',
      cwd: resolve(__dirname, '..'),
    });
  } catch {
    console.error('\n  ⚠️  La subida a Mosaic falló. Revisá el error arriba.\n');
  }
} else {
  console.log('\n  📦  Assets no subidos. Ejecutá "pnpm run upload-mosaic" después si querés.\n');
}

// --- Preguntar si subir HTML al CMS ---

if (landingConfig.cmsUrl) {
  const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
  const cmsAnswer = await new Promise((resolve) => {
    rl2.question('\n  ¿Subir HTML al CMS? (s/N): ', (ans) => resolve(ans.trim().toLowerCase()));
  });
  rl2.close();

  if (cmsAnswer === 's' || cmsAnswer === 'y') {
    console.log('\n  Subiendo HTML al CMS…\n');
    try {
      execSync('node scripts/upload-cms.mjs', {
        stdio: 'inherit',
        cwd: resolve(__dirname, '..'),
      });
    } catch {
      console.error('\n  ⚠️  La subida al CMS falló. Revisá el error arriba.\n');
    }
  } else {
    console.log('\n  📄  HTML no subido. Ejecutá "pnpm run upload-cms" después si querés.\n');
  }
}

// --- Preguntar si subir targets extra al CMS ---

for (const { id, config } of generatedTargets) {
  if (!config.cmsContentId) {
    console.warn(`\n  ⚠️  extraCmsTargets["${id}"] no tiene cmsContentId configurado — omitiendo.\n`);
    continue;
  }
  const rlExtra = readline.createInterface({ input: process.stdin, output: process.stdout });
  const extraAnswer = await new Promise((resolve) => {
    rlExtra.question(`\n  ¿Subir "${id}" al CMS? (s/N): `, (ans) => resolve(ans.trim().toLowerCase()));
  });
  rlExtra.close();

  if (extraAnswer === 's' || extraAnswer === 'y') {
    console.log(`\n  Subiendo "${id}" al CMS…\n`);
    try {
      execSync(`node scripts/upload-cms.mjs --target ${id}`, {
        stdio: 'inherit',
        cwd: resolve(__dirname, '..'),
      });
    } catch {
      console.error(`\n  ⚠️  La subida de "${id}" al CMS falló. Revisá el error arriba.\n`);
    }
  } else {
    console.log(`\n  📄  "${id}" no subido. Ejecutá "node scripts/upload-cms.mjs --target ${id}" después si querés.\n`);
  }
}
