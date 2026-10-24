// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const moduleUrl = pathToFileURL(
  resolve('src/features/clinical-library/domain/forms/clinicalFormDates.ts')
).href;
// Run the production module in a fresh process: changing TZ in a worker does not
// reliably change its Date implementation on every platform.
const probe = `
  import { formatFormDate, parseFormDate, formAgeAt } from ${JSON.stringify(moduleUrl)};
  console.log(JSON.stringify({
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    printed: ['0001-01-01', '2000-02-29', '2026-04-05', '2026-09-06', '2026-12-31'].map(formatFormDate),
    invalid: ['0000-01-01', '1900-02-29', '2026-02-29', '2026-13-01', '2026-04-31'].map(parseFormDate),
    age: [formAgeAt('2026-09-05', '2026-09-06'), formAgeAt('2026-09-06', '2026-09-06')]
  }));
`;

describe('form calendar dates across device time zones', () => {
  it.each(['UTC', 'Pacific/Easter', 'America/Santiago', 'Pacific/Kiritimati'])(
    'preserves the printed day and neonatal age in %s',
    zone => {
      const output = execFileSync(
        process.execPath,
        ['--experimental-strip-types', '--input-type=module', '--eval', probe],
        {
          env: { ...process.env, TZ: zone },
          encoding: 'utf8',
          timeout: 10_000,
        }
      );
      expect(JSON.parse(output)).toEqual({
        zone,
        printed: ['01/01/0001', '29/02/2000', '05/04/2026', '06/09/2026', '31/12/2026'],
        invalid: [null, null, null, null, null],
        age: ['1 día', '0 días'],
      });
    }
  );
});
