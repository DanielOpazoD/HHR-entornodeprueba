import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readDoc = (relativePath: string): string =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('bundle risk ledger', () => {
  it('documents owners, thresholds and release posture for current bundle warning surfaces', () => {
    const ledger = readDoc('docs/BUNDLE_RISK_LEDGER.md');

    for (const surface of [
      'vendor-heic2any',
      'vendor-pdfjs',
      'vendor-pdf-lib',
      'app-authenticated-shell',
    ]) {
      expect(ledger).toContain(surface);
    }

    expect(ledger).toContain('Owner');
    expect(ledger).toContain('Threshold');
    expect(ledger).toContain('Release posture');
    expect(ledger).toContain('Current signal');
    expect(ledger).toContain('Not a release blocker');
  });

  it('records the next recommended PR without expanding this release branch scope', () => {
    const ledger = readDoc('docs/BUNDLE_RISK_LEDGER.md');

    expect(ledger).toContain('Next recommended PR');
    expect(ledger).toContain('app-authenticated-shell');
    expect(ledger).toContain('PDF generation/viewer');
  });
});
