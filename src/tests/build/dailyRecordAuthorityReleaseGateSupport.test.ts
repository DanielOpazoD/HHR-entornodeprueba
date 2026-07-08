import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateDailyRecordAuthorityReleaseGate } from '../../../scripts/dailyRecordAuthorityReleaseGateSupport.mjs';

describe('daily record authority release gate support', () => {
  it('accepts enforced authority mode as a release-safe revision guard', () => {
    expect(
      evaluateDailyRecordAuthorityReleaseGate({
        VITE_DAILY_RECORD_AUTHORITY_MODE: 'enforced',
      })
    ).toEqual({
      ok: true,
      mode: 'enforced',
      message: 'Daily record authority callable is enforced for release writes.',
    });
  });

  it('accepts the legacy callable flag as enforced compatibility', () => {
    expect(
      evaluateDailyRecordAuthorityReleaseGate({
        VITE_DAILY_RECORD_AUTHORITY_CALLABLE: 'true',
      }).ok
    ).toBe(true);
  });

  it('blocks release when writes would stay in degraded client-only mode', () => {
    expect(
      evaluateDailyRecordAuthorityReleaseGate({
        VITE_DAILY_RECORD_AUTHORITY_MODE: 'client_only',
      })
    ).toMatchObject({
      ok: false,
      mode: 'client_only',
    });
  });

  it('blocks release when no authority mode is configured', () => {
    expect(evaluateDailyRecordAuthorityReleaseGate({})).toMatchObject({
      ok: false,
      mode: 'client_only',
    });
  });

  it('documents the release-safe authority mode in the environment template', () => {
    const envExample = fs.readFileSync(path.join(process.cwd(), '.env.example'), 'utf8');

    expect(envExample).toContain('VITE_DAILY_RECORD_AUTHORITY_MODE=client_only');
    expect(envExample).toContain('Release must use VITE_DAILY_RECORD_AUTHORITY_MODE=enforced');
  });
});
