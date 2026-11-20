// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { checkClinicalClock } from '../../../scripts/check-clinical-clock.mjs';

const GUARD = path.resolve('scripts/check-clinical-clock.mjs');
const CLOCK_SOURCE = "export const CLINICAL_TIME_ZONE = 'Pacific/Easter';\n";
const roots: string[] = [];

/** A synthetic repository made of `files`. */
const createRepository = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hhr-clinical-clock-'));
  roots.push(root);
  for (const [relativePath, content] of Object.entries({
    'src/utils/clinicalTimeZone.ts': CLOCK_SOURCE,
    ...files,
  })) {
    mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    writeFileSync(path.join(root, relativePath), content);
  }
  return root;
};

/** Runs the guard, in this process, on a synthetic repository made of `files`. */
const runGuard = (files: Record<string, string>) => {
  const result = checkClinicalClock(createRepository(files), {});
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('check-clinical-clock', () => {
  it('prints and exits as the command exactly what it decides in process', () => {
    for (const [source, status] of [
      ['export const a = 1;\n', 0],
      ["\nconst zone = 'Pacific/Easter';\n", 1],
    ] as const) {
      const root = createRepository({ 'src/features/a.ts': source });
      const result = spawnSync(process.execPath, [GUARD], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, FOLDER_BOOK_BASE: '' },
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(status);
      expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual(
        checkClinicalClock(root, {})
      );
    }
  });

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

    expect(output).toContain(
      '[utc-today] src/features/a.ts:1 — use getTodayISO() (hospital calendar) instead of the UTC date'
    );
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

  it('rejects the pre-fix Functions prescription clock from origin/main', () => {
    // Exact todayIso excerpt from git show origin/main:functions/lib/prescriptionAccessFunctions.js
    // at 4a65a7518. Keep the fixture independent of later merges and shallow CI checkouts.
    const source = [
      'const todayIso = () => {',
      '  const now = new Date();',
      "  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;",
      '};',
    ].join('\n');
    const { status, output } = runGuard({ 'functions/lib/prescriptionAccessFunctions.js': source });
    expect(status).toBe(1);
    expect(output).toContain('[server-clock-today] functions/lib/prescriptionAccessFunctions.js:2');
  });

  it.each([
    'new Date(createdAt).getDate()',
    'new Date(Date.now()).getMonth()',
    'const created = new Date(createdAt);\ncreated.getFullYear()',
    'const now = new Date();\nnow.getFullYear()',
    'const now = new Date();\nnow.getMonth()',
    'const now = new Date();\n' + 'const padding = 0;\n'.repeat(40) + 'now.getDate()',
    'const created = new Date(createdAt);\n' +
      'const padding = 0;\n'.repeat(40) +
      'created.getDate()',
  ])('rejects server-local instant calendar getters: %s', source => {
    const { status, output } = runGuard({ 'functions/lib/clock.js': source });
    expect(status).toBe(1);
    expect(output).toContain('[server-clock-today] functions/lib/clock.js:1');
  });

  it.each([
    [
      'prescriptionAccessFunctions.js',
      [
        'const createdAtMatchesIsoDate = (createdAt, isoDate) => {',
        '  const created = new Date(createdAt);',
        '  if (Number.isNaN(created.getTime())) return false;',
        "  const recordDate = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')}`;",
        '  return recordDate === isoDate;',
        '};',
      ].join('\n'),
    ],
    [
      'clinicalDocumentExportFunctions.js',
      [
        'const now = new Date();',
        'const year = now.getFullYear().toString();',
        'const monthFolderName = buildDriveMonthFolderName(now);',
      ].join('\n'),
    ],
  ])('rejects the former server calendar code in %s', (file, source) => {
    const { status, output } = runGuard({ [`functions/lib/${file}`]: source });
    expect(status).toBe(1);
    expect(output).toContain(`[server-clock-today] functions/lib/${file}`);
  });

  it.each([
    'const day = new Date().getDate();',
    'const created = new Date(createdAt);\nconst year = created.getFullYear();',
  ])('rejects device calendar getters on now or an instant in the app: %s', source => {
    const { status, output } = runGuard({
      'src/features/a.ts': source,
      'src/tests/a.test.ts': 'const day = new Date().getDate();\n',
    });
    expect(status).toBe(1);
    expect(output).toContain(
      '[device-calendar-today] src/features/a.ts:1 — use getClinicalCalendarDateISO()'
    );
    expect(output).not.toContain('src/tests/a.test.ts');
  });

  it('allows app calendar arithmetic, UTC getters and a device calendar exception with a reason', () => {
    const { status, output } = runGuard({
      'src/features/a.ts': [
        'const a = new Date(2026, 0, 1).getDate();',
        'const b = new Date().getUTCDate();',
        '// clinical-clock-allow device-calendar-today: local midnight of a calendar day read back locally.',
        'const c = new Date(`${value}T00:00:00`);',
        'const label = c.getDate();',
        '// clinical-clock-allow device-calendar-today:',
        'const d = new Date().getMonth();',
        '// clinical-clock-allow server-clock-today: the server rule name does not exempt the app.',
        'const e = new Date().getFullYear();',
      ].join('\n'),
      'functions/lib/a.js':
        '// clinical-clock-allow server-clock-today: a reasoned server exception.\nconst f = new Date(createdAt).getDate();\n',
    });
    expect(status).toBe(1);
    expect(output).toContain('[device-calendar-today] src/features/a.ts:7');
    expect(output).toContain('[device-calendar-today] src/features/a.ts:9');
    expect(output.match(/\[device-calendar-today\]/g)).toHaveLength(2);
    expect(output).not.toContain('functions/lib/a.js');
  });

  it('keeps the calendar noon anchor in the app and server calendar modules only', () => {
    const anchor = "const next = new Date(day + 'T12:00:00Z');";
    const { status, output } = runGuard({
      'src/utils/clinicalDateUtils.ts': anchor,
      'functions/lib/hospitalCalendarDay.js': anchor,
      'src/tests/a.test.ts': anchor,
      'src/features/a.ts': `\n${anchor}`,
      'src/features/b.ts': 'const day = new Date(`${value}T12:00:00.000Z`);',
      'functions/lib/a.js': anchor,
      'netlify/functions/a.ts': anchor,
    });
    expect(status).toBe(1);
    expect(output).toContain(
      '[hand-calendar-anchor] src/features/a.ts:2 — use addCalendarDays() / diffCalendarDays() / isCalendarDate() / calendarDayAtUtcNoon() from src/utils/clinicalDateUtils'
    );
    expect(output).toContain('[hand-calendar-anchor] src/features/b.ts:1');
    expect(output).toContain('[hand-calendar-anchor] netlify/functions/a.ts:1');
    expect(output).toContain(
      '[hand-calendar-anchor] functions/lib/a.js:1 — use addCalendarDays() / isCalendarDay() / calendarDayAtUtcNoon() from functions/lib/hospitalCalendarDay'
    );
    expect(output.match(/\[hand-calendar-anchor\]/g)).toHaveLength(4);
  });

  it('keeps the shift hours in the shift schedule and accepts a named hour with its reason', () => {
    const { status, output } = runGuard({
      'src/utils/clinicalDayScheduleUtils.ts': "const START = '08:00';\nconst NIGHT = 20 * 60;\n",
      // The attribution fallback and handoff defaults before W15-CLK1.
      'src/hooks/a.ts': [
        'const schedule = { dayStart: \'08:00\', nightEnd: "09:00" };',
        'const nightStartMinutes = 20 * 60;',
        'const shown = `${s?.nightStart || `20:00`}`;',
        "const early = time >= '8:00';",
      ].join('\n'),
      'netlify/functions/b.ts': 'const start = 9 * 60;\n',
      'src/features/c.ts': [
        '// clinical-clock-allow shift-start-literal: the fluid balance day starts at 08:00 every day.',
        "const FLUID_BALANCE_DAY_START = '08:00';",
        'const STALE_AFTER_MS = 8 * 60 * 1000;',
        "const reminder = '18:00';",
        "const placeholder = '08:30';",
        '// clinical-clock-allow shift-start-literal:',
        "const unexplained = '20:00';",
      ].join('\n'),
      'src/tests/d.test.ts': "expect(isWithinDayShift('08:00')).toBe(true);\n",
    });
    expect(status).toBe(1);
    expect(output).toContain(
      '[shift-start-literal] src/hooks/a.ts:1 — the shift hours live in src/utils/clinicalDayScheduleUtils.ts: use getShiftSchedule(), resolveClinicalDayBounds(), getCurrentShift(), DEFAULT_SHIFT_SCHEDULE or NIGHT_SHIFT_START_MINUTES from src/utils/clinicalDayUtils; an hour with another meaning gets its own named constant behind clinical-clock-allow shift-start-literal: <reason>'
    );
    for (const location of [
      'src/hooks/a.ts:2',
      'src/hooks/a.ts:3',
      'src/hooks/a.ts:4',
      'netlify/functions/b.ts:1',
      'src/features/c.ts:7',
    ])
      expect(output).toContain(`[shift-start-literal] ${location} `);
    expect(output.match(/\[shift-start-literal\]/g)).toHaveLength(6);
  });

  it('reports a zone-less wall-clock time read as an instant and names the hospital clock', () => {
    const { status, output } = runGuard({
      // The nurse window before 2026-11-17 (previousDayCorrections.ts).
      'src/features/a.ts': [
        'export const canWrite = (day: string, isAdmin: boolean): boolean =>',
        '  isAdmin || Date.now() - new Date(`${day}T00:00:00`).getTime() < 172_800_000;',
        "const start = Date.parse(day + 'T00:00');",
        'const open = now < start + 1;',
        'const midnight = new Date(`${day}T00:00:00.000`);',
        'const late = Date.now() >= midnight.valueOf();',
      ].join('\n'),
      // The census lock before W14-TZ1 (stabilityRulesController.ts): a device noon.
      'src/hooks/c.ts': [
        'const recordDateAtNoon = new Date(`${record.date}T12:00:00`);',
        'const hours = (now.getTime() - recordDateAtNoon.getTime()) / 3_600_000;',
        'const shift = Date.parse(`${day}T08:00`) > Date.now();',
      ].join('\n'),
      'netlify/functions/b.ts': 'const past = (now as Date) > new Date(`${day}T00:00:00`);\n',
    });
    expect(status).toBe(1);
    for (const location of [
      'src/features/a.ts:2',
      'src/features/a.ts:4',
      'src/features/a.ts:6',
      'src/hooks/c.ts:2',
      'src/hooks/c.ts:3',
    ])
      expect(output).toContain(
        `[device-wall-clock-instant] ${location} — a zone-less Thh:mm is the device's wall clock: use clinicalWallClockToDate(day, 'hh:mm') from src/utils/clinicalWallClock for the hospital's, a day-write predicate of src/shared/access/censusDayWriteAccessPolicy for the 48 h window, and diffCalendarDays() for day counts`
      );
    expect(output).toContain('[device-wall-clock-instant] netlify/functions/b.ts:1');
    expect(output.match(/\[device-wall-clock-instant\]/g)).toHaveLength(6);
  });

  it('allows a zone-less wall-clock time read back as a calendar day, zoned times and the hospital midnight', () => {
    const { status, output } = runGuard({
      'src/features/a.ts': [
        // clinicalDocumentPresentation.ts reads its label back with local getters.
        '// clinical-clock-allow device-calendar-today: local midnight read back with local getters.',
        'const parsed = new Date(`${value}T00:00:00`);',
        'if (Number.isNaN(parsed.getTime())) throw new Error(value);',
        'const utc = Date.now() - new Date(`${day}T00:00:00Z`).getTime();',
        // clinicalDayScheduleUtils.ts reads a device noon back as its weekday.
        'const weekday = new Date(`${day}T12:00:00`).getDay();',
        'const offset = Date.now() - Date.parse(`${day}T00:00:00-05:00`);',
        "const open = Date.now() - clinicalWallClockToDate(day, '00:00').getTime() < 1;",
        'const name = `${day}T00:00:00` + suffix;',
      ].join('\n'),
      'src/tests/a.test.ts': 'const m = Date.now() - new Date(`${day}T00:00:00`).getTime();\n',
    });
    expect(output).toContain('Clinical clock checks passed');
    expect(status).toBe(0);
  });

  it('reports UTC today in Functions libraries and the entrypoint', () => {
    const today = ['new Date()', 'toISOString()', 'slice(0, 10)'].join('.');
    const { status, output } = runGuard({
      'functions/lib/upload.js': `const day = ${today};`,
      'functions/index.js': `const day = ${today};`,
    });
    expect(status).toBe(1);
    for (const file of ['functions/lib/upload.js', 'functions/index.js']) {
      expect(output).toContain(
        `[utc-today] ${file}:1 — use hospitalCalendarDay() from functions/lib/hospitalCalendarDay instead of the UTC date`
      );
    }
    expect(output).not.toContain('getTodayISO()');
  });

  it('allows Functions timestamps, explicit hospital dates and calendar arithmetic', () => {
    const { status, output } = runGuard({
      'functions/lib/calendar.js': [
        'const timestamp = new Date().toISOString();',
        "const format = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Easter', year: 'numeric', month: '2-digit', day: '2-digit' });",
        'const today = format.format(new Date());',
        'const previousLocal = (year, month, day) => { const date = new Date(year, month, day); date.setDate(date.getDate() - 1); return date; };',
      ].join('\n'),
      'functions/lib/hospitalCalendarDay.js':
        "const previousDay = iso => { const date = new Date(iso + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() - 1); return date.toISOString().slice(0, 10); };",
    });
    expect(output).toContain('Clinical clock checks passed');
    expect(status).toBe(0);
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

  it('keeps calendar arithmetic, unrelated arrays, shadowed aliases and source text out of instant violations', () => {
    const { status, output } = runGuard({
      'src/features/a.ts': [
        'const day = new Date(Date.UTC(2026, 9, 24, 12)).toISOString().slice(0,10);',
        'const anchor = calendarDayAtUtcNoon(key);',
        "const next = new Date(anchor.getTime() + 86400000).toISOString().split('T')[0];",
        'const subset = records.slice(0,10);',
        'const iso = n.updatedAt;',
        'function label(iso: string) { return iso.slice(0,10); }',
        "function other() { const iso = 'ordinary text'; return iso.slice(0,10); }",
        '// n.updatedAt!.slice(0,10)',
        'const text = "n.updatedAt!.slice(0,10)";',
        '// clinical-clock-allow instant-calendar-slice: Rayen admissionAt is unzoned hospital wall time.',
        'const allowed = (n.admissionAt as string).slice(0,10);',
      ].join('\n'),
    });
    expect(output).toContain('Clinical clock checks passed');
    expect(status).toBe(0);
  });

  it('does not treat a calendar fallback or a Date.UTC instant with noncalendar hours as calendar proof', () => {
    const { status, output } = runGuard({
      'src/features/a.ts': [
        'new Date(x || Date.UTC(2026, 9, 24)).toISOString().slice(0,10);',
        'new Date(Date.UTC(2026, 9, 25, hour, minute)).toISOString().slice(0,10);',
      ].join('\n'),
    });
    expect(status).toBe(1);
    expect(output).toContain('[instant-calendar-slice] src/features/a.ts:1');
    expect(output).toContain('[instant-calendar-slice] src/features/a.ts:2');
  });

  it.each([
    'const iso = n.updatedAt; iso.slice(0,10)',
    'n.updatedAt!.slice(0,10)',
    '(n.updatedAt as string).slice(0,10)',
    "(n.updatedAt || '').slice(0,10)",
    'r.lastUpdated.slice(0,10)',
    "isoNow.split('T')[0]",
    'new Date(x).toISOString().slice(0,10)',
    "v.toDate().toISOString().split('T')[0]",
  ])('rejects hidden instant date cuts in src and Netlify: %s', expression => {
    for (const file of ['src/features/a.ts', 'netlify/functions/a.ts']) {
      const { status, output } = runGuard({ [file]: expression });
      expect(output).toContain(`[instant-calendar-slice] ${file}:1`);
      expect(status).toBe(1);
    }
  });

  it('parses TypeScript angle assertions using the source extension', () => {
    const { status, output } = runGuard({
      'src/features/a.ts': '(<string>n.updatedAt).slice(0,10);',
    });
    expect(status).toBe(1);
    expect(output).toContain('[instant-calendar-slice] src/features/a.ts:1');
  });

  it.each(['', ' ', '   ', '\t'])('rejects an exception without a reason: %j', reason => {
    const { status, output } = runGuard({
      'src/features/a.ts': `// clinical-clock-allow instant-calendar-slice: ${reason}\nconst day = n.updatedAt.slice(0,10);`,
    });
    expect(output).toContain('[instant-calendar-slice] src/features/a.ts:2');
    expect(status).toBe(1);
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

  it('lets hand-written date patterns only go down from the base commit', () => {
    const pattern = '/^\\d{4}-\\d{2}-\\d{2}$/.test(day);\n';
    const root = createRepository({
      'src/features/a.ts': pattern.repeat(2),
      'src/utils/clinicalDateUtils.ts': pattern,
      'functions/lib/hospitalCalendarDay.js': pattern,
    });
    const git = (...args: string[]) =>
      spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }).stdout.trim();
    git('init', '-q');
    git('add', '-A');
    git(
      '-c',
      'user.name=synthetic',
      '-c',
      'user.email=synthetic@example.invalid',
      'commit',
      '-qm',
      'base'
    );
    const env = { FOLDER_BOOK_BASE: git('rev-parse', 'HEAD') };
    const write = (file: string, content: string) => {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), content);
    };

    expect(checkClinicalClock(root, env).status).toBe(0);
    for (const added of ['src/features/b.ts', 'functions/lib/b.js']) {
      write(added, pattern);
      const { status, stderr } = checkClinicalClock(root, env);
      expect(status).toBe(1);
      expect(stderr).toContain(
        '[hand-date-pattern] src/ + functions/lib/ — 3 lines with a hand-written \\d{4}-\\d{2}-\\d{2} pattern, 2 at the base'
      );
      expect(stderr).toContain('isCalendarDate()');
      rmSync(path.join(root, added));
    }
    // The calendar modules, tests and declarations do not count; going down always passes.
    write('src/utils/clinicalDateUtils.ts', pattern.repeat(4));
    write('functions/lib/hospitalCalendarDay.js', pattern.repeat(4));
    write('src/tests/a.test.ts', pattern);
    write('src/features/a.test.ts', pattern);
    write('src/types/a.d.ts', pattern);
    expect(checkClinicalClock(root, env).status).toBe(0);
    write('src/features/a.ts', pattern);
    expect(checkClinicalClock(root, env).status).toBe(0);
    // A base this checkout lacks fails; no base at all only warns.
    expect(checkClinicalClock(root, { FOLDER_BOOK_BASE: 'deadbeef' }).stderr).toContain(
      'FOLDER_BOOK_BASE=deadbeef no es un commit de este checkout'
    );
    write('src/features/b.ts', pattern.repeat(5));
    const withoutBase = checkClinicalClock(root, {});
    expect(withoutBase.status).toBe(0);
    expect(withoutBase.stdout).toContain('no se comparó la cuenta de fechas escritas a mano');
  });
});
