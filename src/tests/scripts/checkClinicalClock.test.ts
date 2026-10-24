// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const GUARD = path.resolve('scripts/check-clinical-clock.mjs');
const CLOCK_SOURCE = "export const CLINICAL_TIME_ZONE = 'Pacific/Easter';\n";
const roots: string[] = [];

/** Runs the guard on a synthetic repository made of `files`. */
const runGuard = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hhr-clinical-clock-'));
  roots.push(root);
  for (const [relativePath, content] of Object.entries({
    'src/utils/clinicalTimeZone.ts': CLOCK_SOURCE,
    ...files,
  })) {
    mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    writeFileSync(path.join(root, relativePath), content);
  }
  const result = spawnSync(process.execPath, [GUARD], { cwd: root, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('check-clinical-clock', () => {
  it('passes code that reads every date and time on the hospital clock', () => {
    const { status, output } = runGuard({
      'src/features/a.ts': [
        "const time = (iso: string) => new Date(iso).toLocaleTimeString('es-CL', {",
        "  timeZone: CLINICAL_TIME_ZONE, hour: '2-digit',",
        '});',
        "const day = (ms: number) => new Date(ms).toLocaleDateString('es-CL', { ...opts, timeZone: 'UTC' });",
        "const count = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 1 });",
      ].join('\n'),
      'src/tests/a.test.ts': 'const hour = new Date().getHours();\n',
    });

    expect(output).toContain('Clinical clock checks passed');
    expect(status).toBe(0);
  });

  it('reports the zone literal anywhere but the clock source, Playwright configs included', () => {
    const { status, output } = runGuard({
      'src/features/a.ts': "\nconst zone = 'Pacific/Easter';\n",
      'e2e/a.spec.ts': "test.use({ timezoneId: 'Pacific/Easter' });\n",
      'playwright.census.config.ts': "export default { use: { timezoneId: 'Pacific/Easter' } };\n",
    });

    expect(status).toBe(1);
    expect(output).toContain('[zone-literal] src/features/a.ts:2');
    expect(output).toContain('[zone-literal] e2e/a.spec.ts:1');
    expect(output).toContain('[zone-literal] playwright.census.config.ts:1');
    expect(output).not.toContain('src/utils/clinicalTimeZone.ts');
  });

  it('reports every UTC "today" in production, unit tests and e2e specs', () => {
    // Built from parts so this test file does not trip the guard it checks.
    const utcToday = (cut: string) => ['new Date()', 'toISOString()', cut].join('.');
    const { output } = runGuard({
      'src/features/a.ts': `const today = ${utcToday("split('T')[0]")};\n`,
      'src/tests/a.test.ts': `const a = ${utcToday('slice(0, 10)')};\n\nconst b = ${utcToday('slice(0, 10)')};\n`,
      'e2e/a.spec.ts': `const day = process.env.E2E_FIXED_DATE ?? ${utcToday('substring(0, 10)')};\n`,
    });

    expect(output).toContain('[utc-today] src/features/a.ts:1');
    expect(output).toContain('[utc-today] src/tests/a.test.ts:1');
    expect(output).toContain('[utc-today] src/tests/a.test.ts:3');
    expect(output).toContain('[utc-today] e2e/a.spec.ts:1');
  });

  it('reports the device-clock "today" idiom', () => {
    const { output } = runGuard({
      'src/features/a.ts':
        'const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);\nconst iso = local.toISOString().split("T")[0];\n',
    });

    expect(output).toContain('[device-clock-today] src/features/a.ts:1');
  });

  it('reports each date format call that leaves the zone to the device', () => {
    const { output } = runGuard({
      'src/features/a.tsx': [
        "const a = date.toLocaleDateString('es-CL');",
        "const b = new Intl.DateTimeFormat('es-CL', { dateStyle: 'short' }).format(date);",
        "const c = new Date(iso).toLocaleString('es-CL');",
        "const d = value.toLocaleString('es-CL', { hour: '2-digit' });",
        "const e = date.toLocaleTimeString([], {\n  hour: '2-digit',\n});",
      ].join('\n'),
      'src/tests/a.test.ts': "const ignored = date.toLocaleDateString('es-CL');\n",
    });

    for (const line of [1, 2, 3, 4, 5]) {
      expect(output).toContain(`[zone-less-format] src/features/a.tsx:${line}`);
    }
    expect(output).not.toContain('src/tests/a.test.ts');
  });

  it('reports hours and minutes read from the device clock', () => {
    const { output } = runGuard({
      'src/features/a.ts': 'const hh = date.getHours();\nconst mm = date.getMinutes();\n',
    });

    expect(output).toContain('[device-clock-time] src/features/a.ts:1');
    expect(output).toContain('[device-clock-time] src/features/a.ts:2');
  });
  it('reports device toTimeString calls as well as locale time calls without a zone', () => {
    const { status, output } = runGuard({
      'src/features/a.ts': [
        'const a = new Date().toTimeString().slice(0, 5);',
        "const b = date.toLocaleTimeString('es-CL');",
        "const c = date.toLocaleTimeString('es-CL', { timeZone: CLINICAL_TIME_ZONE });",
      ].join('\n'),
    });
    expect(status).toBe(1);
    expect(output).toContain('[device-clock-time] src/features/a.ts:1');
    expect(output).toContain('[zone-less-format] src/features/a.ts:2');
    expect(output).not.toContain('src/features/a.ts:3');
  });

  it('reports UTC date cuts of stored instants including optional and fallback receivers', () => {
    const { status, output } = runGuard({
      'src/features/a.ts': [
        'const a = note.updatedAt?.slice(0, 10);',
        "const b = createdAt.split('T')[0];",
        'const c = signedAt.substring(0, 10);',
        'const d = event.timestamp.slice(0, 10);',
        "const e = (photo.takenAt || photo.uploadedAt).split('T')[0];",
        'const f = event.uploadedAt . slice ( 0 , 10 );',
      ].join('\n'),
    });
    expect(status).toBe(1);
    for (const line of [1, 2, 3, 4, 5, 6]) {
      expect(output).toContain(`[instant-calendar-slice] src/features/a.ts:${line}`);
    }
  });

  it('allows only a local date-cut exception with a reason', () => {
    const { status, output } = runGuard({
      'src/features/a.ts': [
        '// clinical-clock-allow instant-calendar-slice: Rayen admissionAt is unzoned hospital wall time.',
        'const a = evidence.admissionAt.slice(0, 10);',
        'const b = evidence.updatedAt.slice(0, 10);',
        '// clinical-clock-allow instant-calendar-slice:',
        'const c = evidence.createdAt.slice(0, 10);',
      ].join('\n'),
    });
    expect(status).toBe(1);
    expect(output).not.toContain('src/features/a.ts:2');
    expect(output).toContain('[instant-calendar-slice] src/features/a.ts:3');
    expect(output).toContain('[instant-calendar-slice] src/features/a.ts:5');
  });
});
