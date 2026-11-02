// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const guard = path.resolve('scripts/check-clinical-clock.mjs');
const roots: string[] = [];
const run = (file: string, source: string) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hhr-offset-clock-'));
  roots.push(root);
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), source);
  const result = spawnSync(process.execPath, [guard], { cwd: root, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const devicePattern = String.raw`const iso = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);`;
const patientCodePattern = String.raw`const dateMatch = source.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);`;

describe('raw offset clock guard', () => {
  it.each([
    ['src/features/rayen-import/mapping/mapDeviceToInstance.ts', devicePattern],
    ['extension/eloisa-patient-code-contract.js', patientCodePattern],
    ['extension/nested/read.mjs', String.raw`const clock = /[T ](\d{2}):(\d{2})/.exec(raw);`],
    ['src/features/rayen-import/clock.ts', 'const time = (raw as string).slice(11, 16);'],
    ['extension/clock.js', 'const time = raw.substring(11, 16);'],
    ['extension/clock.js', 'const time = raw.substr(11, 5);'],
    ['extension/clock.js', "const time = raw.split('T')[1];"],
    ['extension/clock.js', 'const time = new Date(raw).toISOString().slice(11, 16);'],
  ])('rejects unconverted ISO clock extraction in %s', (file, source) => {
    const result = run(file, source);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`[raw-offset-clock] ${file}:1`);
    expect(result.output).toContain('encounterWallClockInRapaNui()');
    expect(result.output).toContain('hora de Rapa Nui con Intl');
  });

  it.each(['', ' ', '\t'])('requires a nonempty exception reason (%j)', reason => {
    expect(
      run(
        'extension/clock.js',
        `// clinical-clock-allow raw-offset-clock: ${reason}\n${patientCodePattern}`
      ).status
    ).toBe(1);
  });

  it.each([
    'parseHistoryScales',
    'inferNursingShifts',
    'evaluationScaleApplicationIdentity',
    'StaffingBoundaryExclusions',
  ])('accepts explicitly documented unzoned history in %s', name => {
    const result = run(
      `src/features/rayen-import/${name}.ts`,
      `// clinical-clock-allow raw-offset-clock: History stamps have no offset and are Rapa Nui wall time.\n${devicePattern}`
    );
    expect(result.status).toBe(0);
  });

  it('does not exempt a neighboring raw extraction', () => {
    const result = run(
      'extension/clock.js',
      `// clinical-clock-allow raw-offset-clock: Unzoned local history.\n${devicePattern}\n${patientCodePattern}`
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain('extension/clock.js:3');
    expect(result.output).not.toContain('extension/clock.js:2');
  });

  it.each([
    'const local = encounterWallClockInRapaNui(raw); const alias = local; const time = alias?.slice(11, 16);',
    "const local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Pacific/Easter' }).format(new Date(raw)); const time = local.slice(11, 16);",
    String.raw`const local = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?!.*(?:Z|[+-]\d{2}:?\d{2})$)/);`,
    String.raw`const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(raw);`,
    String.raw`const hasTime = /[T\s]\d{1,2}:\d{2}/.test(raw);`,
  ])('accepts converted clocks, offset-excluding grammars and nonextracting checks', source => {
    expect(run('extension/clock.js', source).status).toBe(0);
  });

  it('does not let an outer converted alias exempt a shadowed raw parameter', () => {
    const result = run(
      'src/features/rayen-import/clock.ts',
      'const local = encounterWallClockInRapaNui(raw); function parse(local: string) { return local.slice(11, 16); }'
    );
    expect(result.status).toBe(1);
  });
  it.each([
    String.raw`const time = raw.match(/T(\d{2}):(\d{2})(?:Z|[+-]\d{2}:\d{2})$/);`,
    String.raw`const time = raw.match(/T(\d{2}):(\d{2}):\d{2}(?:Z|[+-]\d{2}:\d{2})$/);`,
    'const local = flag ? encounterWallClockInRapaNui(raw) : raw; const time = local.slice(11, 16);',
    'const local = flag ? raw : encounterWallClockInRapaNui(raw); const time = local.slice(11, 16);',
  ])('rejects offset clocks at every precision and partially converted branches', source => {
    expect(run('extension/clock.js', source).status).toBe(1);
  });

  it.each([
    'const local = flag ? encounterWallClockInRapaNui(raw) : null; const time = local?.slice(11, 16);',
    'const local = flag ? encounterWallClockInRapaNui(raw) : absoluteInstantInRapaNui(raw); const time = local?.slice(11, 16);',
    `// clinical-clock-allow raw-offset-clock: Strict parser validates and consumes the offset.\nconst match =\n  /T(\\d{2}):(\\d{2})(Z|[+-]\\d{2}:\\d{2})$/.exec(raw);`,
  ])('accepts safe branches and a reason before a multiline declaration', source => {
    expect(run('extension/clock.js', source).status).toBe(0);
  });
  it.each([
    'let local = encounterWallClockInRapaNui(raw); local = raw; const time = local.slice(11, 16);',
    'var local = encounterWallClockInRapaNui(raw); local = raw; const time = local.slice(11, 16);',
    'function read(local = encounterWallClockInRapaNui(raw)) { return local.slice(11, 16); }',
  ])('does not infer conversion from mutable bindings or parameter defaults', source => {
    expect(run('extension/clock.js', source).status).toBe(1);
  });

  it.each([
    String.raw`const local = encounterWallClockInRapaNui(raw); const time = local.match(/T(\d{2}):(\d{2})/);`,
    String.raw`const local = encounterWallClockInRapaNui(raw); const time = /T(\d{2}):(\d{2})/.exec(local);`,
  ])('accepts regex clock extraction after the recommended conversion', source => {
    expect(run('extension/clock.js', source).status).toBe(0);
  });
  it.each([
    'const local = encounterWallClockInRapaNui(raw); function read({local}) { return local.slice(11, 16); }',
    'const local = encounterWallClockInRapaNui(raw); function read([local]) { return local.slice(11, 16); }',
    'const local = encounterWallClockInRapaNui(raw); { const {nested: {local}} = input; local.slice(11, 16); }',
    'for (const local of rawValues) { local.slice(11, 16); } const local = encounterWallClockInRapaNui(raw);',
    'for (const local in rawValues) { local.slice(11, 16); } const local = encounterWallClockInRapaNui(raw);',
  ])('keeps destructured and loop bindings separate from converted outer aliases', source => {
    expect(run('extension/clock.js', source).status).toBe(1);
  });
  it.each([
    "const local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Pacific/Easter', ...{ timeZone: 'UTC' } }).format(new Date(raw)); local.slice(11,16);",
    "const local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Pacific/Easter', timeZone: 'UTC' }).format(new Date(raw)); local.slice(11,16);",
    "const local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Pacific/Easter', [key]: zone }).format(new Date(raw)); local.slice(11,16);",
    "const local = new Intl.DateTimeFormat('sv-SE', { /* timeZone: 'Pacific/Easter' */ timeZone: 'UTC' }).format(new Date(raw)); local.slice(11,16);",
    'function read(undefined) { const local = flag ? encounterWallClockInRapaNui(raw) : undefined; return local?.slice(11,16); }',
  ])('rejects overridden Intl zones and a shadowed undefined binding', source => {
    expect(run('extension/clock.js', source).status).toBe(1);
  });

  it.each([
    'const local = flag ? encounterWallClockInRapaNui(raw) : undefined; local?.slice(11,16);',
    "const local = new Intl.DateTimeFormat('sv-SE', { ...style, timeZone: 'Pacific/Easter' }).format(new Date(raw)); local.slice(11,16);",
    "const local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'UTC', timeZone: 'Pacific/Easter' }).format(new Date(raw)); local.slice(11,16);",
  ])('accepts safe absence and an effective explicit Rapa Nui zone', source => {
    expect(run('extension/clock.js', source).status).toBe(0);
  });
});
