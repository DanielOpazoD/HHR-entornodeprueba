import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  compareRulesTarget,
  firstDifferentLine,
  rulesTargets,
} from '../../../scripts/check-deployed-rules.mjs';

const firestore = rulesTargets('hhr-pruebas')[0];
const ruleset = (content: string) => ({
  createTime: '2026-11-01T07:18:41Z',
  source: { files: [{ name: 'firestore.rules', content }] },
});

describe('published rules compared with main', () => {
  it('checks both rule files that main generates', () => {
    expect(rulesTargets('hhr-pruebas')).toEqual([
      { label: 'Firestore', release: 'cloud.firestore', file: 'firestore.rules' },
      {
        label: 'Storage',
        release: 'firebase.storage/hhr-pruebas.firebasestorage.app',
        file: 'storage.rules',
      },
    ]);
    for (const target of rulesTargets('hhr-pruebas')) {
      expect(fs.existsSync(target.file)).toBe(true);
    }
  });

  it('passes when the published ruleset is the generated file', () => {
    const local = fs.readFileSync('firestore.rules', 'utf8');
    expect(compareRulesTarget(firestore, ruleset(local), local)).toEqual({
      ok: true,
      message: 'Firestore: lo publicado el 2026-11-01T07:18:41Z coincide con firestore.rules.',
    });
  });

  it('fails and names the first different line when main moved ahead', () => {
    const result = compareRulesTarget(firestore, ruleset('a\nb\nc\n'), 'a\nb\nchanged\n');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('difiere de firestore.rules desde la línea 3');
  });

  it('fails on a missing trailing line or an unexpected published shape', () => {
    expect(firstDifferentLine('a\nb', 'a\nb\n')).toBe(3);
    expect(compareRulesTarget(firestore, { source: { files: [] } }, 'a').ok).toBe(false);
    expect(compareRulesTarget(firestore, undefined, 'a').ok).toBe(false);
  });
});
