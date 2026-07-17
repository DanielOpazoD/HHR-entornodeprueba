import { describe, expect, it } from 'vitest';
import {
  buildImportedCudyr,
  CUDYR_IMPORT_SOURCE,
  importedCudyrBelongsToCensus,
  resolveCudyrOwningCensusDay,
} from '@/domain/evaluationScales/importedCudyr';

describe('buildImportedCudyr', () => {
  it('imports the composite category when categorized on the census day (Rapa Nui)', () => {
    // Carina's real data: crdValue D3, crdDateTime 2026-07-10T23:12:04Z → 17:12 Rapa Nui = 2026-07-10.
    const result = buildImportedCudyr(
      { crdValue: 'D3', crdDateTime: '2026-07-10T23:12:04.74+00:00' },
      '2026-07-10'
    );
    expect(result).toMatchObject({
      category: 'D3',
      recordedDate: '2026-07-10',
      recordedAt: '2026-07-10T23:12:04.74+00:00',
      source: 'Eloísa · Ficha Médico',
    });
  });

  it('resolves the day in Rapa Nui time, not UTC (just-after-midnight UTC belongs to the prior island day)', () => {
    // 2026-07-11T04:00Z == 2026-07-10 22:00 in Pacific/Easter (-06).
    const result = buildImportedCudyr(
      { crdValue: 'B2', crdDateTime: '2026-07-11T04:00:00+00:00' },
      '2026-07-10'
    );
    expect(result?.recordedDate).toBe('2026-07-10');
  });

  it('does not carry a daytime categorization over to the next census', () => {
    expect(
      buildImportedCudyr(
        { crdValue: 'D3', crdDateTime: '2026-07-10T23:12:04.74+00:00' },
        '2026-07-11'
      )
    ).toBeNull();
  });

  it('associates a CUDYR filled at 01:00 on 16-jul with the night shift and census of 15-jul', () => {
    const result = buildImportedCudyr(
      { crdValue: 'C2', crdDateTime: '2026-07-16T07:00:00+00:00' },
      '2026-07-15'
    );

    expect(result).toMatchObject({
      category: 'C2',
      recordedDate: '2026-07-15',
      recordedAt: '2026-07-16T07:00:00+00:00',
    });
  });

  it('keeps next-morning applications through 11:59 with the prior night shift', () => {
    expect(resolveCudyrOwningCensusDay('2026-07-17T06:00:59+00:00')).toBe('2026-07-17');
    expect(resolveCudyrOwningCensusDay('2026-07-17T06:01:00+00:00')).toBe('2026-07-16');
    expect(resolveCudyrOwningCensusDay('2026-07-17T17:59:59+00:00')).toBe('2026-07-16');
    expect(resolveCudyrOwningCensusDay('2026-07-17T18:00:00+00:00')).toBe('2026-07-17');
  });

  it('associates the real 16-jul 08:25 application with the 15-jul night shift', () => {
    expect(
      buildImportedCudyr(
        {
          crdValue: 'C1',
          crdDateTime: '2026-07-16T14:25:00+00:00',
          author: 'Nicole Palma',
          authorRole: 'Enfermería',
        },
        '2026-07-15'
      )
    ).toMatchObject({
      category: 'C1',
      recordedDate: '2026-07-15',
      recordedAt: '2026-07-16T14:25:00+00:00',
      author: 'Nicole Palma',
    });
  });

  it('uses recordedAt to reinterpret a legacy snapshot saved under the wrong census date', () => {
    const legacy = {
      category: 'C1',
      recordedDate: '2026-07-16',
      recordedAt: '2026-07-16T14:37:00+00:00',
      source: 'Eloísa',
    };

    expect(importedCudyrBelongsToCensus(legacy, '2026-07-15')).toBe(true);
    expect(importedCudyrBelongsToCensus(legacy, '2026-07-16')).toBe(false);
  });

  it('can synchronize the prior census later without using the synchronization clock', () => {
    const historical = {
      crdValue: 'B2',
      crdDateTime: '2026-07-18T07:30:00+00:00',
      source: 'gestion_camas' as const,
      history: [
        {
          category: 'C2',
          recordedAt: '2026-07-17T07:00:00+00:00',
          author: 'Constanza Guajardo',
          authorRole: 'Enfermería',
        },
      ],
    };

    expect(buildImportedCudyr(historical, '2026-07-16')).toMatchObject({
      category: 'C2',
      author: 'Constanza Guajardo',
      recordedDate: '2026-07-16',
    });
  });

  it('returns null when the categorization was made AFTER the census day (late sync of a past census)', () => {
    expect(
      buildImportedCudyr({ crdValue: 'D3', crdDateTime: '2026-07-11T18:00:00+00:00' }, '2026-07-10')
    ).toBeNull();
  });

  it('returns null for zero, "S/C" (sin categorizar), malformed values and blanks', () => {
    const day = '2026-07-10';
    const dt = '2026-07-10T18:00:00+00:00';
    expect(buildImportedCudyr({ crdValue: 'S/C', crdDateTime: dt }, day)).toBeNull();
    expect(buildImportedCudyr({ crdValue: 'SC', crdDateTime: dt }, day)).toBeNull();
    expect(buildImportedCudyr({ crdValue: '0', crdDateTime: dt }, day)).toBeNull();
    expect(buildImportedCudyr({ crdValue: 'constructor', crdDateTime: dt }, day)).toBeNull();
    expect(buildImportedCudyr({ crdValue: '', crdDateTime: dt }, day)).toBeNull();
  });

  it('returns null when the datetime is unparseable', () => {
    expect(buildImportedCudyr({ crdValue: 'D3', crdDateTime: 'nope' }, '2026-07-10')).toBeNull();
  });

  it('selects the matching historical day and keeps attributable Gestión de Camas provenance', () => {
    const result = buildImportedCudyr(
      {
        crdValue: 'C2',
        crdDateTime: '2026-07-15T06:54:00+00:00',
        source: 'gestion_camas',
        history: [
          {
            category: 'C2',
            recordedAt: '2026-07-15T06:54:00+00:00',
            author: 'Constanza Guajardo',
            authorRole: 'Enfermería',
          },
          {
            category: 'D3',
            recordedAt: '2026-07-11T05:15:00+00:00',
            author: 'Camila Leiva',
            authorRole: 'Enfermería',
            dependencyScore: 5,
            riskScore: 4,
          },
        ],
      },
      '2026-07-10'
    );

    expect(result).toMatchObject({
      category: 'D3',
      recordedDate: '2026-07-10',
      author: 'Camila Leiva',
      authorRole: 'Enfermería',
      dependencyScore: 5,
      riskScore: 4,
      source: CUDYR_IMPORT_SOURCE,
    });
    expect(result?.history).toHaveLength(1);
  });
});
