// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve('scripts/check-test-governance.mjs');
const roots: string[] = [];
const fixture = (files: Record<string, string>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-test-governance-'));
  roots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
};
const run = (root: string) =>
  spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('test governance CLI', () => {
  it('rejects static focused and skipped declarations across supported call chains', () => {
    const declarations = [
      "it.only('case', () => {});",
      "it.only.each([1])('case', () => {});",
      "test.concurrent.skip('case', () => {});",
      "describe.skip.each([1])('case', () => {});",
      "test['only']('case', () => {});",
      "(it).skip('case', () => {});",
      "import * as runner from 'vitest'; runner.describe.only('case', () => {});",
      "import test from 'node:test'; test.only('case', () => {});",
      "const test = require('node:test'); test.skip('case', () => {});",
      "(<typeof test>test).only('case', () => {});",
      "(test satisfies typeof test).skip('case', () => {});",
      "it.only.each`a | b\n${1} | ${2}`('case', () => {});",
    ];
    const root = fixture(
      Object.fromEntries(
        declarations.map((source, i) => [`src/tests/variant-${i}.test.ts`, source])
      )
    );
    const result = run(root);
    expect(result.status).toBe(1);
    declarations.forEach((_, i) => expect(result.stderr).toContain(`variant-${i}.test.ts:1`));
    expect(result.stderr.split('\n').filter(line => line.startsWith('- '))).toHaveLength(
      declarations.length
    );
  });

  it('accepts comments, fixture text, and unrelated methods without false positives', () => {
    const root = fixture({
      'src/tests/text.test.ts': `
        import { it } from 'vitest';
        // it.only('case', () => {});
        /* describe.skip('case', () => {}); */
        const example = "test.only.each([1])('case', () => {})";
        const unrelated = { only() {}, skip() {} };
        unrelated.only(); unrelated.skip();
        ({ it: unrelated }).it.only();
        it('describes it.only(', () => {});
      `,
    });
    const result = run(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[test-governance] OK');
    expect(result.stderr).toBe('');
  });

  it('keeps the existing Firestore skip exception narrow and the line limit intact', () => {
    const root = fixture({
      'src/tests/security/firestore-rules.test.ts': "it.skip.each([1])('case', () => {});",
      'src/tests/oversized.test.ts': '// fixture\n'.repeat(500),
    });
    const first = run(root);
    expect(first.status).toBe(1);
    expect(first.stderr).toContain('[megatest] 501 lines (limit 500)');
    expect(first.stderr).not.toContain('[skip]');
    fs.writeFileSync(path.join(root, 'src/tests/oversized.test.ts'), '// fixture\n'.repeat(499));
    fs.appendFileSync(
      path.join(root, 'src/tests/security/firestore-rules.test.ts'),
      "\nit.only('case', () => {});"
    );
    const second = run(root);
    expect(second.status).toBe(1);
    expect(second.stderr).toContain('firestore-rules.test.ts:2 [only]');
    expect(second.stderr).not.toContain('[megatest]');
  });

  it('reports executable modifiers consistently without counting fixture text', () => {
    const configs = [
      'release-confidence-matrix',
      'release-confidence-pack',
      'critical-smoke-pack',
      'flow-performance-budgets',
      'critical-coverage-thresholds',
      'technical-ownership-map',
    ];
    const root = fixture({
      'package.json': JSON.stringify({ scripts: {} }),
      ...Object.fromEntries(configs.map(name => [`scripts/config/${name}.json`, '{}'])),
      'src/tests/report.test.ts': `
        const example = "it.only('fixture')";
        // test.skip('fixture');
        it.only.each([1])('case', () => {});
        test.concurrent.skip('case', () => {});
      `,
    });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/report-quality-metrics.mjs')],
      {
        cwd: root,
        encoding: 'utf8',
      }
    );
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(
      fs.readFileSync(path.join(root, 'reports/quality-metrics.json'), 'utf8')
    );
    expect(report.tests.onlyMarkers).toBe(1);
    expect(report.tests.skippedMarkers).toBe(1);
  });

  it('retains the existing behavior when a workspace has no test tree', () => {
    const result = run(fixture({}));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('src/tests not found, skipping check');
  });
});
