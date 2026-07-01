import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
Uso: node scripts/upload-cms.mjs [options]

Sube el HTML compilado al componente "CP HTML Avanzado" en el portal HCL DX.

Opciones:
  --target <id>  Sube un target extra (definido en extraCmsTargets de landing.config.json)
  --dry-run      Verifica la configuración sin hacer cambios
  --help         Muestra esta ayuda

Sin --target: sube dist/cms-output.txt al cmsContentId principal.
Con --target:  sube dist/cms-output-<id>.txt al cmsContentId del target indicado.

Variables de entorno (.env):
  URL_CMS_LOGIN  URL de login del portal (obligatorio)
  USER_CMS       Usuario del CMS (obligatorio)
  PASS_CMS       Contraseña del CMS (obligatorio)

Configuración (landing.config.json):
  cmsUrl              URL de la página del portal donde subir el HTML
  cmsContentId        ID del contenido WCM principal (UUID del componente CP HTML Avanzado)
  extraCmsTargets[]   Targets adicionales con id, cmsContentId, y cmsUrl opcional
`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.includes('--help')) { printHelp(); process.exit(0); }
  const dryRun = args.includes('--dry-run');
  const targetIdx = args.indexOf('--target');
  const targetId = targetIdx !== -1 ? (args[targetIdx + 1] ?? null) : null;
  if (targetIdx !== -1 && (!targetId || targetId.startsWith('--'))) {
    console.error('\n❌  --target requiere un ID como argumento (ej: --target banner).\n');
    process.exit(1);
  }
  const knownFlags = new Set(['--dry-run', '--target']);
  const unknown = args.filter(a => a.startsWith('--') && !knownFlags.has(a));
  if (unknown.length > 0) {
    console.error(`Argumento desconocido: ${unknown[0]}`);
    printHelp();
    process.exit(1);
  }
  return { dryRun, targetId };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function loadDotEnv(rootDir) {
  const envPath = resolve(rootDir, '.env');
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, 'utf-8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    if ((value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }
    if (key && !process.env[key]) process.env[key] = value;
  }
}

function loadConfig(rootDir, targetId) {
  const configPath = resolve(rootDir, 'landing.config.json');
  if (!existsSync(configPath)) {
    console.error('\n❌  No se encontró landing.config.json.');
    process.exit(1);
  }
  let config;
  try { config = JSON.parse(readFileSync(configPath, 'utf-8')); }
  catch { console.error('\n❌  landing.config.json inválido.\n'); process.exit(1); }

  if (!config.cmsUrl) {
    console.log('\n⚠️   landing.config.json no tiene "cmsUrl" — nada que subir al CMS.\n');
    process.exit(0);
  }

  if (targetId) {
    const extraTargets = config.extraCmsTargets || [];
    const target = extraTargets.find(t => t.id === targetId);
    if (!target) {
      console.error(`\n❌  No se encontró el target "${targetId}" en extraCmsTargets de landing.config.json.\n`);
      process.exit(1);
    }
    if (!target.cmsContentId) {
      console.error(`\n❌  El target "${targetId}" no tiene cmsContentId configurado.\n`);
      process.exit(1);
    }
    return { cmsUrl: target.cmsUrl || config.cmsUrl, cmsContentId: target.cmsContentId, targetId };
  }

  if (!config.cmsContentId) {
    console.error('\n❌  landing.config.json no tiene "cmsContentId".');
    console.error('   Agregá el UUID del componente CP HTML Avanzado de esta página.\n');
    process.exit(1);
  }
  return { cmsUrl: config.cmsUrl, cmsContentId: config.cmsContentId, targetId: null };
}

function loadEnv(rootDir) {
  loadDotEnv(rootDir);
  const loginUrl = process.env.URL_CMS_LOGIN;
  const username = process.env.USER_CMS;
  const password = process.env.PASS_CMS;
  if (!loginUrl || !username || !password) {
    console.error('\n❌  Faltan URL_CMS_LOGIN, USER_CMS y/o PASS_CMS en el .env\n');
    process.exit(1);
  }
  return { loginUrl, username, password };
}

function loadHtmlContent(rootDir, targetId) {
  const filename = targetId ? `cms-output-${targetId}.txt` : 'cms-output.txt';
  const outputPath = resolve(rootDir, 'dist', filename);
  if (!existsSync(outputPath)) {
    console.error(`\n❌  No se encontró dist/${filename} — ejecutá "pnpm run build" primero.\n`);
    process.exit(1);
  }
  return readFileSync(outputPath, 'utf-8');
}

// ---------------------------------------------------------------------------
// CMS automation
// ---------------------------------------------------------------------------

async function login(page, loginUrl, username, password) {
  console.log('  → Iniciando sesión...');
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Campos: id="userID" / id="password" (labels flotantes Material Design, sin <label for>)
  await page.locator('#userID').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('#userID').fill(username);
  await page.locator('#password').fill(password);

  // El id real es "login.button.login" — los puntos rompen el selector CSS, se usa la clase
  await page.locator('button.loginButton, button[type="submit"]').first().click();
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
  console.log('  ✔ Sesión iniciada');
}

async function openEditDialog(page, cmsUrl, contentId) {
  console.log('  → Navegando a la página del portal...');
  // El portal redirige a una URL con estado (!ut/p/z1/...).
  // networkidle falla en portales Dojo por el polling periódico — se usa domcontentloaded
  // y luego se espera explícitamente a que la URL incluya el segmento de estado.
  await page.goto(cmsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForURL('**!ut/**', { timeout: 20000 });
  const stateUrl = page.url();

  // Abre el editor WCM directamente como página completa (sin pasar por la UI del portlet).
  // Importante: usar la URL de estado de la página NORMAL, NO la de toolbar:open —
  // desde el contexto del toolbar el portal devuelve HTTP 400 al resolver el dialog URI.
  const dialogUrl = `${stateUrl}?uri=dialog:wcm&action=edit&docid=com.aptrix.pluto.content.Content/${contentId}`;
  console.log('  → Abriendo editor WCM...');
  await page.goto(dialogUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Verifica que abrió el editor y no una página de error o un portlet distinto
  const pageTitle = await page.title();
  if (!pageTitle.includes('contenido web') && !pageTitle.includes('Content')) {
    const bodySnippet = await page.evaluate(() => document.body?.innerText?.slice(0, 150));
    throw new Error(`El editor WCM no se abrió correctamente. Título: "${pageTitle}". Body: ${bodySnippet}`);
  }

  // El editor WCM renderiza el textarea directamente en el DOM (sin iframes anidados)
  await page.locator('textarea[name*="html_text_area"]').waitFor({ state: 'visible', timeout: 20000 });
  console.log('  ✔ Editor WCM abierto');
}

async function fillAndSave(page, htmlContent) {
  console.log('  → Escribiendo contenido HTML...');
  // Se usa el native input value setter + events para que Dojo detecte el cambio.
  // El fill() de Playwright opera vía CDP Input.insertText (falla en headless) y el
  // simple textarea.value = html tampoco notifica al modelo interno de Dojo — el servidor
  // recibe el contenido viejo sin error visible.
  await page.evaluate((html) => {
    const ta = document.querySelector('textarea[name*="html_text_area"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, html);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
  }, htmlContent);

  console.log('  → Guardando...');
  // "Guardar y cerrar" en WCM es un <a id="save_and_close"> dentro de un <td class="wcmComboButtonLeft">,
  // no un <button>. Se busca por id primero (más robusto) y se cae a búsqueda por texto
  // para cubrir el locale inglés o cambios de versión del portal.
  //
  // Patrón Promise.all: waitForNavigation debe estar registrado ANTES de que el click
  // dispare la navegación; de lo contrario Playwright puede perderse el evento.
  const [, saveResult] = await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
    page.evaluate(() => {
      const byId = document.getElementById('save_and_close');
      if (byId) { byId.click(); return true; }

      const links = Array.from(document.querySelectorAll('a'));
      const link =
        links.find(a => a.textContent?.trim() === 'Guardar y cerrar') ||
        links.find(a => a.textContent?.trim() === 'Save and Close') ||
        links.find(a => a.textContent?.toLowerCase().includes('guardar')) ||
        links.find(a => a.textContent?.toLowerCase().includes('save and close'));

      if (link) { link.click(); return true; }
      return false;
    }),
  ]);

  if (!saveResult) throw new Error('No se encontró el link de guardado en el editor WCM');

  console.log('  ✔ Contenido guardado');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { dryRun, targetId } = parseArgs(process.argv);
  const config = loadConfig(rootDir, targetId);
  const { loginUrl, username, password } = loadEnv(rootDir);
  const htmlContent = loadHtmlContent(rootDir, targetId);

  const kbSize = (Buffer.byteLength(htmlContent, 'utf-8') / 1024).toFixed(1);
  const label = targetId ? `📄 Subiendo HTML al CMS (target: ${targetId})` : '📄 Subiendo HTML al CMS';
  console.log(`\n${label}\n`);
  console.log(`   Página:     ${config.cmsUrl}`);
  console.log(`   Content ID: ${config.cmsContentId}`);
  console.log(`   Tamaño:     ${kbSize} KB\n`);

  if (dryRun) {
    console.log('   ✅ Dry-run OK — todo configurado correctamente.\n');
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await login(page, loginUrl, username, password);
    await openEditDialog(page, config.cmsUrl, config.cmsContentId);
    await fillAndSave(page, htmlContent);
    console.log('\n   ✅ HTML subido al CMS correctamente.\n');
  } catch (err) {
    console.error(`\n   ❌ Error durante la automatización: ${err.message}\n`);
    await browser.close();
    process.exit(3);
  }

  await browser.close();
}

main().catch(err => {
  console.error('\n❌  Error inesperado:', err, '\n');
  process.exit(3);
});
