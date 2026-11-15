#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getChangedFiles } from './lib/changedFiles.mjs';

const CONFIG = 'vitest.config.ts';
const read = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
// Local runtime imports (relative or @/) of a file, resolved to repository paths.
const localImports = file =>
  [...read(file).matchAll(/^import\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)]
    .map(([, spec]) =>
      spec.startsWith('@/')
        ? `src/${spec.slice(2)}`
        : spec.startsWith('.')
          ? path.posix.join(path.posix.dirname(file), spec)
          : null
    )
    .filter(Boolean)
    .map(base => ['', '.ts', '.tsx', '.mts', '.js', '.mjs'].map(ext => base + ext))
    .map(candidates => candidates.find(candidate => fs.existsSync(candidate)) ?? candidates[0]);

// Files every unit test loads: the Vitest config and what it imports, the TypeScript config
// used to transform, the dependencies, and the setup files (with their own local imports).
function suiteWideFiles() {
  const setupFiles = [
    ...(read(CONFIG).match(/setupFiles:\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/)?.[1] ?? '').matchAll(
      /['"]([^'"]+)['"]/g
    ),
  ].map(([, file]) => path.posix.normalize(file));
  return new Set([
    CONFIG,
    'tsconfig.json',
    'package.json',
    'package-lock.json',
    ...localImports(CONFIG),
    ...setupFiles,
    ...setupFiles.flatMap(localImports),
  ]);
}

const started = Date.now();
try {
  const changed = getChangedFiles();
  const source = [...changed].filter(file => file.startsWith('src/'));
  const suiteWide = suiteWideFiles();
  const triggers = [...changed].filter(file => suiteWide.has(file));
  console.log(
    `[changed] ${changed.size} archivos respecto de origin/main y cambios locales; ${source.length} de src/.`
  );
  if (source.some(file => /^src\/tests\/emulator(?:-ui)?\//.test(file))) {
    console.log(
      '[changed] Pruebas de emulador excluidas; ejecútalas con npm run test:emulator:file -- <ruta>.'
    );
  }
  if (triggers.length) {
    console.log(
      `[changed] Cambió ${triggers.join(', ')}, que carga toda prueba unitaria; se ejecuta la suite unitaria completa.`
    );
  }
  if (!source.length && !triggers.length) {
    console.log('[changed] No hay cambios en src/; no se ejecutan pruebas.');
  } else {
    const result = spawnSync(
      './node_modules/.bin/vitest',
      [
        ...(triggers.length ? ['run'] : ['related', ...source]),
        ...process.argv.slice(2),
        '--run',
        '--config',
        CONFIG,
        '--exclude',
        'src/tests/security/firestore-rules.test.ts',
        '--exclude',
        'src/tests/security/storage-rules.test.ts',
        '--exclude',
        'src/tests/services/storage/syncQueueLoad.test.ts',
        '--exclude',
        'src/tests/emulator/**',
        '--exclude',
        'src/tests/emulator-ui/**',
        '--passWithNoTests',
      ],
      { stdio: 'inherit' }
    );
    if (result.error) console.error(`[changed] ${result.error.message}`);
    process.exitCode = result.status ?? 1;
  }
} catch (error) {
  console.error(`[changed] ${error.message}`);
  process.exitCode = 1;
}
console.log(`[changed] Total: ${((Date.now() - started) / 1000).toFixed(1)} s`);
