import { describe, expect, it } from 'vitest';
import {
  buildPatientSelectionDocumentLookupKeys,
  parsePatientSelectionEpisodeLookupKey,
  summarizeClinicalDocuments,
} from '@/features/census/components/global-search/patientSelectionDocumentController';

describe('patientSelectionDocumentController', () => {
  it('parses composite episode keys with optional admission time', () => {
    expect(parsePatientSelectionEpisodeLookupKey('13.545.665-9__2026-04-15__08:30')).toEqual({
      rut: '13.545.665-9',
      admissionDate: '2026-04-15',
      admissionTime: '08:30',
    });
    expect(parsePatientSelectionEpisodeLookupKey('__2026-04-15')).toBeNull();
  });

  it('builds de-duplicated document episode candidates around the admission date', () => {
    expect(
      buildPatientSelectionDocumentLookupKeys({
        rut: '13.545.665-9',
        admissionDate: '2026-04-15',
      })
    ).toEqual([
      '13.545.665-9__2026-04-15',
      '13545665-9__2026-04-15',
      '13.545.665-9__2026-04-16',
      '13545665-9__2026-04-16',
      '13.545.665-9__2026-04-14',
      '13545665-9__2026-04-14',
    ]);
  });

  it('summarizes clinical document records for the global patient search', () => {
    const documents = [
      {
        id: 'doc-1',
        episodeKey: '',
        documentType: 'epicrisis',
        status: 'draft',
        audit: {
          createdAt: '2026-04-22T10:00:00.000Z',
          updatedAt: '2026-04-22T10:30:00.000Z',
          createdBy: { displayName: 'Dra. Hiva' },
        },
      },
    ];

    expect(summarizeClinicalDocuments(documents, 'fallback-key')).toEqual([
      {
        id: 'doc-1',
        episodeKey: 'fallback-key',
        documentType: 'epicrisis',
        status: 'draft',
        createdAt: '2026-04-22T10:00:00.000Z',
        createdBy: 'Dra. Hiva',
        updatedAt: '2026-04-22T10:30:00.000Z',
      },
    ]);
  });
});
