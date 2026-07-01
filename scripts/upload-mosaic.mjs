import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';


const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const BASE_URL = 'https://mosaic-repo.prod.clarodigital.net';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
Uso: node scripts/upload-mosaic.mjs [options]

Sube los assets compilados de dist/_assets/ al repositorio Mosaic.

Opciones:
  --dry-run  Muestra los archivos que se subirían sin subirlos
  --help     Muestra esta ayuda

Variables de entorno:
  USER_MOSAIC  Access key de la API de Mosaic (obligatorio)
  PASS_MOSAIC  Secret key de la API de Mosaic (obligatorio)

Archivo de configuración:
  landing.config.json — debe contener "mosaicFolder"

Códigos de salida:
  0  Éxito — todos los archivos subidos
  1  Error de configuración
  2  Error de autenticación
  3  Error de subida
`);
}

function parseArgs(argv) {
  const args = argv.slice(2);

  if (args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  if (args.includes('--dry-run')) {
    return { dryRun: true };
  }

  const unknown = args.filter((a) => a.startsWith('--'));
  if (unknown.length > 0) {
    console.error(`Argumento desconocido: ${unknown[0]}`);
    printHelp();
    process.exit(1);
  }

  return { dryRun: false };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function loadConfig(rootDir) {
  const configPath = resolve(rootDir, 'landing.config.json');

  if (!existsSync(configPath)) {
    console.error('\n❌  No se encontró landing.config.json.');
    console.error('   Ejecutá "pnpm run init-landing" para configurar el proyecto.\n');
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    console.error('\n❌  landing.config.json inválido. Revisá el formato.\n');
    process.exit(1);
  }

  if (!config.mosaicFolder) {
    console.error('\n❌  landing.config.json no contiene "mosaicFolder".\n');
    process.exit(1);
  }

  return {
    mosaicFolder: config.mosaicFolder,
    assetsPrefix: config.assetsPrefix || '',
  };
}

function loadDotEnv(rootDir) {
  const envPath = resolve(rootDir, '.env');
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();

    // Strip surrounding quotes (single or double)
    if ((value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function loadEnv(rootDir) {
  loadDotEnv(rootDir);

  const username = process.env.USER_MOSAIC;
  const password = process.env.PASS_MOSAIC;

  if (!username || !password) {
    console.error('\n❌  Faltan variables de entorno USER_MOSAIC y/o PASS_MOSAIC.');
    console.error('   Revisá que estén definidas en el archivo .env o exportadas.\n');
    process.exit(1);
  }

  return { username, password };
}

// ---------------------------------------------------------------------------
// Mosaic API
// ---------------------------------------------------------------------------

async function createSession(baseUrl, username, password) {
  const res = await fetch(`${baseUrl}/api/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessKey: username, secretKey: password }),
    redirect: 'manual',
  });

  if (!res.ok) {
    console.error(`\n❌  Error de autenticación: ${res.status} ${res.statusText}\n`);
    process.exit(2);
  }

  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) {
    console.error('\n❌  No se recibió cookie de sesión desde Mosaic.\n');
    process.exit(2);
  }

  // Parse Set-Cookie — may be multiple headers joined by comma.
  // Each entry may carry attributes (Path=, HttpOnly…). We keep only name=value.
  const cookies = setCookie
    .split(',')
    .map((entry) => entry.split(';')[0].trim())
    .filter(Boolean);
  const sessionCookie = cookies.join('; ');

  return sessionCookie;
}

