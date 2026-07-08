import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const readPlan = (): string =>
  fs.readFileSync(path.resolve(process.cwd(), 'docs/LEGACY_RETIREMENT_PLAN.md'), 'utf8');

describe('legacy retirement plan', () => {
  it('documents the short legacy retirement priorities and closure signals', () => {
    const plan = readPlan();

    expect(plan).toContain('legacy read bridge');
    expect(plan).toContain('role aliases');
    expect(plan).toContain('legacy clinical document');
    expect(plan).toContain('legacy episode');
    expect(plan).toContain('Closure signals');
    expect(plan).toContain('Non-goals');
    expect(plan).toContain('0 new legacy read bridge consumers');
    expect(plan).toContain('0 legacy role aliases detected for 2 consecutive releases');
    expect(plan).toContain('0 legacy hydration leaks outside approved controllers');
  });
});
