// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkFeatureMap, FEATURE_MAP_PATH } from '../../../scripts/check-feature-map.mjs';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const feature = (overrides: Record<string, unknown> = {}) => ({
  id: 'census.open-day',
  name: 'Abrir el día',
  owner: 'src/app',
  reach: { screen: 'Censo', controls: [{ testId: 'go-day' }, { text: 'Ir a hoy' }] },
  gate: ['src/app/DayButton.tsx'],
  tests: ['src/tests/day.test.ts', 'e2e/day.spec.ts › opens the selected day'],
  rules: ['TIME-02'],
  ...overrides,
});

const createRepository = (features: unknown[], extraFiles: Record<string, string> = {}) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hhr-feature-map-'));
  roots.push(root);
  const files: Record<string, string> = {
    'src/app/DayButton.tsx':
      'export const DayButton = () => <button data-testid="go-day">Ir a hoy</button>;',
    'src/tests/day.test.ts': "it('selects the day', () => {});",
    'src/tests/onlyInTest.test.tsx': '<div data-testid="test-only" />',
    'src/tests/fixtures/RowFixture.tsx': '<div data-testid="fixture-only" />',
    'src/app/Day.stories.tsx': '<div data-testid="story-only" />',
    'e2e/day.spec.ts': "test('opens the selected day', async () => {});",
    'e2e/manual.spec.ts': "test('opens by hand', async () => {});",
    'scripts/config/e2e-test-ownership.json': JSON.stringify({
      specs: [
        { file: 'e2e/day.spec.ts', lane: 'ci' },
        { file: 'e2e/manual.spec.ts', lane: 'manual' },
      ],
    }),
    'docs/DOMAIN_RULES.md': '| Regla | Texto |\n| TIME-02 | Reloj de Rapa Nui. |\n',
    [FEATURE_MAP_PATH]: JSON.stringify({ version: 1, features }),
    ...extraFiles,
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const destination = path.join(root, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  return root;
};

describe('check-feature-map', () => {
  it('accepts a map whose every citation is true', () => {
    const result = checkFeatureMap(createRepository([feature()]));
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 funciones');
  });

  it.each([
    ['a missing gate', { gate: ['src/app/Gone.tsx'] }, 'la puerta src/app/Gone.tsx no existe'],
    ['no gate', { gate: [] }, 'cita 0 puertas de código'],
    [
      'a missing test',
      { tests: ['src/tests/gone.test.ts'] },
      'la prueba src/tests/gone.test.ts no existe',
    ],
    [
      'a source file cited as test',
      { tests: ['src/app/DayButton.tsx'] },
      'src/app/DayButton.tsx no es un archivo de prueba',
    ],
    ['no test at all', { tests: [] }, 'no cita ninguna prueba'],
    [
      'an e2e title the spec does not have',
      { tests: ['e2e/day.spec.ts › opens the day'] },
      'e2e/day.spec.ts no tiene una prueba titulada «opens the day»',
    ],
    [
      'an e2e spec that never runs automatically',
      { tests: ['e2e/manual.spec.ts › opens by hand'] },
      'e2e/manual.spec.ts tiene carril "manual"',
    ],
    [
      'a testid absent from app code',
      { reach: { screen: 'Censo', controls: [{ testId: 'go-dayX' }] } },
      'el data-testid "go-dayX" no aparece',
    ],
    [
      'a testid present only in a test file',
      { reach: { screen: 'Censo', controls: [{ testId: 'test-only' }] } },
      'el data-testid "test-only" no aparece',
    ],
    [
      'a testid present only in a test support file',
      { reach: { screen: 'Censo', controls: [{ testId: 'fixture-only' }] } },
      'el data-testid "fixture-only" no aparece',
    ],
    [
      'a testid present only in a story',
      { reach: { screen: 'Censo', controls: [{ testId: 'story-only' }] } },
      'el data-testid "story-only" no aparece',
    ],
    [
      'a visible text absent from app code',
      { reach: { screen: 'Censo', controls: [{ text: 'Ir a mañana' }] } },
      'el texto «Ir a mañana» no aparece',
    ],
    ['no visible control', { reach: { screen: 'Censo', controls: [] } }, 'no cita ningún control'],
    ['an unknown rule', { rules: ['SAVE-99'] }, 'la regla SAVE-99 no es una fila'],
    ['no owner folder', { owner: undefined }, 'falta "owner"'],
    [
      'an owner folder that does not exist',
      { owner: 'src/gone' },
      'la carpeta dueña src/gone no existe',
    ],
    [
      'an owner that is a file, not a folder',
      { owner: 'src/app/DayButton.tsx' },
      'la carpeta dueña src/app/DayButton.tsx no existe',
    ],
    [
      'a first gate outside the owner folder',
      { owner: 'src/tests' },
      'la primera puerta src/app/DayButton.tsx no está dentro de la carpeta dueña src/tests',
    ],
  ])('rejects %s with a message that says how to fix it', (_name, overrides, diagnostic) => {
    const result = checkFeatureMap(createRepository([feature(overrides)]));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`census.open-day: ${diagnostic}`);
    expect(result.stderr).toContain(FEATURE_MAP_PATH);
  });

  const flow = (steps: unknown[]) =>
    feature({
      flow: steps,
      gate: ['src/app/DayButton.tsx'],
    });
  const dayStep = { at: 'src/app/DayButton.tsx › DayButton', decides: 'Abre el día elegido.' };
  const saveStep = { at: 'src/app/saveDay.ts › saveDay', decides: 'Guarda el día.' };
  const flowFiles = { 'src/app/saveDay.ts': 'export const saveDay = () => undefined;' };

  it('accepts a flow whose every step names its decision, and counts its steps', () => {
    const result = checkFeatureMap(createRepository([flow([dayStep, saveStep])], flowFiles));
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 flujos con 2 pasos');
  });

  it.each([
    [
      'a step whose file does not name the symbol',
      [dayStep, { ...saveStep, at: 'src/app/saveDay.ts › saveNight' }],
      'src/app/saveDay.ts no nombra «saveNight»',
    ],
    [
      'a symbol that only appears inside a longer name',
      [dayStep, { ...saveStep, at: 'src/app/saveDay.ts › save' }],
      'src/app/saveDay.ts no nombra «save»',
    ],
    [
      'a step whose file does not exist',
      [dayStep, { ...saveStep, at: 'src/app/gone.ts › saveDay' }],
      'el paso src/app/gone.ts no existe',
    ],
    [
      'a step without a symbol',
      [dayStep, { ...saveStep, at: 'src/app/saveDay.ts' }],
      'el paso «src/app/saveDay.ts» no tiene la forma «ruta › símbolo»',
    ],
    [
      'a step that does not say what it decides',
      [dayStep, { at: saveStep.at, decides: ' ' }],
      `el paso «${saveStep.at}» no dice qué decide`,
    ],
    ['a flow of one step', [dayStep], '"flow" no tiene al menos dos pasos'],
    [
      'a gate that is not a step',
      [saveStep, { ...saveStep, decides: 'Otra vez.' }],
      'la puerta src/app/DayButton.tsx no es un paso de "flow"',
    ],
  ])('rejects %s with a message that says how to fix it', (_name, steps, diagnostic) => {
    const result = checkFeatureMap(createRepository([flow(steps)], flowFiles));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`census.open-day: ${diagnostic}`);
  });

  it('rejects a repeated id and an empty map', () => {
    expect(checkFeatureMap(createRepository([feature(), feature()])).stderr).toContain(
      'el id está repetido'
    );
    expect(checkFeatureMap(createRepository([])).status).toBe(1);
  });

  it('turns red when a copy of the real map cites a route that no longer exists', () => {
    const map = JSON.parse(readFileSync(FEATURE_MAP_PATH, 'utf8'));
    expect(map.features.length).toBeGreaterThanOrEqual(25);
    map.features[0].gate = [`${map.features[0].gate[0]}.moved`];
    const copyRoot = mkdtempSync(path.join(tmpdir(), 'hhr-feature-map-copy-'));
    roots.push(copyRoot);
    const copyPath = path.join(copyRoot, 'feature-map.json');
    writeFileSync(copyPath, JSON.stringify(map));

    const result = checkFeatureMap(process.cwd(), { mapPath: copyPath });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${map.features[0].id}: la puerta ${map.features[0].gate[0]}`);
  });

  it('turns red when a copy of the real map cites a flow step whose symbol was renamed', () => {
    const map = JSON.parse(readFileSync(FEATURE_MAP_PATH, 'utf8'));
    const withFlow = map.features.filter((entry: { flow?: unknown[] }) => entry.flow);
    expect(withFlow.map((entry: { id: string }) => entry.id)).toEqual([
      'census.open-day-flow',
      'census.cell-save-flow',
      'eloisa.sync-flow',
      'eloisa.discharge-time-flow',
    ]);
    const renamed = withFlow[1].flow[1];
    renamed.at = `${renamed.at}Renamed`;
    const copyRoot = mkdtempSync(path.join(tmpdir(), 'hhr-feature-map-copy-'));
    roots.push(copyRoot);
    const copyPath = path.join(copyRoot, 'feature-map.json');
    writeFileSync(copyPath, JSON.stringify(map));

    const result = checkFeatureMap(process.cwd(), { mapPath: copyPath });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `census.cell-save-flow: ${renamed.at.split(' › ')[0]} no nombra`
    );
  });

  it('prints and exits as the command exactly what it decides in process', () => {
    for (const [root, status] of [
      [createRepository([feature()]), 0],
      [createRepository([feature({ rules: ['SAVE-99'] })]), 1],
    ] as const) {
      const result = spawnSync(process.execPath, [path.resolve('scripts/check-feature-map.mjs')], {
        cwd: root,
        encoding: 'utf8',
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(status);
      expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual(
        checkFeatureMap(root)
      );
    }
  });
});
