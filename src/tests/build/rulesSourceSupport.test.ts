import { describe, expect, it } from 'vitest';
import { normalizeGeneratedRuleFragment } from '../../../scripts/rulesSourceSupport.mjs';

describe('rulesSourceSupport', () => {
  it('strips generated-only blank lines and full-line comments without changing rule expressions', () => {
    expect(
      normalizeGeneratedRuleFragment(
        [
          "rules_version = '2';",
          '',
          '// review-only context',
          'service cloud.firestore {',
          '  allow read: if true; // inline comments remain attached to code',
          '}',
          '',
        ].join('\n'),
        { stripBlankLines: true, stripLineComments: true }
      )
    ).toBe(
      [
        "rules_version = '2';",
        'service cloud.firestore {',
        '  allow read: if true; // inline comments remain attached to code',
        '}',
        '',
      ].join('\n')
    );
  });

  it('collapses multiline string lists in generated rules while preserving other lists', () => {
    expect(
      normalizeGeneratedRuleFragment(
        [
          'return payload.keys().hasOnly([',
          "  'uid',",
          "  'email'",
          ']);',
          'return values.hasAny([',
          '  dynamicValue,',
          "  'fallback'",
          ']);',
        ].join('\n'),
        { collapseStringLists: true }
      )
    ).toBe(
      [
        "return payload.keys().hasOnly(['uid', 'email']);",
        'return values.hasAny([',
        '  dynamicValue,',
        "  'fallback'",
        ']);',
        '',
      ].join('\n')
    );
  });
});
