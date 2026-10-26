import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Execute page bridges with the same origin dependency order as the manifest. */
export const readHhrBridgeSource = (file: string): string =>
  ['hhr-origin-policy.js', file]
    .map(name => readFileSync(path.resolve('extension', name), 'utf8'))
    .join('\n');
