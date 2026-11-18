// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { canRunCensusEmailAction } from '@/features/census/email/controllers/censusEmailActionController';

describe('censusEmailActionController', () => {
  it('blocks actions while loading or after success', () => {
    expect(canRunCensusEmailAction('idle')).toBe(true);
    expect(canRunCensusEmailAction('error')).toBe(true);
    expect(canRunCensusEmailAction('loading')).toBe(false);
    expect(canRunCensusEmailAction('success')).toBe(false);
  });
});
