// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const GUARD = path.resolve('scripts/check-module-size.mjs');
const LISTED = 'functions/lib/big.js';
const roots: string[] = [];

const linesOf = (count: number) =>
  Array.from({ length: count }, (_, index) => `// ${index}`).join('\n');

/** Runs the guard on a synthetic repository with both source roots, `files` and `allowlist`. */
const runGuard = (
  files: Record<string, string>,
  allowlist: Record<string, number> = {},
  { withFunctions = true } = {}
) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hhr-module-size-'));
  roots.push(root);
  const backlog = Object.fromEntries(
    Object.keys(allowlist).map(file => [
      file,
      { reason: 'synthetic', owner: 'functions', status: 'active' },
    ])
  );
  const all: Record<string, string> = {
    'src/app.ts': linesOf(10),
    ...(withFunctions ? { 'functions/lib/small.js': linesOf(10) } : {}),
    'scripts/module-size-allowlist.json': JSON.stringify({ globalMax: 600, allowlist, backlog }),
    ...files,
  };
  for (const [relativePath, content] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    writeFileSync(path.join(root, relativePath), content);
  }
  const result = spawnSync(process.execPath, [GUARD], { cwd: root, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('check-module-size', () => {
  it('fails a Functions module over the cap and names the split, ignoring test files', () => {
    const { status, output } = runGuard({
      [LISTED]: linesOf(601),
      'functions/lib/big.test.js': linesOf(900),
    });

    expect(status).toBe(1);
    expect(output).toContain('[new overflow] functions/lib/big.js: 601 lines (limit 600)');
    expect(output).toContain('split it by responsibility');
    expect(output).not.toContain('big.test.js');
  });

  it('passes a listed Functions module at its ceiling and fails it one line over', () => {
    expect(runGuard({ [LISTED]: linesOf(700) }, { [LISTED]: 700 }).status).toBe(0);

    const { status, output } = runGuard({ [LISTED]: linesOf(701) }, { [LISTED]: 700 });

    expect(status).toBe(1);
    expect(output).toContain('[allowlist exceeded] functions/lib/big.js: 701 lines (limit 700)');
    expect(output).toContain('does not rise');
  });

  it('makes a listed module that shrank lower its ceiling to the new size', () => {
    const { status, output } = runGuard({ [LISTED]: linesOf(650) }, { [LISTED]: 700 });

    expect(status).toBe(1);
    expect(output).toContain('functions/lib/big.js: set its limit from 700 to 650');
  });

  it('treats a missing source root as unmeasured, not compliant', () => {
    const { status, output } = runGuard({}, {}, { withFunctions: false });

    expect(status).toBe(1);
    expect(output).toContain('cannot measure missing source roots: functions/lib');
  });
});
