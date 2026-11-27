// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectArchitectureViolations } from '../../../scripts/check-architecture.mjs';

const roots: string[] = [];

const createRepo = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hhr-check-architecture-'));
  roots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf8');
  }
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('check-architecture (AST)', () => {
  it('flags controllers and hooks importing component implementations and cross-feature imports in restricted layers', () => {
    const root = createRepo({
      'src/features/alpha/components/AlphaCard.tsx': 'export const AlphaCard = () => null;\n',
      'src/features/beta/domain/betaHelper.ts': 'export const beta = 1;\n',
      'src/features/alpha/controllers/alphaController.ts':
        "import { AlphaCard } from '../components/AlphaCard';\nexport const x = AlphaCard;\n",
      'src/features/alpha/hooks/useAlpha.ts':
        "export const load = () => import('@/features/beta/domain/betaHelper');\n",
    });

    const violations = collectArchitectureViolations(root);
    expect(violations).toEqual([
      {
        rule: 'controllers-must-not-import-component-implementation',
        importer: 'src/features/alpha/controllers/alphaController.ts',
        imported: 'src/features/alpha/components/AlphaCard.tsx',
      },
      {
        rule: 'feature-restricted-layers-must-not-cross-import',
        importer: 'src/features/alpha/hooks/useAlpha.ts',
        imported: 'src/features/beta/domain/betaHelper.ts',
      },
    ]);
  });

  it('ignores comment and string decoys that resemble import statements', () => {
    const root = createRepo({
      'src/features/alpha/components/AlphaCard.tsx': 'export const AlphaCard = () => null;\n',
      'src/features/beta/domain/betaHelper.ts': 'export const beta = 1;\n',
      'src/features/alpha/controllers/alphaController.ts': [
        "// import { AlphaCard } from '../components/AlphaCard';",
        'const example = `',
        "import { beta } from '@/features/beta/domain/betaHelper';",
        '`;',
        'export const note = example;',
      ].join('\n'),
    });

    expect(collectArchitectureViolations(root)).toEqual([]);
  });
});
