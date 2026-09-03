import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = process.cwd();
const extensionDir = path.join(root, 'extension');
const manifestPath = path.join(extensionDir, 'manifest.json');
const healthBridgePath = path.join(
  root,
  'src',
  'features',
  'rayen-import',
  'bridge',
  'extensionHealthBridge.ts'
);
const errors = [];

const fail = message => errors.push(message);
const relative = file => path.relative(root, file);
const isRegularFile = file => existsSync(file) && statSync(file).isFile();
const listFiles = directory =>
  readdirSync(directory).flatMap(name => {
    const absolute = path.join(directory, name);
    return statSync(absolute).isDirectory() ? listFiles(absolute) : [absolute];
  });

const isSafePackagePath = file => {
  if (typeof file !== 'string' || file.length === 0) return false;
  if (file === '.' || file.endsWith('/')) return false;
  if (/[\\?&#]|[\u0000-\u001f\u007f]/.test(file)) return false;
  if (path.posix.isAbsolute(file) || path.win32.isAbsolute(file)) return false;
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(file)) return false;
  const normalized = path.posix.normalize(file);
  return normalized === file && normalized !== '..' && !normalized.startsWith('../');
};

const dependencyFiles = new Set();
const validateFileReferences = (source, files) => {
  const references = Array.from(files || []);
  const seen = new Set();
  for (const file of references) {
    if (!isSafePackagePath(file)) {
      fail(`Referencia insegura o externa en ${source}: ${String(file)}`);
      continue;
    }
    if (seen.has(file)) {
      fail(`Referencia duplicada en ${source}: extension/${file}`);
      continue;
    }
    seen.add(file);
    dependencyFiles.add(file);
    const absolute = path.join(extensionDir, file);
    if (!isRegularFile(absolute)) {
      fail(`Falta la dependencia de ${source}: extension/${file}`);
    }
  }
};

const parseLiteralImportScripts = source => {
  const withoutTrailingComma = source.trim().replace(/,\s*$/, '');
  if (!withoutTrailingComma) return { files: [], valid: true };
  const entries = withoutTrailingComma.split(',').map(entry => entry.trim());
  const files = [];
  for (const entry of entries) {
    const literal = entry.match(/^(['"])([^'"]+)\1$/);
    if (!literal) return { files: [], valid: false };
    files.push(literal[2]);
  }
  return { files, valid: true };
};

const htmlAttributeValue = (tag, requestedName) => {
  let cursor = tag.search(/\s/);
  while (cursor >= 0 && cursor < tag.length) {
    while (/\s/.test(tag[cursor] || '')) cursor += 1;
    if (tag[cursor] === '>' || tag[cursor] === '/') break;

    const nameStart = cursor;
    while (cursor < tag.length && !/[\s=/>]/.test(tag[cursor])) cursor += 1;
    const name = tag.slice(nameStart, cursor).toLowerCase();
    while (/\s/.test(tag[cursor] || '')) cursor += 1;

    let value = '';
    if (tag[cursor] === '=') {
      cursor += 1;
      while (/\s/.test(tag[cursor] || '')) cursor += 1;
      const quote = tag[cursor] === '"' || tag[cursor] === "'" ? tag[cursor] : '';
      if (quote) {
        cursor += 1;
        const valueStart = cursor;
        while (cursor < tag.length && tag[cursor] !== quote) cursor += 1;
        value = tag.slice(valueStart, cursor);
        if (tag[cursor] === quote) cursor += 1;
      } else {
        const valueStart = cursor;
        while (cursor < tag.length && !/[\s>]/.test(tag[cursor])) cursor += 1;
        value = tag.slice(valueStart, cursor);
      }
    }

    if (name === requestedName) return value;
  }
  return null;
};

const htmlScriptSources = source => {
  const sources = [];
  let hasBaseElement = false;
  let cursor = 0;
  while (cursor < source.length) {
    const tagStart = source.indexOf('<', cursor);
    if (tagStart === -1) break;
    if (source.startsWith('<!--', tagStart)) {
      const commentEnd = source.indexOf('-->', tagStart + 4);
      cursor = commentEnd === -1 ? source.length : commentEnd + 3;
      continue;
    }
    if (/^<base(?=[\s/>])/i.test(source.slice(tagStart))) {
      hasBaseElement = true;
      cursor = tagStart + 5;
      continue;
    }
    if (!/^<script(?=[\s/>])/i.test(source.slice(tagStart))) {
      cursor = tagStart + 1;
      continue;
    }

    let quote = '';
    let tagEnd = -1;
    for (let index = tagStart + 7; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        tagEnd = index;
        break;
      }
    }
    if (tagEnd === -1) break;

    const tag = source.slice(tagStart, tagEnd + 1);
    const src = htmlAttributeValue(tag, 'src');
    if (src !== null) sources.push(src);

    const closingTagStart = source.toLowerCase().indexOf('</script', tagEnd + 1);
    const closingTagEnd = closingTagStart === -1 ? -1 : source.indexOf('>', closingTagStart + 8);
    cursor = closingTagEnd === -1 ? tagEnd + 1 : closingTagEnd + 1;
  }
  return { sources, hasBaseElement };
};

if (!existsSync(manifestPath)) {
  console.error('No existe extension/manifest.json.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.manifest_version !== 3) fail('La extensión debe usar Manifest V3.');
if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version || '')))
  fail('La versión debe usar formato semver X.Y.Z.');
if (manifest.minimum_chrome_version !== '118') {
  fail('La extensión debe declarar minimum_chrome_version 118 para el contrato legacy de PDF.js.');
}
// El inject de mundo principal no puede leer el manifest: publica una constante que el relay
// compara con la versión instalada. Si divergen, TODA pestaña fresca quedaría «versión anterior».
const injectPath = path.join(extensionDir, 'inject-fichamedico.js');
const injectVersion = existsSync(injectPath)
  ? (readFileSync(injectPath, 'utf8').match(/const INJECT_VERSION = '([^']+)'/) || [])[1]
  : undefined;
if (injectVersion !== manifest.version) {
  fail(
    `inject-fichamedico.js declara INJECT_VERSION='${injectVersion ?? 'ausente'}' y el manifest ${manifest.version}; deben coincidir.`
  );
}

const backgroundWorker = manifest.background?.service_worker;
if (backgroundWorker) {
  validateFileReferences('manifest.background.service_worker', [backgroundWorker]);
}
for (const [index, script] of (manifest.content_scripts || []).entries()) {
  validateFileReferences(`manifest.content_scripts[${index}].js`, script.js);
  validateFileReferences(`manifest.content_scripts[${index}].css`, script.css);
}
for (const [index, resourceGroup] of (manifest.web_accessible_resources || []).entries()) {
  validateFileReferences(
    `manifest.web_accessible_resources[${index}].resources`,
    resourceGroup.resources
  );
}

// These package entry points are not reachable from manifest, importScripts(), or another HTML.
// All reachable children are validated from their actual edges instead of duplicated as file roots.
const mandatoryPackageRoots = ['vendor-lock.json', 'print-pdf.html', 'syslab-offscreen.html'];
validateFileReferences('raíces obligatorias del paquete', mandatoryPackageRoots);

// Preserve the pre-existing core-feature contract as required graph edges. File existence remains
// derived by validateFileReferences(), while removing an edge and its target together still fails.
const mandatoryStartupRuntimes = [
  'runtime-loader.js',
  'prescription-print.js',
  'prescription-pdf.js',
  'pdf-print.js',
  'report-parser.js',
  'jspdf.umd.min.js',
  'pdf-lib.min.js',
  'xlsx.full.min.js',
];
const mandatoryHtmlScripts = new Map([['print-pdf.html', ['print-pdf.js']]]);

const vendorLockPath = path.join(extensionDir, 'vendor-lock.json');
if (existsSync(vendorLockPath)) {
  const vendorLock = JSON.parse(readFileSync(vendorLockPath, 'utf8'));
  if (vendorLock.schemaVersion !== 1 || !Array.isArray(vendorLock.vendors)) {
    fail('extension/vendor-lock.json no cumple el contrato esperado.');
  } else {
    for (const vendor of vendorLock.vendors) {
      const vendorPath = path.join(extensionDir, String(vendor.file || ''));
      if (!existsSync(vendorPath)) {
        fail(`Falta el vendor bloqueado: extension/${vendor.file}`);
        continue;
      }
      const actualHash = createHash('sha256').update(readFileSync(vendorPath)).digest('hex');
      if (actualHash !== vendor.sha256)
        fail(`Integridad SHA-256 inválida: extension/${vendor.file}`);
      if (!vendor.package || !vendor.version || !vendor.license) {
        fail(`Trazabilidad incompleta para extension/${vendor.file}`);
      }
    }
    const expectedPdfJsSources = new Map([
      ['pdf.min.mjs', 'pdfjs-dist/legacy/build/pdf.min.mjs'],
      ['pdf.worker.min.mjs', 'pdfjs-dist/legacy/build/pdf.worker.min.mjs'],
    ]);
    for (const [file, source] of expectedPdfJsSources) {
      const vendor = vendorLock.vendors.find(candidate => candidate.file === file);
      if (
        !vendor ||
        vendor.package !== 'pdfjs-dist' ||
        vendor.version !== '5.5.207' ||
        vendor.variant !== 'legacy' ||
        vendor.source !== source
      ) {
        fail(`extension/${file} debe provenir del build legacy de pdfjs-dist 5.5.207.`);
      }
      const vendorPath = path.join(extensionDir, file);
      if (isRegularFile(vendorPath)) {
        const sourceText = readFileSync(vendorPath, 'utf8');
        if (
          !sourceText.includes('pdfjsVersion = 5.5.207') ||
          !sourceText.includes('__core-js_shared__')
        ) {
          fail(`extension/${file} no contiene el artefacto legacy trazable de PDF.js 5.5.207.`);
        }
      }
    }
  }
}

const allowedHosts = new Set([
  'https://fichamedico.rayensalud.cl/*',
  'https://fichamedicoback.rayensalud.cl/*',
  'https://formulariosclinicosback.rayensalud.cl/*',
  'https://hospitalizado.rayensalud.cl/*',
  'https://hospbackend.rayensalud.cl/*',
  'http://10.4.69.90/syslab/*',
  'http://localhost:3000/*',
  'http://localhost:3001/*',
  'https://testinghhr.netlify.app/*',
  'https://hhr-entornodeprueba.vercel.app/*',
]);
for (const host of manifest.host_permissions || []) {
  if (!allowedHosts.has(host)) fail(`Permiso de host no revisado: ${host}`);
}

const backgroundPath = isSafePackagePath(backgroundWorker)
  ? path.join(extensionDir, backgroundWorker)
  : null;
const backgroundSource =
  backgroundPath && isRegularFile(backgroundPath) ? readFileSync(backgroundPath, 'utf8') : '';
const healthBridgeSource = existsSync(healthBridgePath)
  ? readFileSync(healthBridgePath, 'utf8')
  : '';
const extensionProtocolVersion = Number(
  backgroundSource.match(/\bEXTENSION_PROTOCOL_VERSION\s*=\s*(\d+)/)?.[1]
);
const applicationProtocolVersion = Number(
  healthBridgeSource.match(/\bRAYEN_EXTENSION_PROTOCOL_VERSION\s*=\s*(\d+)/)?.[1]
);
if (!Number.isInteger(extensionProtocolVersion)) {
  fail('background.js no declara EXTENSION_PROTOCOL_VERSION como entero literal.');
}
if (!Number.isInteger(applicationProtocolVersion)) {
  fail('La aplicación HHR no declara RAYEN_EXTENSION_PROTOCOL_VERSION como entero literal.');
}
if (
  Number.isInteger(extensionProtocolVersion) &&
  Number.isInteger(applicationProtocolVersion) &&
  extensionProtocolVersion !== applicationProtocolVersion
) {
  fail(
    `Protocolo incompatible: extensión=${extensionProtocolVersion}, aplicación=${applicationProtocolVersion}.`
  );
}
const executableBackgroundSource = backgroundSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');
const importScriptsCalls = [
  ...executableBackgroundSource.matchAll(/\bimportScripts\s*\(([^)]*)\)\s*;/g),
];
if (importScriptsCalls.length !== 1) {
  fail('background.js debe registrar sus runtimes en una única llamada importScripts() inicial.');
}
const startupCall = importScriptsCalls[0];
const firstDeclarationIndex = executableBackgroundSource.search(
  /\b(?:const|let|var|function|class)\b/
);
if (
  startupCall &&
  firstDeclarationIndex >= 0 &&
  Number(startupCall.index) > firstDeclarationIndex
) {
  fail('importScripts() debe ejecutarse antes de las declaraciones del service worker MV3.');
}
const startupRuntimeList = parseLiteralImportScripts(String(startupCall?.[1] || ''));
if (startupCall && !startupRuntimeList.valid) {
  fail('background service worker debe declarar importScripts() sólo con rutas literales locales.');
}
validateFileReferences(
  `${backgroundWorker || 'background service worker'} importScripts()`,
  startupRuntimeList.files
);
const startupRuntimes = new Set(startupRuntimeList.files);
for (const runtime of mandatoryStartupRuntimes) {
  if (!startupRuntimes.has(runtime)) {
    fail(`${runtime} debe registrarse durante la evaluación inicial del service worker MV3.`);
  }
}
const runtimeLoaderPath = path.join(extensionDir, 'runtime-loader.js');
const runtimeLoaderSource = isRegularFile(runtimeLoaderPath)
  ? readFileSync(runtimeLoaderPath, 'utf8')
  : '';
const executableRuntimeLoaderSource = runtimeLoaderSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');
if (/\bimportScripts\s*\(/.test(executableRuntimeLoaderSource)) {
  fail(
    'runtime-loader.js no puede ejecutar importScripts() después de instalar el service worker MV3.'
  );
}

const extensionFiles = listFiles(extensionDir);
for (const htmlFile of extensionFiles.filter(candidate => /\.html?$/i.test(candidate))) {
  const htmlPath = path.relative(extensionDir, htmlFile).split(path.sep).join('/');
  const htmlSource = readFileSync(htmlFile, 'utf8');
  const htmlDependencies = htmlScriptSources(htmlSource);
  if (htmlDependencies.hasBaseElement) {
    fail(`No se permite <base> en extension/${htmlPath}; altera la resolución local de scripts.`);
  }
  const rawScriptSources = htmlDependencies.sources;
  const localScriptSources = rawScriptSources.filter(file => {
    if (isSafePackagePath(file)) return true;
    fail(`Referencia insegura o externa en ${htmlPath} <script src>: ${String(file)}`);
    return false;
  });
  const resolvedScriptSources = localScriptSources.map(file =>
    path.posix.join(path.posix.dirname(htmlPath), file)
  );
  validateFileReferences(`${htmlPath} <script src>`, resolvedScriptSources);
  for (const mandatoryScript of mandatoryHtmlScripts.get(htmlPath) || []) {
    if (!resolvedScriptSources.includes(mandatoryScript)) {
      fail(`${mandatoryScript} debe permanecer declarado en extension/${htmlPath}.`);
    }
  }
}
for (const file of extensionFiles.filter(candidate => candidate.endsWith('.map'))) {
  fail(`No se permiten source maps en el paquete clínico: ${relative(file)}`);
}
for (const file of extensionFiles.filter(
  candidate => candidate.endsWith('.js') && !candidate.endsWith('.min.js')
)) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) fail(`Sintaxis inválida en ${relative(file)}: ${check.stderr.trim()}`);
}

if (errors.length) {
  console.error(`Extensión Rayen: ${errors.length} control(es) fallaron:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Extensión Rayen v${manifest.version}: paquete válido ` +
    `(${extensionFiles.length} archivos, ${dependencyFiles.size} dependencias verificadas).`
);
