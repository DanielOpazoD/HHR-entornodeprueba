import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildCompatibilityImportGovernanceReport } from '../../../scripts/lib/compatibilityImportGovernance.mjs';

const tempRoots: string[] = [];

const writeFile = (root: string, relativePath: string, content: string): void => {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
};

describe('compatibilityImportGovernance', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('detects multiline imports and exports for governed legacy modules', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compatibility-import-governance-'));
    tempRoots.push(root);

    writeFile(
      root,
      'scripts/config/compatibility-governance.json',
      JSON.stringify({
        policyVersion: 'test',
        entries: [
          {
            path: 'src/services/legacyModule.ts',
            owner: 'test',
            kind: 'legacy',
            importPolicy: 'restricted',
            allowedImporters: [],
          },
        ],
      })
    );
    writeFile(root, 'src/services/legacyModule.ts', 'export const legacy = true;\n');
    writeFile(
      root,
      'src/feature/directImporter.ts',
      ['import {', '  legacy,', "} from '@/services/legacyModule';", 'void legacy;', ''].join('\n')
    );
    writeFile(
      root,
      'src/feature/reExport.ts',
      ['export {', '  legacy,', "} from '@/services/legacyModule';", ''].join('\n')
    );

    const report = buildCompatibilityImportGovernanceReport(root);

    expect(report.entries[0].actualImporters).toEqual([
      'src/feature/directImporter.ts',
      'src/feature/reExport.ts',
    ]);
  });
});
