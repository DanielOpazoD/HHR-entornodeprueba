import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Script } from 'node:vm';
import ts from 'typescript';

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

const parseSourceFile = (fileName, source, scriptKind = ts.ScriptKind.JS) =>
  ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind);

const visitAst = (node, visitor) => {
  visitor(node);
  ts.forEachChild(node, child => visitAst(child, visitor));
};

const readConstStringDeclaration = (sourceFile, name) => {
  const values = [];
  visitAst(sourceFile, node => {
    if (!ts.isVariableDeclarationList(node)) return;
    if ((node.flags & ts.NodeFlags.Const) === 0) return;
    for (const declaration of node.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      if (declaration.initializer && ts.isStringLiteralLike(declaration.initializer)) {
        values.push(declaration.initializer.text);
      } else {
        values.push(undefined);
      }
    }
  });
  return values.length === 1 ? values[0] : undefined;
};

const readIntegerConstantDeclaration = (sourceFile, name) => {
  const values = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      const initializer = declaration.initializer;
      if (initializer && ts.isNumericLiteral(initializer) && /^\d+$/.test(initializer.text)) {
        values.push(Number(initializer.text));
      } else {
        values.push(Number.NaN);
      }
    }
  }
  return values.length === 1 ? values[0] : Number.NaN;
};

const isImportScriptsCallee = expression => {
  if (ts.isParenthesizedExpression(expression)) {
    return isImportScriptsCallee(expression.expression);
  }
  if (ts.isIdentifier(expression)) return expression.text === 'importScripts';
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text === 'importScripts';
  if (ts.isElementAccessExpression(expression)) {
    return (
      expression.argumentExpression !== undefined &&
      ts.isStringLiteralLike(expression.argumentExpression) &&
      expression.argumentExpression.text === 'importScripts'
    );
  }
  return false;
};

const collectImportScriptsCalls = sourceFile => {
  const calls = [];
  visitAst(sourceFile, node => {
    if (ts.isCallExpression(node) && isImportScriptsCallee(node.expression)) {
      calls.push(node);
    }
  });
  return calls;
};

const isTopLevelDeclarationStatement = statement =>
  ts.isVariableStatement(statement) ||
  ts.isFunctionDeclaration(statement) ||
  ts.isClassDeclaration(statement);

