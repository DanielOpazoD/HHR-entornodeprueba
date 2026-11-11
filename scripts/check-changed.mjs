#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const started = Date.now();
const git = args => execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);
const run = (command, args, repair) => {
  const start = Date.now();
  const result = spawnSync(command, args, { stdio: 'inherit' });
  console.log(
    `[changed] ${command} ${args.join(' ')}: ${((Date.now() - start) / 1000).toFixed(1)} s`
  );
  if (result.status !== 0) {
    console.error(`[changed] ${repair}${result.error ? ` (${result.error.message})` : ''}`);
    process.exitCode = 1;
  }
};

try {
  if (!fs.existsSync('node_modules')) {
    throw new Error('Falta node_modules: enlázalo desde otra copia o instala con npm ci.');
  }
  try {
    execFileSync('git', ['rev-parse', '--verify', 'origin/main'], { stdio: 'ignore' });
  } catch {
    throw new Error('Falta origin/main: ejecuta git fetch origin main y vuelve a intentar.');
  }
  const changed = new Set([
    ...git(['diff', '--name-only', '-z', 'origin/main...HEAD']),
    ...git(['diff', '--name-only', '-z']),
    ...git(['diff', '--cached', '--name-only', '-z', 'HEAD']),
    ...git(['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  console.log(`[changed] ${changed.size} archivos respecto de origin/main y cambios locales.`);
  const matches = pattern => [...changed].some(file => pattern.test(file));
  const source = /^(src\/|tsconfig.*\.json$|package(?:-lock)?\.json$)/;
  const checks = [
    [
      'unchecked-index',
      source,
      'Protege las lecturas nuevas; si bajaron, usa npm run check:unchecked-index -- --write-baseline.',
    ],
    ['test-governance', /^src\/tests\//, 'Retira only/skip prohibidos de las pruebas.'],
    [
      'module-size',
      /^src\//,
      'Divide los módulos que superen su límite; retira las excepciones obsoletas.',
    ],
    [
      'declared-dependencies',
      /^(src\/|netlify\/|e2e\/|scripts\/|\.storybook\/|[^/]+\.(?:[cm]?[jt]sx?|json)$)/,
      'Declara cada paquete importado en package.json.',
    ],
    [
      'empty-on-failure-reads',
      /^src\//,
      'Conserva los datos conocidos y propaga el error de lectura.',
    ],
    [
      'secret-leaks',
      /./,
      'Retira secretos y artefactos prohibidos; revisa el diagnóstico anterior.',
    ],
    ['import-cycles', /^src\//, 'Rompe el ciclo de imports indicado por el control.'],
    [
      'clinical-clock',
      /^(src\/|functions\/|netlify\/|e2e\/|extension\/|playwright[\w.-]*\.config\.ts$)/,
      'Usa el reloj del hospital (src/utils/clinicalTimeZone.ts) como indica el control.',
    ],
    [
      'feature-dependencies',
      /^src\//,
      'Usa la superficie pública y la dirección permitida entre features.',
    ],
  ];
  for (const [name, pattern, repair] of checks) {
    if (matches(pattern) || matches(/^package(?:-lock)?\.json$/) || matches(/^scripts\//)) {
      run('npm', ['run', '-s', `check:${name}`], repair);
    }
  }
  const files = [...changed].filter(file => fs.existsSync(file) && fs.statSync(file).isFile());
  for (let index = 0; index < files.length; index += 50) {
    const batch = files.slice(index, index + 50);
    run(
      './node_modules/.bin/prettier',
      ['--check', '--ignore-unknown', ...batch],
      'Ejecuta prettier --write sobre los archivos indicados.'
    );
    const code = batch.filter(file => /\.(?:[cm]?[jt]sx?)$/.test(file));
    if (code.length) {
      run(
        './node_modules/.bin/eslint',
        ['--max-warnings', '0', '--no-warn-ignored', ...code],
        'Corrige los errores ESLint indicados.'
      );
    }
  }
} catch (error) {
  console.error(`[changed] ${error.message}`);
  process.exitCode = 1;
}
console.log(`[changed] Total: ${((Date.now() - started) / 1000).toFixed(1)} s`);
