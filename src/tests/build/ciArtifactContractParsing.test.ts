// @vitest-environment node
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

import { collectCiArtifactContractIssues } from '../../../scripts/ciArtifactContractSupport.mjs';

const workflow = fs.readFileSync('.github/workflows/ci-cd.yml', 'utf8');

/** The same workflow GitHub would run, written differently: 4-space indent, quoted scalars. */
const reformat = (text: string) =>
  parseDocument(text).toString({ indent: 4, defaultStringType: 'QUOTE_DOUBLE' });

/** Block `needs:` lists rewritten as flow lists, `needs: [a, b]`. */
const withFlowNeeds = (text: string) =>
  text.replace(
    /^( +)needs:\n((?:\1 +- .+\n)+)/gm,
    (_match, indent: string, items: string) =>
      `${indent}needs: [${items
        .trim()
        .split('\n')
        .map(item => item.replace(/^\s*-\s*/, ''))
        .join(', ')}]\n`
  );

describe('CI artifact contract parsing', () => {
  it('judges the workflow GitHub runs, not how its YAML is formatted', () => {
    expect(collectCiArtifactContractIssues(workflow)).toEqual([]);
    expect(collectCiArtifactContractIssues(reformat(workflow))).toEqual([]);
    expect(collectCiArtifactContractIssues(withFlowNeeds(reformat(workflow)))).toEqual([]);
  });

  it('still finds a real break after reformatting', () => {
    const document = parseDocument(workflow);
    const steps = document.getIn(['jobs', 'postmerge-evidence', 'steps']) as {
      items: { get: (key: string) => unknown }[];
    };
    const verifyIndex = steps.items.findIndex(step =>
      String(step.get('run') ?? '').includes('--artifact preview-bootstrap-artifacts')
    );
    expect(verifyIndex).toBeGreaterThan(-1);
    document.deleteIn(['jobs', 'postmerge-evidence', 'steps', verifyIndex]);

    expect(collectCiArtifactContractIssues(reformat(String(document)))).toContain(
      'postmerge-evidence: must verify "preview-bootstrap-artifacts" from producer "preview-smoke".'
    );
  });
});
