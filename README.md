# Template Claro con Astro

Template para landings de Claro desplegadas en HCL DX. Construido con Astro + Tailwind v4.

## Inicio rápido

> ⚠️ Antes del primer `dev` o `build`, ejecutá `pnpm run init-landing`. Sin esto los comandos se bloquean.

```bash
pnpm run init-landing   # configura la landing una sola vez
pnpm run dev            # desarrollo local
pnpm run build          # genera dist/ + cms-output.txt + pregunta si subir assets y HTML
```

El build es interactivo: al terminar pregunta si subir los assets a Mosaic y el HTML al CMS — todo en un solo paso.

---

## Configuración

`landing.config.json` es la única fuente de verdad. `astro.config.mjs` y `postbuild.mjs` leen de este archivo — sin valores duplicados.

| Campo | Descripción |
|---|---|
| `initialized` | Guard — `false` en el template, `true` luego de `init-landing` |
| `useTailwind` | `true` (default) o `false` para CSS plano |
| `name` | Nombre visible de la landing |
| `slug` | Identificador — se escribe en `package.json` |
| `mosaicFolder` | Carpeta en Mosaic para los assets compilados |
| `assetsPrefix` | URL CDN base (usada en `astro.config.mjs` y en el `<link>` del CMS) |
| `cmsUrl` | URL de backoffice authoring del portal HCL DX |
| `cmsContentId` | UUID del portlet "CP HTML Avanzado" — ver §[Descubrir el cmsContentId](#descubrir-el-cmscontentid) |
| `extraCmsTargets` | Visores adicionales — ver §[Múltiples visores](#múltiples-visores-de-contenido) |
| `publicUrl` | URL pública de la landing (trazabilidad) |
| `basecampUrl` | Link al requerimiento en Basecamp (trazabilidad) |

### `pnpm run init-landing`

El CLI interactivo pregunta:

1. **Nombre** de la landing (ej: Prepago Móvil)
2. **Carpeta en Mosaic** — slug autogenerado, editable
3. **URL del CMS** — backoffice authoring (opcional)
4. **¿Múltiples visores?** — si hay más de un portlet destino, ver §[Múltiples visores](#múltiples-visores-de-contenido)
5. **URL pública** (opcional, trazabilidad)
6. **URL de Basecamp** (opcional, trazabilidad)
7. **¿Usar Tailwind CSS?** — si respondés que no, se eliminan las dependencias y se genera un `global.css` plano; los componentes del template dejarán de funcionar porque usan clases Tailwind

Genera `landing.config.json` y actualiza `package.json` con el slug.

### Assets e inlining (Vite)

Por defecto Vite inlinea como base64 cualquier asset menor a 4 KB. Para que todos los assets tengan URL del CDN:

```js
// astro.config.mjs
vite: {
  build: { assetsInlineLimit: 0 }
}
```

---

## Build y outputs

`pnpm run build` genera:

| Archivo | Contenido |
|---|---|
| `dist/cms-output.txt` | Fragmento HTML listo para el portlet principal |
| `dist/cms-output-{id}.txt` | Un archivo por cada visor adicional (si aplica) |
| `cms-deploy.json` | Metadata de deploy versionada — commit, autor, timestamp |

El output del CMS incluye el `<body>` de la landing y el `<link>` al CSS en Mosaic. **No incluye** CSS externos (Google Fonts, Claro fonts, reset del CMS) — el portal ya los carga globalmente.

| Modo CSS | Comando |
|---|---|
| `<link>` al CDN (default) | `pnpm run build` |
| CSS inline | `CSS_MODE=inline pnpm run build` |

---

## Subir al CMS

El build pregunta al final si subir el HTML. También podés hacerlo de forma standalone:

```bash
pnpm run upload-cms
```

Requiere en `.env`:

```env
URL_CMS_LOGIN=https://pe-backoffice-portal.prod.clarodigital.net/wps/portal/pe/...
USER_CMS=tu-usuario
PASS_CMS=tu-contraseña
```

Y en `landing.config.json`: `cmsUrl` y `cmsContentId` completos.

### Descubrir el cmsContentId

El `cmsContentId` es el UUID del item WCM del portlet "CP HTML Avanzado". Se obtiene activando **Modalidad de edición** en el portal y ejecutando este snippet en DevTools → Console:

```javascript
(async () => {
  // Requiere "Modalidad de edición" ACTIVA — el portal renderiza el contenido en un iframe
  const viewFrame = document.getElementById('wpViewFrameContainer-iframe');
  if (!viewFrame) {
    if (!window.ibmCfg) {
      console.error('❌ No estás en el portal o no estás logueado como autor.');
    } else {
      console.warn('⚠️ Activá "Modalidad de edición" en la toolbar y volvé a ejecutar el snippet.');
      console.info('El toggle está en la barra negra superior: Modalidad de edición → Activar');
    }
    return;
  }

  const frameDoc = viewFrame.contentDocument || viewFrame.contentWindow?.document;
  if (!frameDoc) { console.error('❌ No se puede acceder al contenido del iframe.'); return; }

  const seen = new Set();
  const uuids = [];
  for (const a of frameDoc.querySelectorAll('a')) {
    const m = (a.href || '').match(/Content%2F([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (m && !seen.has(m[1])) { seen.add(m[1]); uuids.push(m[1]); }
  }
  if (!uuids.length) { console.warn('⚠️ No se encontraron portlets WCM en esta página.'); return; }

  const base = window.ibmCfg?.portalConfig?.contentHandlerURI;
  const items = await Promise.all(uuids.map(async (id, i) => {
    try {
      const r = await fetch(`${base}wcmrest/item/${id}`, { credentials: 'include', headers: { Accept: 'application/json' } });
      const d = await r.json();
      return { '#': i + 1, Título: d.entry?.title?.value || '(sin título)', UUID: id };
    } catch { return { '#': i + 1, Título: '(error)', UUID: id }; }
  }));

  console.table(items);
  console.info('📋 Copiá el UUID que corresponda y pegalo en landing.config.json como "cmsContentId"');
})();
```

**Pasos:**

1. Navegá a `cmsUrl` logueado como autor
2. Activá **Modalidad de edición** — toggle en la barra negra superior
3. DevTools → Console → pegá y ejecutá el snippet
4. `console.table` muestra Título y UUID de cada portlet WCM en la página
5. Copiá el UUID correspondiente y pegalo en `landing.config.json`

> Con Modalidad de edición activa, el portal renderiza un iframe con links de edición inline sobre cada portlet. Esos links exponen el `docid` directamente en el DOM.

### Múltiples visores de contenido

Cuando la landing distribuye contenido en más de un portlet "CP HTML Avanzado", usás markers en los componentes para que el build genere un output por visor.

**1. Marcá el componente:**

```astro
<!-- CMS-TARGET:banner -->
<div class="banner">...</div>
<!-- /CMS-TARGET:banner -->
```

**2. Configurá los targets en `landing.config.json`:**

```json
{
  "cmsContentId": "uuid-visor-principal",
  "cmsUrl": "https://pe-backoffice-portal.../mi-landing",
  "extraCmsTargets": [
    { "id": "banner", "cmsContentId": "uuid-visor-banner" }
  ]
}
```

> `cmsUrl` en cada target es opcional — si se omite hereda el principal. Útil cuando todos los portlets están en la misma página del portal.

**Outputs generados:**

```
dist/cms-output.txt         ← contenido principal (sin la sección marcada)
dist/cms-output-banner.txt  ← solo el banner
```

El build pregunta por cada target si querés subirlo. También podés hacerlo standalone:

```bash
node scripts/upload-cms.mjs --target banner
```

**Ejemplo con 3 visores:**

```json
"extraCmsTargets": [
  { "id": "banner",    "cmsContentId": "uuid-banner" },
  { "id": "promo",     "cmsContentId": "uuid-promo" },
  { "id": "footer-cx", "cmsContentId": "uuid-footer", "cmsUrl": "https://pe-backoffice-portal.../otra-pagina" }
]
```

**Migrar de single a multi-target:** agregá `extraCmsTargets` a mano en `landing.config.json` — el `cmsContentId` original queda como target principal, no hay que tocarlo.

---

## Mosaic (assets)

[Mosaic](https://mosaic-repo.prod.clarodigital.net) es el repositorio central de estáticos de Claro — un MinIO Console compatible con S3. Ahí se almacenan CSS, JS, fuentes e imágenes que renderizan las landings en el CMS.

```bash
pnpm run upload-mosaic           # sube dist/_assets/ a Mosaic
pnpm run upload-mosaic --dry-run # previsualiza sin enviar nada
```

El build también pregunta al final si querés subirlos. Requiere en `.env`:

```env
USER_MOSAIC=tu-usuario
PASS_MOSAIC=tu-contraseña
```

Las credenciales las asigna el equipo de Claro Digital. `.env` está en `.gitignore`.

> MinIO no requiere crear carpetas previamente — al subir `havas/mi-landing/_assets/style.css`, el path se crea automáticamente.

---

## Trazabilidad de deploy

Cada build genera `cms-deploy.json` en la raíz del proyecto. Es el contrato entre el dev y el PM: confirma qué commit está arriba en el CMS.

```json
{
  "landing": "Prepago Móvil",
  "slug": "prepago-movil",
  "remote": "git@havas:HV-DEV-HTML/claro-astro-template.git",
  "commit": "27bf164f7292c6eaf340d4984339517867b6f67e",
  "branch": "main",
  "timestamp": "2026-06-18T22:45:57.775Z",
  "author": "Javier Castro",
  "cmsUrl": "https://pe-backoffice-portal.../mi-landing",
  "publicUrl": "https://www.claro.com.pe/mi-landing"
}
```

**Flujo recomendado:**

```bash
pnpm run build          # genera cms-deploy.json
git add cms-deploy.json
git commit -m "..."
git push                # el PM ya puede ver el estado sin preguntar a nadie
```

El dashboard [claro-repositorios-tracking](https://github.com/HV-DEV-HTML/claro-repositorios-tracking) lee `cms-deploy.json` de cada repo y centraliza el estado de todas las landings automáticamente.

---

## Referencia

### Estructura del proyecto

```
/
├── landing.config.json        # Configuración de la landing
├── cms-deploy.json            # Metadata del último deploy (versionado)
├── public/
│   └── favicon.svg
├── scripts/
│   ├── check-init.mjs         # Bloquea dev/build si no se ejecutó init-landing
│   ├── init-landing.mjs       # CLI interactivo de inicialización
│   ├── postbuild.mjs          # Genera cms-output(s) + cms-deploy.json + prompts de subida
│   ├── upload-cms.mjs         # Sube HTML al portal HCL DX via Playwright
│   └── upload-mosaic.mjs      # Sube dist/_assets/ a Mosaic
├── src/
│   ├── layouts/Layout.astro   # Layout base — el <body> es lo que va al CMS
│   ├── pages/index.astro
│   ├── components/
│   ├── assets/
│   └── styles/global.css
├── .nvmrc                     # Pin de Node.js
├── astro.config.mjs
└── package.json
```

### CMS: HCL Digital Experience (HCL DX)

Claro utiliza **HCL DX** como plataforma de portal y gestión de contenido. Es la solución enterprise que HCL Technologies adquirió de IBM (antes: IBM WebSphere Portal + IBM Web Content Manager). Ampliamente adoptada en telcos y banca de Latinoamérica.

El contenido se organiza en **portlets** que contienen items WCM. Este template sube el HTML al portlet **"CP HTML Avanzado"** — un componente WCM de HTML libre donde se inyecta el fragmento generado por el build.
