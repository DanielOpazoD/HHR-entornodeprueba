import { describe, expect, it } from 'vitest';
import { cudyrLinkCandidates, validateCudyrLinkDraft } from '@/services/cudyr/cudyrLinkReview';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import type { CudyrComparisonItem } from '@/types/domain/cudyrReconciliation';
import { reportInput } from './reportFixtures';
const item: CudyrComparisonItem = {
  key: 'category:5:2',
  source: 'Eloísa',
  sourceRow: 5,
  sourceDate: '2026-10-02',
  sourceValue: 'C2',
  patientName: 'Paciente Sintético',
  document: 'synthetic-rut',
  status: 'identity_review',
  reason: '',
  candidateKeys: [],
};
const row = buildCudyrReport(reportInput()).rows[0];
const link = {
  action: 'link' as const,
  episodeId: row.clinicalEpisodeId,
  reason: 'Identidad y episodio cotejados con la fuente.',
};
describe('session-only reviewed episode links', () => {
  it('offers re-admissions and shared RN documents separately, preserving daily context', () => {
    const rows = [
      row,
      {
        ...row,
        key: 'crib',
        date: '2026-10-01',
        modality: 'cuna' as const,
        eligibility: 'no_elegible' as const,
      },
      { ...row, key: 'rn', clinicalEpisodeId: 'rn', patientName: 'RN Sintético' },
      { ...row, key: 'return', clinicalEpisodeId: 'readmission', date: '2026-10-04' },
    ];
    const before = JSON.stringify(rows);
    const choices = cudyrLinkCandidates(item, rows);
    expect(choices).toHaveLength(3);
    expect(
      choices.find(c => c.episodeId === row.clinicalEpisodeId)?.rows.map(r => r.modality)
    ).toEqual(['cuna', 'hospitalizacion']);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('does not offer an episode with conflicting identities or no ID', () => {
    expect(cudyrLinkCandidates(item, [row, { ...row, patientName: 'Otra persona' }])).toEqual([]);
    expect(cudyrLinkCandidates(item, [{ ...row, clinicalEpisodeId: '' }])).toEqual([]);
    expect(cudyrLinkCandidates({ ...item, document: '' }, [row])).toEqual([]);
  });
  it('requires explicit evidence and acknowledgement even for an automatic match', () => {
    expect(validateCudyrLinkDraft({ ...item, status: 'compatible' }, [row], link, false)).toContain(
      'Confirme'
    );
    expect(validateCudyrLinkDraft(item, [row], { ...link, reason: 'RUT' }, true)).toContain(
      '10 a 1000'
    );
    expect(validateCudyrLinkDraft(item, [row], link, true)).toBe('');
  });
  it('rejects a stale episode and prevents reviewing HHR-only evidence as a source link', () => {
    expect(validateCudyrLinkDraft(item, [], link, true)).toContain('disponible');
    expect(validateCudyrLinkDraft({ ...item, key: 'hhr:row' }, [row], link, true)).toContain(
      'Solo'
    );
  });
  it('allows reasoned pending or exclusion without inventing an episode', () => {
    for (const action of ['pending', 'exclude'] as const)
      expect(
        validateCudyrLinkDraft(
          item,
          [],
          { action, episodeId: '', reason: 'Falta respaldo de identidad de esta fila.' },
          false
        )
      ).toBe('');
  });
});