const MIME_TYPES = {
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.html': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.json': 'application/json',
  '.xml': 'text/xml',
  '.txt': 'text/plain',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

function detectMime(fileName) {
  const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Mosaic API — upload
// ---------------------------------------------------------------------------

async function uploadFile(baseUrl, cookie, prefix, filePath) {
  const fileName = prefix.split('/').pop();
  const buffer = readFileSync(filePath);

  // MinIO Console's Go parser uses the form field name as the expected byte count.
  // Sending the file byte length as the field name (matching the web UI behavior)
  // is required so the parser reads the correct number of bytes and preserves Content-Type.
  const mime = detectMime(fileName);
  const blob = new Blob([buffer], { type: mime });
  const form = new FormData();
  form.append(buffer.length.toString(), blob, fileName);

  const uploadUrl = `${baseUrl}/api/v1/buckets/resources-pe/objects/upload?prefix=${encodeURIComponent(prefix)}`;

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  });

  let responseBody;
  try {
    responseBody = await res.text();
  } catch {
    responseBody = '';
  }

  if (!res.ok) {
    const preview = responseBody.length > 200 ? responseBody.slice(0, 200) + '…' : responseBody;
    console.error(`   ↳  Server response (${res.status}): ${preview}`);
  }

  return { ok: res.ok, status: res.status, body: responseBody };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { dryRun } = parseArgs(process.argv);
  const config = loadConfig(rootDir);
  const { username, password } = loadEnv(rootDir);

  const assetsDir = resolve(rootDir, 'dist', '_assets');

  if (!existsSync(assetsDir)) {
    console.error('\n❌  No se encontró dist/_assets/.');
    console.error('   Ejecutá "pnpm run build" primero.\n');
    process.exit(1);
  }

  const files = readdirSync(assetsDir).filter((f) => {
    const full = resolve(assetsDir, f);
    return statSync(full).isFile();
  });

  if (files.length === 0) {
    console.error('\n❌  No hay archivos en dist/_assets/ para subir.\n');
    process.exit(1);
  }

  const folder = config.mosaicFolder;
  const folderPrefix = `havas/${folder}/_assets/`;

  // --- Dry-run -------------------------------------------------------------

  if (dryRun) {
    let totalBytes = 0;
    console.log(`\n📦 Vista previa — Subida a Mosaic (havas/${folder}/_assets/)\n`);
    for (const f of files) {
      const size = statSync(resolve(assetsDir, f)).size;
      totalBytes += size;
      console.log(`   ${f.padEnd(30)} ${formatSize(size)}`);
    }
    console.log(`\n   Total: ${files.length} archivos, ${formatSize(totalBytes)}\n`);
    return;
  }

  // --- Upload --------------------------------------------------------------

  console.log(`\n📦 Subiendo assets a Mosaic (havas/${folder}/_assets/)\n`);

  let cookie = await createSession(BASE_URL, username, password);
  let uploaded = 0;
  let failed = 0;
  let skipped = 0;
  let totalSize = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = resolve(assetsDir, file);
    const size = statSync(filePath).size;
    const objectPrefix = `${folderPrefix}${file}`;

    if (i > 0) {
      await new Promise((r) => setTimeout(r, 200));
    }

    let result = await uploadFile(BASE_URL, cookie, objectPrefix, filePath);

    if (result.status === 401) {
      console.log(`   ⚠  ${file.padEnd(28)} ${formatSize(size)}  (401 — reintentando…)`);
      await new Promise((r) => setTimeout(r, 200));
      cookie = await createSession(BASE_URL, username, password);
      result = await uploadFile(BASE_URL, cookie, objectPrefix, filePath);
    }

    if (result.ok) {
      console.log(`   ✔  ${file.padEnd(28)} ${formatSize(size)}`);
      uploaded++;
      totalSize += size;
    } else {
      console.log(`   ✘  ${file.padEnd(28)} ${formatSize(size)}  (${result.status})`);
      failed++;
      skipped = files.length - uploaded - 1;
      break;
    }
  }

  console.log();
  if (failed > 0) {
    console.log(`   ❌ Error: ${uploaded} subidos, ${failed} fallidos, ${skipped} saltados de ${files.length} total\n`);
    process.exit(3);
  } else {
    console.log(`   ✅ Completado: ${uploaded} archivos subidos (${formatSize(totalSize)})\n`);
  }
}

main().catch((err) => {
  console.error('\n❌  Error inesperado:', err, '\n');
  process.exit(3);
});
