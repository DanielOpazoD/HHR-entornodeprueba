// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { measureAgentRules, measureModuleGraph } from '../../../scripts/lib/evaluationMetrics.mjs';

const REPORT = path.resolve('scripts/report-quality-metrics.mjs');
const QUALITY_CONFIGS = [
  'release-confidence-pack',
  'critical-smoke-pack',
  'flow-performance-budgets',
  'critical-coverage-thresholds',
  'technical-ownership-map',
].map(name => [`scripts/config/${name}.json`, '{}']);
const roots: string[] = [];

/** A synthetic repository made of `files`. */
const fixture = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hhr-quality-evaluation-'));
  roots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    writeFileSync(path.join(root, relativePath), content);
  }
  return root;
};

/** Runs `report:quality-metrics` on a synthetic repository; returns its JSON and Markdown. */
const runReport = (files: Record<string, string>) => {
  const root = fixture({ ...Object.fromEntries(QUALITY_CONFIGS), ...files });
  const result = spawnSync(process.execPath, [REPORT], { cwd: root, encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return {
    json: JSON.parse(readFileSync(path.join(root, 'reports/quality-metrics.json'), 'utf8')),
    markdown: readFileSync(path.join(root, 'reports/quality-metrics.md'), 'utf8'),
  };
};

const lines = (count: number) => Array.from({ length: count }, (_, i) => `// ${i}`).join('\n');

const AGENTS = [
  '# Reglas',
  '',
  'Cada regla dice qué la impone. **[docs]** marca las que solo dependen de leer.',
  '',
  '### Datos',
  '',
  '- Una regla con control. — _Lo impone:_ `check:a`',
  '- Una regla mixta. — _Lo impone:_ `check:b`; **[docs]** fuera de ella',
  '- Una regla de lectura. — _Lo impone:_ **[docs]**',
  '',
  '### Código',
  '',
  '- Una regla larga',
  '  que sigue en otra línea. — _Lo impone:_ **[docs]**',
  '- Un punto sin control.',
  '',
].join('\n');

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('report:quality-metrics evaluation figures', () => {
  it('reports the figures the quality evaluations recount, in JSON and Markdown', () => {
    const { json, markdown } = runReport({
      'package.json': JSON.stringify({
        scripts: { 'check:a': 'x', 'check:b': 'x', 'report:c': 'x', test: 'x' },
      }),
      'AGENTS.md': AGENTS,
      'scripts/config/unknown-cast-ceilings.json': JSON.stringify({
        files: { 'a.ts': 2, 'b.ts': 1 },
      }),
      'scripts/config/session-raw-read-ledger.json': JSON.stringify({
        owners: {},
        pending: { 'src/a.ts': 'why', 'src/b.ts': 'why' },
      }),
      'scripts/config/unreachable-modules.json': JSON.stringify({
        retained: [{ reason: 'x', files: ['src/old.ts', 'src/older.ts'] }],
      }),
      'src/index.ts': "import { used } from './large';\nexport const start = used;\n",
      'src/large.ts': `${lines(401)}\nexport const used = 1;\nexport const unused = (x: unknown) => x as unknown as number;\n`,
      'src/exact.ts': lines(400),
      'src/tests/day.test.ts': [
        'const day = {} as unknown as DailyRecord;',
        'const days = [] as unknown as DailyRecord[];',
        'const patch = {} as unknown as DailyRecordPatch;',
      ].join('\n'),
    });

    expect(json.source.largeModuleCount).toBe(1);
    expect(json.typeSafety).toMatchObject({
      unknownCastSourceCount: 1,
      unknownCastTestCount: 3,
      unknownCastToDailyRecordTestCount: 2,
    });
    expect(json.evaluation).toEqual({
      unusedProductionExports: { total: 2, types: 0, values: 2, valuesUsedInOwnFile: 0 },
      singleImporterModules: { count: 1, upTo60Lines: 0 },
      npmScripts: { total: 4, byPrefix: { check: 2, report: 1, test: 1 } },
      agentRules: { rules: 4, withDocs: 3, docsOnly: 2, bytes: Buffer.byteLength(AGENTS) },
      exceptionBooks: {
        unknownCastCeilings: 3,
        sessionRawReadPending: 2,
        unreachableRetainedFiles: 2,
      },
    });
    expect(markdown).toContain('Modules over 400 lines: 1');
    expect(markdown).toContain('as unknown as DailyRecord');
    expect(markdown).toContain('AGENTS.md');
  });

  it('says "not measured", never zero, when its source is missing', () => {
    const { json, markdown } = runReport({
      'package.json': '{}',
      'src/index.ts': 'export const start = 1;\n',
    });

    expect(json.evaluation.npmScripts).toBeNull();
    expect(json.evaluation.agentRules).toBeNull();
    expect(json.evaluation.exceptionBooks).toEqual({
      unknownCastCeilings: null,
      sessionRawReadPending: null,
      unreachableRetainedFiles: null,
    });
    expect(markdown).toContain('not measured');
    expect(markdown).not.toContain('npm scripts: 0');
    expect(markdown).not.toContain('AGENTS.md rules: 0');
    expect(markdown).not.toContain('unknown-cast ceilings: 0');
  });
});

describe('measureModuleGraph', () => {
  it('follows re-exports, namespaces, type and dynamic imports from production code only', () => {
    const root = fixture({
      'src/index.ts': [
        "import { viaBarrel } from './barrel';",
        "import * as all from './everything';",
        "import type { Shape } from './types';",
        "import './sideEffect';",
        "const lazy = () => import('./lazy');",
        "type Remote = import('./remote').Remote;",
        'export const start = [viaBarrel, all, lazy] as Array<Shape | Remote | unknown>;',
      ].join('\n'),
      'src/barrel/index.ts':
        "export * from './inner';\nexport { renamed as alias } from './inner';\n",
      'src/barrel/inner.ts': 'export const viaBarrel = 1;\nexport const renamed = 2;\n',
      'src/everything.ts': 'export const a = 1;\nexport const b = 2;\n',
      'src/types.ts': 'export interface Shape { id: string }\nexport type Unused = string;\n',
      'src/sideEffect.ts': 'export const neverAsked = 1;\n',
      'src/lazy.ts': 'export default 1;\nexport const alsoLazy = 2;\n',
      'src/remote.ts': 'export type Remote = number;\nexport type Other = string;\n',
      'src/onlyTested.ts': 'const helper = 1;\nexport const tested = helper;\nexport { helper };\n',
      'src/tests/onlyTested.test.ts': "import { tested } from '../onlyTested';\ntested;\n",
      'src/onlyTested.stories.tsx':
        "import { helper } from './onlyTested';\nexport default helper;\n",
    });

    const { unusedProductionExports } = measureModuleGraph(root);

    // Asked for: viaBarrel (through `export *`), a and b (namespace), Shape, default and
    // alsoLazy (dynamic), Remote. Not asked for: alias and the renamed it re-exports, Unused,
    // Other, neverAsked (side-effect import), tested and helper (tests and stories are not
    // production), start. Only helper is used in its own file.
    expect(unusedProductionExports).toEqual({
      total: 8,
      types: 2,
      values: 6,
      valuesUsedInOwnFile: 1,
    });
  });

  it('counts a Netlify function as an importer and skips its handler exports', () => {
    const root = fixture({
      'src/policy.ts': 'export const policy = 1;\n',
      'src/shared.ts': 'export const shared = 1;\n',
      'src/consumer.ts': "import { shared } from './shared';\nexport const consumer = shared;\n",
      'src/index.ts': "import { consumer } from './consumer';\nconsumer;\n",
      'netlify/functions/send.ts': [
        "import { policy } from '../../src/policy';",
        "import { shared } from '../../src/shared';",
        "import { helper } from './lib/helper';",
        'export const handler = () => [policy, shared, helper];',
      ].join('\n'),
      'netlify/functions/lib/helper.ts': 'export const helper = 1;\nexport const spare = 2;\n',
    });

    const { unusedProductionExports, singleImporterModules } = measureModuleGraph(root);

    // Unused: lib/helper.spare only; the handler's own export is what Netlify calls.
    expect(unusedProductionExports.total).toBe(1);
    // policy (send.ts) and consumer (index.ts); shared has two importers; index.ts has none.
    expect(singleImporterModules).toEqual({ count: 2, upTo60Lines: 2 });
  });

  it('leaves barrels out and counts lines as check:module-size does (a final newline adds one)', () => {
    const root = fixture({
      'src/index.ts': "import { a } from './feature';\nimport { b } from './long';\na; b;\n",
      'src/feature/index.ts': "export { a } from './a';\n",
      'src/feature/a.ts': 'export const a = 1;\n',
      'src/long.ts': `${lines(59)}\nexport const b = 1;\n`,
    });

    expect(measureModuleGraph(root).singleImporterModules).toEqual({ count: 2, upTo60Lines: 1 });
  });
});

describe('measureAgentRules', () => {
  it('counts each rule once, multi-line or last in its section, and not the legend', () => {
    const root = fixture({ 'AGENTS.md': AGENTS });
    expect(measureAgentRules(root)).toEqual({
      rules: 4,
      withDocs: 3,
      docsOnly: 2,
      bytes: Buffer.byteLength(AGENTS),
    });
  });
});
