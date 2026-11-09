#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const parts = version => {
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Versión de extensión inválida: ${version}`);
  }
  const values = version.split('.').map(Number);
  if (values.some(value => value > 65535)) throw new Error('Versión fuera del rango de Chrome.');
  return values;
};

/** Compare the immutable candidate with the actual target branch, never a local counter. */
export const checkExtensionVersionAdvance = ({ root, baseSha, headSha }) => {
  if (![baseSha, headSha].every(sha => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha || ''))) {
    throw new Error('Se requieren los SHA exactos de la base y de la extensión candidata.');
  }
  const files = git(root, [
    'diff',
    '--name-only',
    `${baseSha}...${headSha}`,
    '--',
    'extension',
    'scripts/config/extensionDownloadPlugin.ts',
  ])
    .split('\n')
    .filter(Boolean);
  const runtimeFiles = files.filter(file => file !== 'extension/README.md');
  if (!runtimeFiles.length) return { changed: false };
  const readVersion = sha =>
    JSON.parse(git(root, ['show', `${sha}:extension/manifest.json`])).version;
  const baseVersion = readVersion(baseSha),
    version = readVersion(headSha);
  const previous = parts(baseVersion),
    candidate = parts(version);
  const firstChange = candidate.findIndex((value, index) => value !== previous[index]);
  if (firstChange < 0 || candidate[firstChange] <= previous[firstChange]) {
    throw new Error(
      `La extensión cambia su contenido pero usa ${version}; la base ya tiene ${baseVersion}. ` +
        'Incorpora la última base y asigna una versión superior antes de publicar.'
    );
  }
  return { changed: true, baseVersion, version };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = process.env.CI_GIT_ROOT || process.cwd();
    const baseSha = process.env.CI_EXTENSION_BASE_SHA || git(root, ['rev-parse', 'origin/main']);
    const headSha = process.env.CI_EXTENSION_HEAD_SHA || git(root, ['rev-parse', 'HEAD']);
    console.log(JSON.stringify(checkExtensionVersionAdvance({ root, baseSha, headSha })));
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'No se pudo verificar la versión de la extensión.'
    );
    process.exitCode = 1;
  }
}
