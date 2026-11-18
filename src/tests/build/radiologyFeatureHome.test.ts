import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Imaging (MMRAD and DICOM) has one home since W15-A7: the feature, plus the pure contracts that
// Netlify Functions compile too. A new imaging module elsewhere splits the area again.
const HOMES = ['src/features/radiology/', 'src/domain/radiology/'];
const IMAGING_FILE = /(^|\/)radiology\/|\/(dicom|mmrad|radiology)[^/]*$/i;

const walk = (folder: string): string[] =>
  fs
    .readdirSync(folder, { withFileTypes: true })
    .flatMap(entry =>
      entry.isDirectory()
        ? walk(path.posix.join(folder, entry.name))
        : [path.posix.join(folder, entry.name)]
    );

describe('radiology feature home', () => {
  it('keeps every imaging module in features/radiology or domain/radiology', () => {
    const strays = walk('src').filter(
      file =>
        !file.startsWith('src/tests/') &&
        IMAGING_FILE.test(file) &&
        !HOMES.some(home => file.startsWith(home))
    );

    expect(
      strays,
      'Mueve estos módulos de imágenes a src/features/radiology (o, si son puros y Netlify los compila, a src/domain/radiology) con node scripts/move-modules.mjs'
    ).toEqual([]);
  });
});
