// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectRulesSourceGovernanceIssues } from '../../../scripts/rulesSourceGovernanceSupport.mjs';

const tempRoots: string[] = [];

const writeText = (root: string, relativePath: string, value: string) => {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
};

const createRulesRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-source-governance-'));
  tempRoots.push(root);

  writeText(
    root,
    'rules/firestore/00-auth-and-role-helpers.rules',
    ['line 1', 'line 2'].join('\n')
  );
  writeText(root, 'rules/firestore/40-hospitals.rules', ['line 1', 'line 2', 'line 3'].join('\n'));

  return root;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('rules source governance', () => {
  it('accepts Firestore rule fragments under the configured size limit', () => {
    const root = createRulesRoot();

    expect(
      collectRulesSourceGovernanceIssues(root, {
        firestoreSources: [
          'rules/firestore/00-auth-and-role-helpers.rules',
          'rules/firestore/40-hospitals.rules',
        ],
        maxFirestoreFragmentLines: 3,
      })
    ).toEqual([]);
  });

  it('reports Firestore rule fragments that exceed the configured size limit', () => {
    const root = createRulesRoot();

    expect(
      collectRulesSourceGovernanceIssues(root, {
        firestoreSources: [
          'rules/firestore/00-auth-and-role-helpers.rules',
          'rules/firestore/40-hospitals.rules',
        ],
        maxFirestoreFragmentLines: 2,
      })
    ).toEqual([
      'rules/firestore/40-hospitals.rules has 3 lines; split or simplify before exceeding 2 lines.',
    ]);
  });

  it('runs from the security check so rules debt cannot grow outside release gates', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts['check:security']).toContain(
      'node scripts/check-rules-source-governance.mjs'
    );
    expect(packageJson.scripts['check:security']).toContain(
      'npm run check:firestore-rules-governance'
    );
  });
});
