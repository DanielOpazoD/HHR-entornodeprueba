import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readReleaseGateScript = () =>
  fs.readFileSync(path.join(process.cwd(), 'scripts/run-firestore-release-gate-ci.sh'), 'utf8');

describe('firestore release gate script', () => {
  it('refreshes the flow performance summary from the production-preview metric', () => {
    const script = readReleaseGateScript().replace(/\s+/g, ' ');

    expect(script).toContain(
      'npm run test:e2e:critical && node scripts/check-playwright-report-clean.mjs'
    );
    expect(script).toContain(
      '&& npm run test:e2e:flow-performance:built && npm run check:flow-performance-budget'
    );
  });
});
