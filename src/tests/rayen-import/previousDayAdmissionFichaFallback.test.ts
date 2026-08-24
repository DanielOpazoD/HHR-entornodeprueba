import { describe, expect, it, vi } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import { verifyPreviousDayAdmissionPlacements } from '@/features/rayen-import/domain/previousDayCorrections';
import { motherAndNewbornDiff } from './previousDayAdmissionCorrections.fixtures';

describe('previous-day admission Ficha fallback', () => {
  it('uses the Ficha admission location when the matching flow report has no movement rows', async () => {
    const admission = motherAndNewbornDiff.admissions[0];
    const source = {
      ...admission.source!,
      room: 'Habitación 5',
      bed: 'C2',
      admissionDatetime: '2026-07-26T03:27:00-06:00',
      verifiedBedPlacement: undefined,
    };
    const diff: CensusImportDiff = {
      ...motherAndNewbornDiff,
      admissions: [
        {
          ...admission,
          bedId: 'H5C2',
          patient: { ...admission.patient, bedId: 'H5C2', clinicalCrib: undefined },
          source,
        },
      ],
    };

    const verified = await verifyPreviousDayAdmissionPlacements(diff, '2026-07-26', {
      fetchReport: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
      extractText: vi.fn().mockResolvedValue(`RUN: ${source.run}`),
    });

    expect(verified.conflicts).toEqual([]);
    expect(verified.admissions[0].source?.verifiedBedPlacement).toEqual({
      source: 'ficha-admission-location',
      bedId: 'H5C2',
      changedAt: '2026-07-26T03:27:00',
    });
  });

  it('keeps the current-day admission without a conflict when only a later placement exists', async () => {
    const unverifiedDiff: CensusImportDiff = {
      ...motherAndNewbornDiff,
      conflicts: [
        {
          bedId: 'H4C1',
          code: 'historical-admission-evidence',
          reason: 'conflicto histórico anterior',
        },
      ],
      admissions: motherAndNewbornDiff.admissions.map(admission => ({
        ...admission,
        source: admission.source
          ? { ...admission.source, verifiedBedPlacement: undefined }
          : undefined,
      })),
    };

    const verified = await verifyPreviousDayAdmissionPlacements(unverifiedDiff, '2026-07-26', {
      fetchReport: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
      extractText: vi
        .fn()
        .mockResolvedValue(['RUN: 17.059.646-3', '26/07/2026 10:00:00 Habitación 4 C2'].join('\n')),
    });

    expect(verified.admissions[0].source?.verifiedBedPlacement).toBeUndefined();
    expect(verified.admissions[0].patient.admissionDate).toBe('2026-07-26');
    expect(verified.conflicts).toEqual([]);
  });

  it('keeps the current-day admission without a conflict when the pre-cutoff placement is outside HHR', async () => {
    const unverifiedDiff: CensusImportDiff = {
      ...motherAndNewbornDiff,
      admissions: motherAndNewbornDiff.admissions.map(admission => ({
        ...admission,
        source: admission.source
          ? { ...admission.source, verifiedBedPlacement: undefined }
          : undefined,
      })),
    };

    const verified = await verifyPreviousDayAdmissionPlacements(unverifiedDiff, '2026-07-26', {
      fetchReport: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
      extractText: vi
        .fn()
        .mockResolvedValue(
          [
            'RUN: 17.059.646-3',
            '26/07/2026 03:30:00 Servicio de Urgencia Box 4',
            '26/07/2026 10:00:00 Habitación 4 C2',
          ].join('\n')
        ),
    });

    expect(verified.admissions[0].source?.verifiedBedPlacement).toBeUndefined();
    expect(verified.admissions[0].patient.admissionDate).toBe('2026-07-26');
    expect(verified.admissions[0].patient.admissionTime).toBe(
      unverifiedDiff.admissions[0].patient.admissionTime
    );
    expect(verified.conflicts).toEqual([]);
  });

  it('keeps a conflict when the movement timeline is malformed', async () => {
    const admission = motherAndNewbornDiff.admissions[0];
    const verified = await verifyPreviousDayAdmissionPlacements(
      {
        ...motherAndNewbornDiff,
        admissions: [
          {
            ...admission,
            source: admission.source
              ? { ...admission.source, verifiedBedPlacement: undefined }
              : undefined,
          },
        ],
      },
      '2026-07-26',
      {
        fetchReport: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
        extractText: vi
          .fn()
          .mockResolvedValue(
            ['RUN: 17.059.646-3', '31/02/2026 03:30:00 Habitación 4 C2'].join('\n')
          ),
      }
    );

    expect(verified.admissions[0].source?.verifiedBedPlacement).toBeUndefined();
    expect(verified.conflicts).toEqual([
      expect.objectContaining({ code: 'historical-admission-evidence' }),
    ]);
  });
});