const extractLiteralImportScriptsArguments = callExpression => {
  const files = [];
  for (const argument of callExpression.arguments) {
    if (!ts.isStringLiteral(argument)) {
      return { files: [], valid: false };
    }
    files.push(argument.text);
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
const injectVersion = isRegularFile(injectPath)
  ? readConstStringDeclaration(
      parseSourceFile('inject-fichamedico.js', readFileSync(injectPath, 'utf8')),
      'INJECT_VERSION'
    )
  : undefined;
if (injectVersion !== manifest.version) {
  fail(
    `inject-fichamedico.js declara INJECT_VERSION='${injectVersion ?? 'ausente'}' y el manifest ${manifest.version}; deben coincidir.`
  );
}
// Gestión de Camas has its own MAIN-world inject with the same lockstep requirement: a manifest
// bump that forgets it marks every open GC tab as `outdated_tab`.
const gestionCamasInjectPath = path.join(extensionDir, 'inject-gestioncamas.js');
const gestionCamasInjectVersion = isRegularFile(gestionCamasInjectPath)
  ? readConstStringDeclaration(
      parseSourceFile('inject-gestioncamas.js', readFileSync(gestionCamasInjectPath, 'utf8')),
      'INJECT_VERSION'
    )
  : undefined;
if (gestionCamasInjectVersion !== manifest.version) {
  fail(
    `inject-gestioncamas.js declara INJECT_VERSION='${gestionCamasInjectVersion ?? 'ausente'}' y el manifest ${manifest.version}; deben coincidir.`
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
if (
  !(manifest.content_scripts || []).some(
    script => script.js?.includes('content-hhr.js') && script.js.includes('content-hhr-exalab.js')
  )
)
  fail('El relé de HHR debe conservar la conexión personal Exalab.');
for (const [index, resourceGroup] of (manifest.web_accessible_resources || []).entries()) {
  validateFileReferences(
    `manifest.web_accessible_resources[${index}].resources`,
    resourceGroup.resources
  );
}

// These package entry points are not reachable from manifest, importScripts(), or another HTML.
// All reachable children are validated from their actual edges instead of duplicated as file roots.
const mandatoryPackageRoots = [
  'vendor-lock.json',
  'print-pdf.html',
  'syslab-offscreen.html',
  'exalab-connect.html',
  'exalab-connect.css',
];
validateFileReferences('raíces obligatorias del paquete', mandatoryPackageRoots);

// Preserve the pre-existing core-feature contract as required graph edges. File existence remains
// derived by validateFileReferences(), while removing an edge and its target together still fails.
const mandatoryStartupRuntimes = [
  'exalab-background.js',
  'runtime-loader.js',
  'prescription-print.js',
  'prescription-pdf.js',
  'pdf-print.js',
  'report-parser.js',
  'jspdf.umd.min.js',
  'pdf-lib.min.js',
  'xlsx.full.min.js',
];
const mandatoryHtmlScripts = new Map([
  ['print-pdf.html', ['print-pdf.js']],
  ['exalab-connect.html', ['hhr-origin-policy.js', 'exalab-connect.js']],
]);

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
  // Public 72-hour weather for fixed coordinates in Rapa Nui.
  'https://api.open-meteo.com/*',
  // Public Chilean calendar month, fetched only from the daily-history dialog.
  'https://www.efemerides.cl/*',
  'https://fichamedico.rayensalud.cl/*',
  // User-requested official DAU: native authenticated GETs, without copying credentials.
  'https://urgencia.saludenred.cl/*',
  // Inline native login/MFA and read-only DAU; restricted API paths live in urgency-api.js.
  'https://api.saludenred.cl/*',
  'https://fichamedicoback.rayensalud.cl/*',
  // Read-only HCC antecedents API observed in Eloisa's official visor flow.
  'https://saludteintegrachileapi.rayensalud.cl/*',
  'https://formulariosclinicosback.rayensalud.cl/*',
  'https://hospitalizado.rayensalud.cl/*',
  'https://hospbackend.rayensalud.cl/*',
  'http://10.4.69.90/syslab/*',
  ...['localhost', '127.0.0.1'].flatMap(host =>
    Array.from({ length: 21 }, (_, index) => `http://${host}:${3000 + index}/*`)
  ),
  'https://hhr-hospitalizados.app/*',
  'https://*.netlify.app/*',
  'https://testinghhr.netlify.app/*',
  'https://hhr-entorno-prueba.netlify.app/*',
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
const backgroundSourceFile = parseSourceFile(backgroundWorker || 'background.js', backgroundSource);
const healthBridgeSourceFile = parseSourceFile(
  'extensionHealthBridge.ts',
  healthBridgeSource,
  ts.ScriptKind.TS
);
const extensionProtocolVersion = readIntegerConstantDeclaration(
  backgroundSourceFile,
  'EXTENSION_PROTOCOL_VERSION'
);
const applicationProtocolVersion = readIntegerConstantDeclaration(
  healthBridgeSourceFile,
  'RAYEN_EXTENSION_PROTOCOL_VERSION'
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
const importScriptsCalls = collectImportScriptsCalls(backgroundSourceFile);
if (importScriptsCalls.length !== 1) {
  fail('background.js debe registrar sus runtimes en una única llamada importScripts() inicial.');
}
const startupCall = importScriptsCalls[0];
const firstDeclarationIndex = backgroundSourceFile.statements.findIndex(
  isTopLevelDeclarationStatement
);
const startupStatementIndex =
  startupCall &&
  ts.isExpressionStatement(startupCall.parent) &&
  startupCall.parent.parent === backgroundSourceFile
    ? backgroundSourceFile.statements.indexOf(startupCall.parent)
    : -1;
if (
  startupCall &&
  (startupStatementIndex === -1 ||
    (firstDeclarationIndex >= 0 && startupStatementIndex > firstDeclarationIndex))
) {
  fail('importScripts() debe ejecutarse antes de las declaraciones del service worker MV3.');
}
const startupRuntimeList = startupCall
  ? extractLiteralImportScriptsArguments(startupCall)
  : { files: [], valid: true };
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
const runtimeLoaderSourceFile = parseSourceFile('runtime-loader.js', runtimeLoaderSource);
if (collectImportScriptsCalls(runtimeLoaderSourceFile).length > 0) {
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
// A structurally invalid package is already rejected; valid packages check every script.
// The package loads them all as classic browser scripts (content scripts, importScripts,
// <script src>), so each one is compiled as a classic script here, never executed.
if (errors.length === 0) {
  for (const file of extensionFiles.filter(
    candidate => candidate.endsWith('.js') && !candidate.endsWith('.min.js')
  )) {
    try {
      new Script(readFileSync(file, 'utf8'), { filename: relative(file) });
    } catch (error) {
      // A compile-time SyntaxError's stack starts with `file:line`.
      const line = /:(\d+)$/.exec(String(error?.stack).split('\n')[0])?.[1];
      fail(`Sintaxis inválida en ${relative(file)}${line ? `, línea ${line}` : ''}: ${error}`);
    }
  }
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
