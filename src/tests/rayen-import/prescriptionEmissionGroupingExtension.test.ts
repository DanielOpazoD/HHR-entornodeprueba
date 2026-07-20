// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { prescriptionPrint } from './prescriptionPrintTestHarness';

describe('extension prescription emission grouping', () => {
  it('uses indication time as emission only when its source is explicit', () => {
    expect(prescriptionPrint.resolvePrescriptionEmissionDateTime(
      { printDateSource: 'indication', printDateTime: '2026-07-20T14:40:00-06:00' },
      '2026-07-20T09:15:00-06:00'
    )).toBe('2026-07-20T14:40:00-06:00');
    expect(prescriptionPrint.resolvePrescriptionEmissionDateTime(
      { printDateSource: 'validation', printDateTime: '2026-07-20T14:40:00-06:00' },
      '2026-07-20T09:15:00-06:00'
    )).toBe('2026-07-20T09:15:00-06:00');
    expect(prescriptionPrint.resolvePrescriptionEmissionDateTime(
      { printDateSource: 'indication', printDateTime: '' },
      '2026-07-20T09:15:00-06:00'
    )).toBe('2026-07-20T09:15:00-06:00');
  });

  it('separates later changes and prints only active rows from the new emission', () => {
    const groups = prescriptionPrint.deriveProfessionalPrescriptionGroups([
      {
        patientPharmaIndicationResume: [
          {
            MRE_ID: 501, DESCRIPTOR: 'Losartán 50 mg', POSOLOGY: '1 cada 12 horas',
            HCP_NAME: 'Daniel Opazo', PREFERRED_IDENTIFIER_CODE: '17752753K',
            PUBLISH_DATETIME: '2026-07-20T09:15:00-06:00',
          },
          {
            MRE_ID: 502, DESCRIPTOR: 'Omeprazol 20 mg', HCP_NAME: 'Daniel Opazo',
            PREFERRED_IDENTIFIER_CODE: '17752753K',
            PUBLISH_DATETIME: '2026-07-20T09:15:00-06:00',
          },
        ],
      },
      {
        patientPharmaIndicationResume: [{
          MRE_ID: 501, DESCRIPTOR: 'Losartán 50 mg', POSOLOGY: '1 cada 24 horas',
          HCP_NAME: 'Daniel Opazo', PREFERRED_IDENTIFIER_CODE: '17752753K',
          PUBLISH_DATETIME: '2026-07-20T14:40:00-06:00',
        }],
      },
    ]);

    expect(groups.map(group => [group.latestDateTime, group.count])).toEqual([
      ['2026-07-20T14:40:00-06:00', 1],
      ['2026-07-20T09:15:00-06:00', 1],
    ]);
    expect(groups[0]?.medications).toEqual([
      expect.objectContaining({ medication: 'Losartán 50 mg', posology: '1 cada 24 horas' }),
    ]);
    expect(groups[1]?.medications).toEqual([
      expect.objectContaining({ medication: 'Omeprazol 20 mg' }),
    ]);
  });

  it('orders emission groups by absolute instant when timezone offsets differ', () => {
    const groups = prescriptionPrint.deriveProfessionalPrescriptionGroups([{
      patientPharmaIndicationResume: [
        {
          MRE_ID: 601, DESCRIPTOR: 'Indicación anterior', HCP_NAME: 'Daniel Opazo',
          PREFERRED_IDENTIFIER_CODE: '17752753K',
          PUBLISH_DATETIME: '2026-04-04T23:30:00-05:00',
        },
        {
          MRE_ID: 602, DESCRIPTOR: 'Indicación posterior', HCP_NAME: 'Daniel Opazo',
          PREFERRED_IDENTIFIER_CODE: '17752753K',
          PUBLISH_DATETIME: '2026-04-04T23:15:00-06:00',
        },
      ],
    }]);

    expect(groups.map(group => group.latestDateTime)).toEqual([
      '2026-04-04T23:15:00-06:00',
      '2026-04-04T23:30:00-05:00',
    ]);
  });

  it('orders supported display-form timestamps chronologically', () => {
    const groups = prescriptionPrint.deriveProfessionalPrescriptionGroups([{
      patientPharmaIndicationResume: [
        {
          MRE_ID: 606, DESCRIPTOR: 'Indicación anterior', HCP_NAME: 'Daniel Opazo',
          PREFERRED_IDENTIFIER_CODE: '17752753K', PUBLISH_DATETIME: '14-07-2026 19:48',
        },
        {
          MRE_ID: 607, DESCRIPTOR: 'Indicación posterior', HCP_NAME: 'Daniel Opazo',
          PREFERRED_IDENTIFIER_CODE: '17752753K', PUBLISH_DATETIME: '15-07-2026 08:10',
        },
      ],
    }]);

    expect(groups.map(group => group.latestDateTime)).toEqual([
      '15-07-2026 08:10',
      '14-07-2026 19:48',
    ]);
  });

  it('uses canonical instants without merging opposite timezone offsets', () => {
    const groups = prescriptionPrint.deriveProfessionalPrescriptionGroups([{
      patientPharmaIndicationResume: [
        {
          MRE_ID: 603, DESCRIPTOR: 'Indicación oeste', HCP_NAME: 'Daniel Opazo',
          PREFERRED_IDENTIFIER_CODE: '17752753K',
          PUBLISH_DATETIME: '2026-07-20T09:15:00-06:00',
        },
        {
          MRE_ID: 604, DESCRIPTOR: 'Indicación este', HCP_NAME: 'Daniel Opazo',
          PREFERRED_IDENTIFIER_CODE: '17752753K',
          PUBLISH_DATETIME: '2026-07-20T09:15:00+06:00',
        },
        {
          MRE_ID: 605, DESCRIPTOR: 'Mismo instante', HCP_NAME: 'Daniel Opazo',
          PREFERRED_IDENTIFIER_CODE: '17752753K', PUBLISH_DATETIME: '2026-07-20T15:15:00Z',
        },
      ],
    }]);

    expect(groups).toHaveLength(2);
    expect(groups.map(group => group.count)).toEqual([2, 1]);
    expect(new Set(groups.map(group => group.key)).size).toBe(2);
  });
});
