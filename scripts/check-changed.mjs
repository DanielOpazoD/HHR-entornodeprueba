#!/usr/bin/env node
import fs from 'node:fs';
import { getChangedFiles } from './lib/changedFiles.mjs';
import {
  resolveCommandConcurrency,
  runCommandsWithConcurrency,
} from './lib/parallelCommandRunner.mjs';

const started = Date.now();
const reportOutcome = ({ task, status, error, stdout, stderr, durationMs }) => {
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  console.log(
    `[changed] ${task.command} ${task.args.join(' ')}: ${(durationMs / 1000).toFixed(1)} s`
  );
  if (status !== 0) {
    console.error(`[changed] ${task.repair}${error ? ` (${error.message})` : ''}`);
    process.exitCode = 1;
  }
};

try {
  const changed = getChangedFiles();
  console.log(`[changed] ${changed.size} archivos respecto de origin/main y cambios locales.`);
  const matches = pattern => [...changed].some(file => pattern.test(file));
  const checks = [
    ['test-governance', /^src\/tests\//, 'Retira only/skip prohibidos de las pruebas.'],
    [
      'module-size',
      /^(src\/|functions\/lib\/|netlify\/functions\/)/,
      'Divide los módulos que superen su límite; retira las excepciones obsoletas.',
    ],
    [
      'declared-dependencies',
      /^(src\/|netlify\/|e2e\/|scripts\/|[^/]+\.(?:[cm]?[jt]sx?|json)$)/,
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
    [
      'import-cycles',
      /^(src\/|functions\/lib\/|netlify\/functions\/)/,
      'Rompe el ciclo de imports indicado por el control.',
    ],
    [
      'repo-hygiene',
      /^(?:Formularios\/|Hospital Salvador\/|printables\/|[^/]+\.png$|AGENTS\.md$)/i,
      'Restaura los archivos que el responsable protege o registra su aprobación, o acorta AGENTS.md, como indica el control.',
    ],
    ['architecture', /^src\//, 'Respeta la capa que nombra el control.'],
    [
      'feature-map',
      /^(src\/|e2e\/|functions\/lib\/|extension\/|docs\/DOMAIN_RULES\.md$|scripts\/config\/(?:feature-map|e2e-test-ownership)\.json$)/,
      'Actualiza la fila de scripts/config/feature-map.json que nombra el control.',
    ],
    [
      'folder-dependencies',
      /^(src\/|netlify\/functions\/)/,
      'Respeta la dirección entre capas: mueve hacia abajo lo compartido o lleva a su feature lo que solo usa ella, como indica el control.',
    ],
    [
      'clinical-clock',
      /^(src\/|functions\/|netlify\/|e2e\/|extension\/|playwright[\w.-]*\.config\.ts$)/,
      'Usa el reloj del hospital (src/utils/clinicalTimeZone.ts) como indica el control.',
    ],
    [
      'cudyr-source-parser',
      /^(src\/|functions\/)/,
      'El analizador CUDYR del servidor quedó distinto de su fuente: ejecuta node scripts/build-cudyr-source-parser.mjs y agrega functions/lib/generated/cudyrSourceParser.cjs al commit.',
    ],
    [
      'shared-functions-contracts',
      /^(src\/|functions\/)/,
      'Los contratos compartidos del servidor quedaron distintos de su fuente: ejecuta node scripts/build-shared-functions-contracts.mjs y agrega functions/lib/generated/sharedDailyRecordContracts.cjs al commit.',
    ],
  ];
  const tasks = [];
  for (const [name, pattern, repair] of checks) {
    if (matches(pattern) || matches(/^package(?:-lock)?\.json$/) || matches(/^scripts\//)) {
      tasks.push({ command: 'npm', args: ['run', '-s', `check:${name}`], repair });
    }
  }
  const files = [...changed].filter(file => fs.existsSync(file) && fs.statSync(file).isFile());
  for (let index = 0; index < files.length; index += 50) {
    const batch = files.slice(index, index + 50);
    tasks.push({
      command: './node_modules/.bin/prettier',
      args: ['--check', '--ignore-unknown', ...batch],
      repair: 'Ejecuta prettier --write sobre los archivos indicados.',
    });
    const code = batch.filter(file => /\.(?:[cm]?[jt]sx?)$/.test(file));
    if (code.length) {
      tasks.push({
        command: './node_modules/.bin/eslint',
        args: ['--max-warnings', '0', '--no-warn-ignored', ...code],
        repair: 'Corrige los errores ESLint indicados.',
      });
    }
  }
  const outcomes = await runCommandsWithConcurrency(tasks, {
    concurrency: resolveCommandConcurrency(4),
  });
  for (const outcome of outcomes) {
    reportOutcome(outcome);
  }
} catch (error) {
  console.error(`[changed] ${error.message}`);
  process.exitCode = 1;
}
console.log(`[changed] Total: ${((Date.now() - started) / 1000).toFixed(1)} s`);
