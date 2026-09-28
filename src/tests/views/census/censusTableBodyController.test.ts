// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildResolvedOccupiedRows,
  resolvePatientRowMenuAlign,
} from '@/features/census/controllers/censusTableBodyController';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { UnifiedBedRow } from '@/features/census/types/censusTableTypes';
import { BedType } from '@/types/domain/beds';

describe('censusTableBodyController', () => {
  it('builds resolved occupied rows with menu alignment and indicators', () => {
    const unifiedRows: UnifiedBedRow[] = [
      {
        kind: 'occupied',
        id: 'row-1',
        bed: { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false },
        data: DataFactory.createMockPatient('R1', {
          admissionDate: '2026-03-05',
          admissionTime: '14:20',
        }),
        isSubRow: false,
      },
      {
        kind: 'occupied',
        id: 'row-2',
        bed: { id: 'R2', name: 'R2', type: BedType.MEDIA, isCuna: false },
        data: DataFactory.createMockPatient('R2'),
        isSubRow: true,
      },
    ];

    const result = buildResolvedOccupiedRows({
      unifiedRows,
      currentDateString: '2026-03-05',
      clinicalDocumentPresenceByBedId: { R1: true, R2: true },
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      actionMenuAlign: 'bottom',
      indicators: {
        hasClinicalDocument: true,
        isNewAdmission: true,
      },
    });
    expect(result[1]).toMatchObject({
      indicators: {
        hasClinicalDocument: false,
        isNewAdmission: false,
      },
    });
  });

  it('keeps utility functions stable', () => {
    expect(resolvePatientRowMenuAlign(0, 6)).toBe('top');
    expect(resolvePatientRowMenuAlign(3, 6)).toBe('bottom');
  });
});
