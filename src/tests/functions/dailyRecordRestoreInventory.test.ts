import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
describe('daily record restore deployed inventory', () => {
  it('exports both regional 1GB callables and includes them in deployment verification', () => {
    const output = execFileSync(
      process.execPath,
      [
        '-e',
        `
      const all = require('./functions');
      for (const name of ['previewDailyRecordRestore', 'restoreDailyRecord']) {
        const f = all[name];
        if (!f) throw new Error('Missing callable ' + name);
        console.log(JSON.stringify({ name, endpoint: f.__endpoint }));
      }
    `,
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    );
    const workflow = readFileSync('.github/workflows/deploy-functions.yml', 'utf8');
    for (const name of ['previewDailyRecordRestore', 'restoreDailyRecord']) {
      expect(output).toContain(name);
      expect(workflow).toContain(name);
    }
    expect(output).toContain('southamerica-east1');
    expect(output).toContain('1024');
    expect(output).toContain('540');
  });
});
