import { describe, expect, it } from 'vitest';
import { summarizeBackupImportOutcome } from '@/hooks/controllers/backupImportFeedbackController';

describe('backupImportFeedbackController', () => {
  it('summarizes repaired and partial imports', () => {
    expect(
      summarizeBackupImportOutcome({
        success: 2,
        failed: 0,
        repaired: 1,
        outcome: 'repaired',
      })
    ).toContain('1 requirieron reparación automática');

    expect(
      summarizeBackupImportOutcome({
        success: 2,
        failed: 1,
        repaired: 1,
        outcome: 'partial',
      })
    ).toContain('1 fallaron');
  });

  it('names the restored days whose per-episode clinical data did not come back', () => {
    const summary = summarizeBackupImportOutcome({
      success: 2,
      failed: 0,
      repaired: 0,
      outcome: 'partial',
      clinicalDerivedIncompleteDates: ['2026-11-02'],
    });

    expect(summary).toContain('No se restauraron los datos clínicos por episodio');
    expect(summary).toContain('1 día (2026-11-02)');
  });
});
