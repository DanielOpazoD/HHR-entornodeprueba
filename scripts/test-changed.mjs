#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { getChangedFiles } from './lib/changedFiles.mjs';

const started = Date.now();
try {
  const changed = getChangedFiles();
  const source = [...changed].filter(file => file.startsWith('src/'));
  console.log(
    `[changed] ${changed.size} archivos respecto de origin/main y cambios locales; ${source.length} de src/.`
  );
  if (source.some(file => /^src\/tests\/emulator(?:-ui)?\//.test(file))) {
    console.log(
      '[changed] Pruebas de emulador excluidas; ejecútalas con npm run test:emulator:file -- <ruta>.'
    );
  }
  if (!source.length) {
    console.log('[changed] No hay cambios en src/; no se ejecutan pruebas.');
  } else {
    const result = spawnSync(
      './node_modules/.bin/vitest',
      [
        'related',
        ...source,
        ...process.argv.slice(2),
        '--run',
        '--config',
        'vitest.config.ts',
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
