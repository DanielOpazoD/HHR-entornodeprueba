import { expect, it, vi } from 'vitest';
import { filterCensusRowsByAttention } from '@/features/census/controllers/rowAcuityController';
import * as scores from '@/features/census/controllers/evaluationScoresCellController';
import { DataFactory } from '@/tests/factories/DataFactory';
import { BedType } from '@/types/domain/beds';
import type { UnifiedBedRow } from '@/features/census/types/censusTableTypes';

it('filters isolation without evaluating nursing scores for every occupied row', () => {
  const rows: UnifiedBedRow[] = Array.from({ length: 30 }, (_, index) => ({
    kind: 'occupied',
    id: `R${index}`,
    isSubRow: false,
    bed: { id: `R${index}`, name: `R${index}`, type: BedType.MEDIA, isCuna: false },
    data: DataFactory.createMockPatient(`R${index}`, {
      patientName: 'SINTETICO',
      isIsolated: index % 3 === 0,
    }),
  }));
  const model = vi.spyOn(scores, 'buildScoresCellModel');
  try {
    expect(filterCensusRowsByAttention(rows, '2026-11-06', 'isolation').map(row => row.id)).toEqual(
      rows.filter((_, index) => index % 3 === 0).map(row => row.id)
    );
    expect(model).not.toHaveBeenCalled();
    filterCensusRowsByAttention(rows, '2026-11-06', 'scale');
    expect(model).toHaveBeenCalledTimes(30);
  } finally {
    model.mockRestore();
  }
});
