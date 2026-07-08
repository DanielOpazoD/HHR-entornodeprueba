import { describe, expect, it } from 'vitest';
import { buildInvariantRepairReviewContext } from '@/services/repositories/invariantRepairReviewContext';

describe('invariantRepairReviewContext', () => {
  it('marks broad clinical invariant repairs as high risk and reviewable', () => {
    const repairPaths = Array.from({ length: 11 }, (_, index) => `beds.R${index + 1}`);

    const context = buildInvariantRepairReviewContext({
      date: '2026-04-19',
      operation: 'updatePartial',
      repairPaths,
      touchedPaths: ['beds.R1.patientName'],
    });

    expect(context).toMatchObject({
      date: '2026-04-19',
      operation: 'updatePartial',
      patches: repairPaths,
      repairPaths,
      touchedPaths: ['beds.R1.patientName'],
      impactedContexts: ['clinical'],
      assessment: {
        riskLevel: 'high',
        reviewRecommended: true,
        reviewReasons: [
          'clinical_invariant_repair',
          'clinical_patch_with_structural_repair',
          'broad_invariant_repair',
        ],
        runbookActions: ['Validar que el merge preserve camas y pacientes antes de reintentar.'],
      },
    });
  });

  it('keeps metadata-only repairs low risk without review pressure', () => {
    const context = buildInvariantRepairReviewContext({
      date: '2026-04-19',
      operation: 'save',
      repairPaths: ['schemaVersion'],
      touchedPaths: ['*'],
    });

    expect(context.assessment).toMatchObject({
      riskLevel: 'low',
      reviewRecommended: false,
      reviewReasons: [],
    });
    expect(context.impactedContexts).toEqual(['metadata']);
  });
});
