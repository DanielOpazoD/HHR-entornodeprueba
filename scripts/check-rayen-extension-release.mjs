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

if (!existsSync(manifestPath)) {
  console.error('No existe extension/manifest.json.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.manifest_version !== 3) fail('La extensión debe usar Manifest V3.');
if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version || ''))) fail('La versión debe usar formato semver X.Y.Z.');

const declaredFiles = new Set();
if (manifest.background?.service_worker) declaredFiles.add(manifest.background.service_worker);
for (const script of manifest.content_scripts || []) {
  for (const file of script.js || []) declaredFiles.add(file);
  for (const file of script.css || []) declaredFiles.add(file);
}
for (const resourceGroup of manifest.web_accessible_resources || []) {
  for (const file of resourceGroup.resources || []) declaredFiles.add(file);
}
for (const file of declaredFiles) {
  if (!existsSync(path.join(extensionDir, file))) fail(`Falta el recurso declarado: extension/${file}`);
}

const requiredRuntimeFiles = [
  'vendor-lock.json',
  'runtime-loader.js',
  'prescription-print.js',
  'prescription-pdf.js',
  'pdf-print.js',
  'print-pdf.html',
  'print-pdf.js',
  'report-parser.js',
  'jspdf.umd.min.js',
  'pdf-lib.min.js',
  'xlsx.full.min.js',
];
for (const file of requiredRuntimeFiles) {
  if (!existsSync(path.join(extensionDir, file))) fail(`Falta el runtime requerido: extension/${file}`);
}

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
      if (actualHash !== vendor.sha256) fail(`Integridad SHA-256 inválida: extension/${vendor.file}`);
      if (!vendor.package || !vendor.version || !vendor.license) {
        fail(`Trazabilidad incompleta para extension/${vendor.file}`);
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
  'http://localhost/*',
  'https://testinghhr.netlify.app/*',
]);
for (const host of manifest.host_permissions || []) {
  if (!allowedHosts.has(host)) fail(`Permiso de host no revisado: ${host}`);
}

const backgroundSource = readFileSync(path.join(extensionDir, 'background.js'), 'utf8');
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
const importScriptsCalls = [...executableBackgroundSource.matchAll(/\bimportScripts\s*\(([^)]*)\)\s*;/g)];
if (importScriptsCalls.length !== 1) {
  fail('background.js debe registrar sus runtimes en una única llamada importScripts() inicial.');
}
const startupCall = importScriptsCalls[0];
const firstDeclarationIndex = executableBackgroundSource.search(/\b(?:const|let|var|function|class)\b/);
if (startupCall && firstDeclarationIndex >= 0 && Number(startupCall.index) > firstDeclarationIndex) {
  fail('importScripts() debe ejecutarse antes de las declaraciones del service worker MV3.');
}
const startupRuntimes = new Set(
  [...String(startupCall && startupCall[1] || '').matchAll(/(['"])([^'"]+)\1/g)]
    .map(match => match[2])
);
for (const heavyRuntime of ['jspdf.umd.min.js', 'pdf-lib.min.js', 'xlsx.full.min.js']) {
  if (!startupRuntimes.has(heavyRuntime)) {
    fail(`${heavyRuntime} debe registrarse durante la evaluación inicial del service worker MV3.`);
  }
}
const runtimeLoaderSource = readFileSync(path.join(extensionDir, 'runtime-loader.js'), 'utf8');
const executableRuntimeLoaderSource = runtimeLoaderSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');
if (/\bimportScripts\s*\(/.test(executableRuntimeLoaderSource)) {
  fail('runtime-loader.js no puede ejecutar importScripts() después de instalar el service worker MV3.');
}

const listFiles = directory => readdirSync(directory).flatMap(name => {
  const absolute = path.join(directory, name);
  return statSync(absolute).isDirectory() ? listFiles(absolute) : [absolute];
});
const extensionFiles = listFiles(extensionDir);
for (const file of extensionFiles.filter(candidate => candidate.endsWith('.map'))) {
  fail(`No se permiten source maps en el paquete clínico: ${relative(file)}`);
}
for (const file of extensionFiles.filter(candidate => candidate.endsWith('.js') && !candidate.endsWith('.min.js'))) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) fail(`Sintaxis inválida en ${relative(file)}: ${check.stderr.trim()}`);
}

if (errors.length) {
  console.error(`Extensión Rayen: ${errors.length} control(es) fallaron:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Extensión Rayen v${manifest.version}: paquete válido (${extensionFiles.length} archivos, ${declaredFiles.size} recursos declarados).`);
