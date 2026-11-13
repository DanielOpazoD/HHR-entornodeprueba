import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const git = args => execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);

export function getChangedFiles() {
  if (!fs.existsSync('node_modules')) {
    throw new Error('Falta node_modules: enlázalo desde otra copia o instala con npm ci.');
  }
  try {
    execFileSync('git', ['rev-parse', '--verify', 'origin/main'], { stdio: 'ignore' });
  } catch {
    throw new Error('Falta origin/main: ejecuta git fetch origin main y vuelve a intentar.');
  }
  return new Set([
    ...git(['diff', '--name-only', '-z', 'origin/main...HEAD']),
    ...git(['diff', '--name-only', '-z']),
    ...git(['diff', '--cached', '--name-only', '-z', 'HEAD']),
    ...git(['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
}
