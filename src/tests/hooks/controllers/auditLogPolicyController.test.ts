// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildDebouncedAuditKey,
  buildMeaningfulAuditDetails,
  mergeDebouncedAuditDetails,
} from '@/hooks/controllers/auditLogPolicyController';

describe('auditLogPolicyController', () => {
  it('builds a deterministic debounce key', () => {
    expect(buildDebouncedAuditKey('PATIENT_MODIFIED', 'R1')).toBe('PATIENT_MODIFIED-R1');
  });

  it('returns null when details are not meaningful', () => {
    expect(buildMeaningfulAuditDetails({ changes: {} })).toBeNull();
  });

  it('merges change chains preserving the first old value and last new value', () => {
    const result = mergeDebouncedAuditDetails(
      {
        changes: {
          status: { old: 'ESTABLE', new: 'GRAVE' },
        },
      },
      {
        changes: {
          status: { old: 'GRAVE', new: 'DE CUIDADO' },
        },
      }
    );

    expect(result).toEqual({
      changes: {
        status: { old: 'ESTABLE', new: 'DE CUIDADO' },
      },
    });
  });
});
