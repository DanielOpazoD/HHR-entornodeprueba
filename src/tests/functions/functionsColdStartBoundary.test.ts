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

it('discovers the gen1 history schedule with the real Firebase SDK', () => {
  const probe = `
    const f = require('./functions/index.js').pruneDailyRecordHistory;
    process.stdout.write(JSON.stringify({ endpoint: f.__endpoint, trigger: f.__trigger }));
  `;
  const output = execFileSync(process.execPath, ['-e', probe], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, GCLOUD_PROJECT: 'demo-history-prune' },
  });
  const { endpoint, trigger } = JSON.parse(output);
  expect(endpoint.platform).toBe('gcfv1');
  expect(endpoint.region).toEqual(['southamerica-east1']);
  expect(endpoint.availableMemoryMb).toBe(512);
  expect(endpoint.timeoutSeconds).toBe(540);
  expect(endpoint.scheduleTrigger).toMatchObject({
    schedule: '30 4 * * *',
    timeZone: 'Pacific/Easter',
  });
  expect(trigger.schedule).toMatchObject({ schedule: '30 4 * * *', timeZone: 'Pacific/Easter' });
});
