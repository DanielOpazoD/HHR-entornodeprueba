// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const zones = ['components', 'context', 'hooks', 'services'];
// Both real guards on main 764252f were run against these 84 synthetic repositories.
// 82 verdicts matched; two near-shims were rejected only by the folder guard.
// No module rejection was accepted by the folder guard. Freeze these verdicts;
// never derive expected results from the live matrix.
const rejectedPairs = new Set([
  'context->components',
  'hooks->components',
  'services->components',
  'services->context',
  'services->hooks',
]);
const matrix = readFileSync('scripts/folder-dependency-matrix.json', 'utf8');
const allowlist = readFileSync('scripts/folder-dependency-allowlist.json', 'utf8');
const fixtures: {
  name: string;
  files: Record<string, string>;
  status: number;
  reportedCrossings?: number;
}[] = [];
for (const from of zones) {
  for (const to of zones) {
    for (const form of ['alias', 'relative', 're-export']) {
      const specifier = form === 'relative' ? `../${to}/target` : `@/${to}/target`;
      fixtures.push({
        name: `${from}->${to} ${form}`,
        files: {
          [`src/${from}/probe.ts`]:
            form === 're-export'
              ? `export { x } from '${specifier}';`
              : `import { x } from '${specifier}';`,
          [`src/${to}/target.ts`]: 'export const x = 1;',
        },
        status: rejectedPairs.has(`${from}->${to}`) ? 1 : 0,
      });
    }
  }
}
for (const extension of ['.ts', '.tsx', '.js', '.jsx']) {
  const cases = [
    {
      name: 'type-only',
      code: "import type { x } from '@/hooks/target';",
      target: `src/hooks/target${extension}`,
      status: 1,
    },
    {
      name: 'barrel',
      code: "import { x } from '@/hooks/target';",
      target: `src/hooks/target/index${extension}`,
      status: 1,
    },
    {
      name: 'explicit extension',
      code: `import { x } from '@/hooks/target${extension}';`,
      target: `src/hooks/target${extension}`,
      status: 1,
    },
    {
      name: 'dynamic import ignored',
      code: "import('@/hooks/target');",
      target: `src/hooks/target${extension}`,
      status: 0,
    },
    {
      name: 'unresolved ignored',
      code: "import { x } from '@/hooks/missing';",
      target: `src/hooks/target${extension}`,
      status: 0,
    },
    {
      name: 'allowed',
      code: "import { x } from '@/services/target';",
      target: `src/services/target${extension}`,
      status: 0,
    },
    {
      name: 'side-effect ignored',
      code: "import '@/hooks/target';",
      target: `src/hooks/target${extension}`,
      status: 0,
    },
  ];
  for (const fixture of cases) {
    fixtures.push({
      name: `${extension} ${fixture.name}`,
      files: {
        [`src/${fixture.name === 'allowed' ? 'components' : 'services'}/probe${extension}`]:
          fixture.code,
        [fixture.target]: 'export const x = 1;',
      },
      status: fixture.status,
    });
  }
}
for (const source of [
  'probe.d.ts',
  'probe.test.ts',
  'probe.spec.ts',
  'probe.stories.tsx',
  'tests/probe.ts',
]) {
  fixtures.push({
    name: `excluded ${source}`,
    files: {
      [`src/services/${source}`]: "import { x } from '@/hooks/target';",
      'src/hooks/target.ts': 'export const x = 1;',
    },
    status: 0,
  });
}
for (const [name, source, folderStatus] of [
  ['governed shim', "export * from '@/features/census/controllers/probe';", 0],
  [
    'shim with extra code',
    "export * from '@/features/census/controllers/probe';\nexport const extra = 1;",
    1,
  ],
  ['shim with different name', "export * from '@/features/census/controllers/other';", 1],
] as const) {
  fixtures.push({
    name,
    files: {
      'src/hooks/controllers/probe.ts': source,
      'src/features/census/controllers/probe.ts': 'export const x = 1;',
      'src/features/census/controllers/other.ts': 'export const x = 1;',
    },
    status: folderStatus,
  });
}

for (const code of [
  "import { x } from '@/services/target';",
  "import('@/services/target');",
  "import(/* webpackChunkName: 'target' */ '@/services/target');",
  "export { x } from '@/services/target';",
  "import type { x } from '@/services/target';",
]) {
  fixtures.push({
    name: `inventory reports domain->services for ${code}`,
    files: {
      'src/domain/probe.ts': code,
      'src/services/target.ts': 'export const x = 1;',
    },
    status: 0,
    reportedCrossings: 1,
  });
}

for (const [name, code] of [
  ['side effect stays excluded', "import '@/services/target';"],
  ['unresolved stays ignored', "import('@/services/missing');"],
  ['package stays ignored', "import('package');"],
  ['nonliteral stays ignored', 'import(target);'],
  ['comment stays ignored', "// import('@/services/target');"],
]) {
  fixtures.push({
    name: `inventory ${name}`,
    files: {
      'src/domain/probe.ts': code,
      'src/services/target.ts': 'export const x = 1;',
    },
    status: 0,
    reportedCrossings: 0,
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('check-folder-dependencies frozen verdicts', () => {
  it.each(fixtures)('$name', fixture => {
    const root = mkdtempSync(path.join(tmpdir(), 'hhr-folder-dependencies-'));
    roots.push(root);
    const files = {
      'scripts/folder-dependency-matrix.json': matrix,
      'scripts/folder-dependency-allowlist.json': allowlist,
      ...fixture.files,
    };
    for (const [relativePath, content] of Object.entries(files)) {
      const destination = path.join(root, relativePath);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, content);
    }
    const result = spawnSync(
      process.execPath,
      [
        path.resolve('scripts/check-folder-dependencies.mjs'),
        ...(fixture.reportedCrossings === undefined ? [] : ['--report-imports']),
      ],
      {
        cwd: root,
        encoding: 'utf8',
      }
    );
    if (fixture.reportedCrossings !== undefined) {
      expect(result.stdout).toContain(`Unallowlisted crossings: ${fixture.reportedCrossings}`);
      if (fixture.reportedCrossings > 0) {
        expect(result.stdout).toContain('src/domain/probe.ts:1 domain -> services');
      }
    }
    expect(result.error).toBeUndefined();
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(fixture.status);
  });
});
