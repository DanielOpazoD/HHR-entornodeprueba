// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  compareWithBaseline,
  countUncheckedIndexErrors,
} from '../../../scripts/check-unchecked-index-ratchet.mjs';

const output = [
  "src/services/cudyr/a.ts(3,7): error TS2532: Object is possibly 'undefined'.",
  "src/services/cudyr/b.ts(9,1): error TS18048: 'x' is possibly 'undefined'.",
  "src/utils/rutUtils.ts(1,2): error TS2532: Object is possibly 'undefined'.",
  "src/tests/views/x.test.tsx(1,1): error TS2532: Object is possibly 'undefined'.",
  '  Type continuation line without a path.',
].join('\n');

describe('unchecked indexed access ratchet', () => {
  it('counts production errors per src/<layer>/<module> area and ignores tests', () => {
    expect(countUncheckedIndexErrors(output)).toEqual({
      'src/services/cudyr': 2,
      'src/utils/rutUtils': 1,
    });
  });

  it('fails on growth and asks to lower a count that went down', () => {
    expect(
      compareWithBaseline(
        { 'src/services/cudyr': 3, 'src/utils/rutUtils': 0 },
        { 'src/services/cudyr': 2, 'src/utils/rutUtils': 1 }
      )
    ).toEqual({
      grown: [{ area: 'src/services/cudyr', before: 2, now: 3 }],
      shrunk: [{ area: 'src/utils/rutUtils', before: 1, now: 0 }],
    });
    expect(compareWithBaseline({ 'src/a/b': 1 }, { 'src/a/b': 1 })).toEqual({
      grown: [],
      shrunk: [],
    });
  });
});
