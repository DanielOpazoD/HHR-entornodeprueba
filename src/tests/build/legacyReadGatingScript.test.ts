import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findUngatedLegacyReads,
  importsLegacyReadBridge,
  referencesLegacyGate,
} from '../../../scripts/check-legacy-read-gating.mjs';

const IMPORT_LINE =
  "import { getLegacyTensCatalog } from '@/services/storage/migration/legacyCatalogReadBridge';";

describe('check-legacy-read-gating', () => {
  describe('importsLegacyReadBridge', () => {
    it('detects a static import of a legacy read bridge', () => {
      expect(importsLegacyReadBridge(IMPORT_LINE)).toBe(true);
    });

    it('detects a dynamic import of a legacy read bridge', () => {
      expect(
        importsLegacyReadBridge(
          "const m = await import('@/services/storage/migration/legacyRecordReadBridge');"
        )
      ).toBe(true);
    });

    it('ignores unrelated imports', () => {
      expect(importsLegacyReadBridge("import { foo } from '@/services/storage/firestore';")).toBe(
        false
      );
    });
  });

  describe('referencesLegacyGate', () => {
    it('is true when the gate symbol appears', () => {
      expect(referencesLegacyGate('if (isLegacyBridgeEnabled()) read();')).toBe(true);
    });

    it('is false otherwise', () => {
      expect(referencesLegacyGate('read();')).toBe(false);
    });
  });

  describe('findUngatedLegacyReads', () => {
    it('flags a consumer that imports a read bridge without the gate', () => {
      expect(
        findUngatedLegacyReads({ files: ['src/services/x.ts'], readFile: () => IMPORT_LINE })
      ).toEqual(['src/services/x.ts']);
    });

    it('passes a consumer that also references the gate', () => {
      expect(
        findUngatedLegacyReads({
          files: ['src/services/x.ts'],
          readFile: () =>
            `${IMPORT_LINE}\nimport { isLegacyBridgeEnabled } from '@/services/repositories/legacyCompatibilityPolicy';`,
        })
      ).toEqual([]);
    });

    it('skips allowlisted files (the bridge internals and tests)', () => {
      expect(
        findUngatedLegacyReads({
          files: [
            'src/services/storage/migration/legacyCatalogReadBridge.ts',
            'src/tests/foo.test.ts',
          ],
          readFile: () => IMPORT_LINE,
        })
      ).toEqual([]);
    });
  });

  it('the real legacy read-bridge consumers are gated (no drift)', () => {
    // Integration: the actual production importers must pass — and must really import a
    // bridge, so the assertion above is not vacuous.
    const realConsumers = [
      'src/services/repositories/CatalogRepository.ts',
      'src/services/repositories/legacyRecordBridgeService.ts',
    ];
    const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

    expect(findUngatedLegacyReads({ files: realConsumers, readFile: read })).toEqual([]);
    for (const rel of realConsumers) {
      expect(importsLegacyReadBridge(read(rel))).toBe(true);
    }
  });
});
