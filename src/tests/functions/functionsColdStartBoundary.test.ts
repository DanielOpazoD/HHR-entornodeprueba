import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Firebase Functions cold-start boundary', () => {
  it('keeps optional Drive and PDF runtimes out of the auth callable startup graph', () => {
    const root = process.cwd();
    const probe = [
      "require('./functions/index.js');",
      "const loaded = Object.keys(require.cache).map(file => file.replaceAll('\\\\', '/'));",
      'process.stdout.write(JSON.stringify({',
      "  googleapis: loaded.some(file => file.includes('/googleapis/')) ,",
      "  pdfLib: loaded.some(file => file.includes('/pdf-lib/'))",
      '}));',
    ].join('\n');

    const output = execFileSync(process.execPath, ['-e', probe], {
      cwd: path.resolve(root),
      encoding: 'utf8',
    });

    expect(JSON.parse(output)).toEqual({
      googleapis: false,
      pdfLib: false,
    });
  });
});
