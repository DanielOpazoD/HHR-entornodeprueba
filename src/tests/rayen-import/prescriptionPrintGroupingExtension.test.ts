// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { prescriptionPrint } from './prescriptionPrintTestHarness';

describe('extension prescription operations', () => {
  it('uses indication time as emission only when its source is explicit', () => {
    expect(
      prescriptionPrint.resolvePrescriptionEmissionDateTime(
        { printDateSource: 'indication', printDateTime: '2026-07-20T14:40:00-06:00' },
        '2026-07-20T09:15:00-06:00'
      )
    ).toBe('2026-07-20T14:40:00-06:00');
    expect(
      prescriptionPrint.resolvePrescriptionEmissionDateTime(
        { printDateSource: 'validation', printDateTime: '2026-07-20T14:40:00-06:00' },
        '2026-07-20T09:15:00-06:00'
      )
    ).toBe('2026-07-20T09:15:00-06:00');
    expect(
      prescriptionPrint.resolvePrescriptionEmissionDateTime(
        { printDateSource: 'indication', printDateTime: '' },
        '2026-07-20T09:15:00-06:00'
      )
    ).toBe('2026-07-20T09:15:00-06:00');
  });

  it('deduplicates active medications and groups them by their actual professional', () => {
    const groups = prescriptionPrint.deriveProfessionalPrescriptionGroups([
      {
        publishDatetime: '2026-07-14T19:48:00',
        patientPharmaIndicationResume: [
          {
            MRE_ID: 1,
            DESCRIPTOR: 'Losartán 50 mg',
            POSOLOGY: '1 cada 12 horas',
            ROUTE_ADMINISTRATION: 'Oral',
            HCP_NAME: ' Daniel  Opazo ',
            PREFERRED_IDENTIFIER_CODE: '17752753K',
            PUBLISH_DATETIME: '2026-07-09T11:15:00',
          },
          {
            MRE_ID: 2,
            DESCRIPTOR: 'Tramadol gotas',
            POSOLOGY: '10 gotas cada 8 horas SOS',
            HCP_NAME: 'Elena Díaz',
            PUBLISH_DATETIME: '2026-07-14T19:48:00',
          },
        ],
      },
      {
        patientPharmaIndicationResume: [
          {
            MRE_ID: 1,
            DESCRIPTOR: 'Losartán 50 mg',
            POSOLOGY: '1 cada 12 horas',
            HCP_NAME: 'Daniel Opazo',
            PUBLISH_DATETIME: '2026-07-09T11:15:00',
          },
          {
            MRE_ID: 3,
            DESCRIPTOR: 'Omeprazol 20 mg',
            HCP_NAME: 'Ana Jofré',
            PUBLISH_DATETIME: '2026-07-10T10:00:00',
            SUSPENDED: true,
          },
        ],
      },
    ]);

    expect(groups.map(group => [group.professional, group.count])).toEqual([
      ['Elena Díaz', 1],
      ['Daniel Opazo', 1],
    ]);
    expect(groups[1]?.medications[0]).toMatchObject({
      medication: 'Losartán 50 mg',
      posology: '1 cada 12 horas',
      date: '2026-07-09',
      dateTime: '2026-07-09T11:15:00',
    });
    expect(groups[1]?.professionalRun).toBe('17.752.753-K');
    expect(groups[1]?.latestDateTime).toBe('2026-07-09T11:15:00');
    expect(groups[1]?.externalCount).toBe(0);
    expect(groups[0]?.key).toBe(
      `professional:elena-diaz-emission-${Date.parse('2026-07-14T19:48:00')}`
    );
  });

  it('separates later changes by issuance time and prints only the active rows from that change', () => {
    const groups = prescriptionPrint.deriveProfessionalPrescriptionGroups([
      {
        encounterEventId: 10,
        patientPharmaIndicationResume: [
          {
            MRE_ID: 501,
            DESCRIPTOR: 'Losartán 50 mg',
            POSOLOGY: '1 cada 12 horas',
            HCP_NAME: 'Daniel Opazo',
            PREFERRED_IDENTIFIER_CODE: '17752753K',
            PUBLISH_DATETIME: '2026-07-20T09:15:00-06:00',
          },
          {
            MRE_ID: 502,
            DESCRIPTOR: 'Omeprazol 20 mg',
            HCP_NAME: 'Daniel Opazo',
            PREFERRED_IDENTIFIER_CODE: '17752753K',
            PUBLISH_DATETIME: '2026-07-20T09:15:00-06:00',
          },
        ],
      },
      {
        encounterEventId: 11,
        patientPharmaIndicationResume: [
          {
            MRE_ID: 501,
            DESCRIPTOR: 'Losartán 50 mg',
            POSOLOGY: '1 cada 24 horas',
            HCP_NAME: 'Daniel Opazo',
            PREFERRED_IDENTIFIER_CODE: '17752753K',
            PUBLISH_DATETIME: '2026-07-20T14:40:00-06:00',
          },
        ],
      },
    ]);

    expect(groups).toHaveLength(2);
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
    const groups = prescriptionPrint.deriveProfessionalPrescriptionGroups([
      {
        patientPharmaIndicationResume: [
          {
            MRE_ID: 601,
            DESCRIPTOR: 'Indicación anterior',
            HCP_NAME: 'Daniel Opazo',
            PREFERRED_IDENTIFIER_CODE: '17752753K',
            PUBLISH_DATETIME: '2026-04-04T23:30:00-05:00',
          },
          {
            MRE_ID: 602,
            DESCRIPTOR: 'Indicación posterior',
            HCP_NAME: 'Daniel Opazo',
            PREFERRED_IDENTIFIER_CODE: '17752753K',
            PUBLISH_DATETIME: '2026-04-04T23:15:00-06:00',
          },
        ],
      },
    ]);

    expect(groups.map(group => group.latestDateTime)).toEqual([
      '2026-04-04T23:15:00-06:00',
      '2026-04-04T23:30:00-05:00',
    ]);
  });

  it('orders supported display-form timestamps chronologically', () => {
    const groups = prescriptionPrint.deriveProfessionalPrescriptionGroups([
      {
        patientPharmaIndicationResume: [
          {
            MRE_ID: 606,
            DESCRIPTOR: 'Indicación anterior',
            HCP_NAME: 'Daniel Opazo',
            PREFERRED_IDENTIFIER_CODE: '17752753K',
            PUBLISH_DATETIME: '14-07-2026 19:48',
          },
          {
            MRE_ID: 607,
            DESCRIPTOR: 'Indicación posterior',
            HCP_NAME: 'Daniel Opazo',
            PREFERRED_IDENTIFIER_CODE: '17752753K',
            PUBLISH_DATETIME: '15-07-2026 08:10',
          },
        ],
      },
    ]);

    expect(groups.map(group => group.latestDateTime)).toEqual([
      '15-07-2026 08:10',
      '14-07-2026 19:48',
    ]);
  });

  it('uses canonical instants without merging opposite timezone offsets', () => {
    const groups = prescriptionPrint.deriveProfessionalPrescriptionGroups([
      {
        patientPharmaIndicationResume: [
          {
            MRE_ID: 603,
            DESCRIPTOR: 'Indicación oeste',
            HCP_NAME: 'Daniel Opazo',
            PREFERRED_IDENTIFIER_CODE: '17752753K',
            PUBLISH_DATETIME: '2026-07-20T09:15:00-06:00',
          },
          {
            MRE_ID: 604,
            DESCRIPTOR: 'Indicación este',
            HCP_NAME: 'Daniel Opazo',
            PREFERRED_IDENTIFIER_CODE: '17752753K',
            PUBLISH_DATETIME: '2026-07-20T09:15:00+06:00',
          },
          {
            MRE_ID: 605,
            DESCRIPTOR: 'Mismo instante',
            HCP_NAME: 'Daniel Opazo',
            PREFERRED_IDENTIFIER_CODE: '17752753K',
            PUBLISH_DATETIME: '2026-07-20T15:15:00Z',
          },
        ],
      },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map(group => group.count)).toEqual([2, 1]);
    expect(new Set(groups.map(group => group.key)).size).toBe(2);
  });

  it('keeps clinically distinct fallback rows when Eloísa omits MRE_ID', () => {
    const groups = prescriptionPrint.deriveProfessionalPrescriptionGroups([
      {
        patientPharmaIndicationResume: [
          {
            DESCRIPTOR: 'Mometasona 50 mcg',
            POSOLOGY: '1 aplicación cada 12 horas',
            ROUTE_ADMINISTRATION: 'Nasal',
            MRE_ADMINISTRATION_NOTE: 'Fosa derecha',
            HCP_NAME: 'Elena Díaz',
            PUBLISH_DATETIME: '2026-07-15T08:56:00',
          },
          {
            DESCRIPTOR: 'Mometasona 50 mcg',
            POSOLOGY: '1 aplicación cada 12 horas',
            ROUTE_ADMINISTRATION: 'Tópica',
            MRE_ADMINISTRATION_NOTE: 'Lesión nasal externa',
            HCP_NAME: 'Elena Díaz',
            PUBLISH_DATETIME: '2026-07-15T08:56:00',
          },
        ],
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(2);
    expect(groups[0]?.medications.map(medication => [medication.route, medication.note])).toEqual([
      ['Nasal', 'Fosa derecha'],
      ['Tópica', 'Lesión nasal externa'],
    ]);
  });

  it('detects each active external medication as an individually printable prescription', () => {
    const professionalGroups = prescriptionPrint.applyProfessionalValidationDates(
      prescriptionPrint.deriveProfessionalPrescriptionGroups([
        {
          patientPharmaIndicationResume: [
            {
              MRE_ID: 901,
              DESCRIPTOR: 'Mometasona Furoato 50 mcg/dosis Suspensión Nasal',
              POSOLOGY: '1 puff en cada fosa nasal al día',
              HCP_NAME: 'Claudia Aravena',
              PREFERRED_IDENTIFIER_CODE: '17752753K',
              PUBLISH_DATETIME: '2026-07-15T08:10:00-06:00',
              is_external: true,
            },
            {
              MRE_ID: 902,
              DESCRIPTOR: 'Ibuprofeno 400 mg',
              HCP_NAME: 'Claudia Aravena',
              PUBLISH_DATETIME: '2026-07-15T08:10:00-06:00',
              is_external: false,
            },
            {
              MRE_ID: 903,
              DESCRIPTOR: 'Receta externa suspendida',
              HCP_NAME: 'Claudia Aravena',
              PUBLISH_DATETIME: '2026-07-15T08:10:00-06:00',
              IS_EXTERNAL: true,
              SUSPENDED: true,
            },
          ],
        },
        {
          patientPharmaIndicationResume: [
            {
              MRE_ID: 901,
              DESCRIPTOR: 'Mometasona Furoato 50 mcg/dosis Suspensión Nasal',
              POSOLOGY: '1 puff en cada fosa nasal al día',
              HCP_NAME: 'Claudia Aravena',
              PREFERRED_IDENTIFIER_CODE: '17752753K',
              PUBLISH_DATETIME: '2026-07-15T08:20:00-06:00',
            },
          ],
        },
      ]),
      [],
      {
        healthCarePractitionerName: 'Claudia Aravena',
        preferredIdentifierCode: '17752753K',
        creationDatetime: '2026-07-15T09:00:00-06:00',
      }
    );

    const externalGroups = prescriptionPrint.deriveExternalPrescriptionGroups(professionalGroups);

    expect(externalGroups).toHaveLength(1);
    expect(professionalGroups[0]?.externalCount).toBe(1);
    expect(externalGroups[0]).toMatchObject({
      key: 'external:901',
      external: true,
      medication: 'Mometasona Furoato 50 mcg/dosis Suspensión Nasal',
      professional: 'Claudia Aravena',
      professionalRun: '17.752.753-K',
      validationDateTime: '2026-07-15T09:00:00-06:00',
    });
    expect(externalGroups[0]?.medications[0]).toMatchObject({ external: true });
  });

  it('recovers the external flag from the active medication table by stable entry id', () => {
    const events = prescriptionPrint.applyCurrentMedicationMetadata(
      [
        {
          patientPharmaIndicationResume: [
            { MRE_ID: 901, DESCRIPTOR: 'Mometasona', IS_EXTERNAL: false },
            { MRE_ID: 902, DESCRIPTOR: 'Losartán' },
          ],
        },
      ],
      [
        { id: 901, is_external: true },
        { id: 902, is_external: false },
      ]
    ) as Array<{ patientPharmaIndicationResume: Array<Record<string, unknown>> }>;

    expect(events[0]?.patientPharmaIndicationResume).toEqual([
      expect.objectContaining({ MRE_ID: 901, IS_EXTERNAL: true }),
      expect.objectContaining({ MRE_ID: 902, IS_EXTERNAL: false }),
    ]);
  });

  it('keeps a suspension when the same medication row has an unresolved timestamp tie', () => {
    const groups = prescriptionPrint.deriveProfessionalPrescriptionGroups([
      {
        encounterEventId: 20,
        publishDatetime: '2026-07-15T09:00:00',
        patientPharmaIndicationResume: [
          {
            MRE_ID: 91,
            DESCRIPTOR: 'Losartán 50 mg',
            HCP_NAME: 'Daniel Opazo',
            PUBLISH_DATETIME: '2026-07-15T09:00:00',
            SUSPENDED: true,
          },
        ],
      },
      {
        encounterEventId: 20,
        publishDatetime: '2026-07-15T09:00:00',
        patientPharmaIndicationResume: [
          {
            MRE_ID: 91,
            DESCRIPTOR: 'Losartán 50 mg',
            HCP_NAME: 'Daniel Opazo',
            PUBLISH_DATETIME: '2026-07-15T09:00:00',
          },
        ],
      },
    ]);

    expect(groups).toEqual([]);
  });

  it('keeps professionals with the same name separated by RUN', () => {
    const groups = prescriptionPrint.deriveProfessionalPrescriptionGroups([
      {
        patientPharmaIndicationResume: [
          {
            MRE_ID: 101,
            DESCRIPTOR: 'Losartán 50 mg',
            HCP_NAME: 'Alexis Rojas',
            PREFERRED_IDENTIFIER_CODE: '111111111',
            PUBLISH_DATETIME: '2026-07-15T08:00:00',
          },
          {
            MRE_ID: 102,
            DESCRIPTOR: 'Paracetamol 500 mg',
            HCP_NAME: 'Alexis Rojas',
            PREFERRED_IDENTIFIER_CODE: '222222222',
            PUBLISH_DATETIME: '2026-07-15T09:00:00',
          },
        ],
      },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map(group => group.professionalRun).sort()).toEqual([
      '11.111.111-1',
      '22.222.222-2',
    ]);
    expect(groups.map(group => group.count)).toEqual([1, 1]);

    const dated = prescriptionPrint.applyProfessionalValidationDates(
      groups,
      [
        {
          healthCarePractitionerValidator: {
            healthCarePractitionerName: 'Alexis Rojas',
            creationDatetime: '2026-07-15T10:00:00',
            preferredIdentifierCode: '111111111',
          },
        },
      ],
      null
    );
    expect(
      Object.fromEntries(dated.map(group => [group.professionalRun, group.validationDateTime]))
    ).toEqual({
      '11.111.111-1': '2026-07-15T10:00:00',
      '22.222.222-2': '',
    });
  });

  it('does not inherit a RUN when the author of an existing medication changes', () => {
    const groups = prescriptionPrint.deriveProfessionalPrescriptionGroups([
      {
        encounterEventId: 10,
        publishDatetime: '2026-07-15T08:00:00',
        patientPharmaIndicationResume: [
          {
            MRE_ID: 301,
            DESCRIPTOR: 'Losartán 50 mg',
            HCP_NAME: 'Profesional Anterior',
            PREFERRED_IDENTIFIER_CODE: '111111111',
            PUBLISH_DATETIME: '2026-07-15T08:00:00',
          },
        ],
      },
      {
        encounterEventId: 11,
        publishDatetime: '2026-07-15T09:00:00',
        patientPharmaIndicationResume: [
          {
            MRE_ID: 301,
            DESCRIPTOR: 'Losartán 50 mg',
            HCP_NAME: 'Profesional Nuevo',
            PUBLISH_DATETIME: '2026-07-15T09:00:00',
          },
        ],
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      professional: 'Profesional Nuevo',
      professionalRun: '',
      prescriberVerified: false,
    });
  });

  it('does not inherit a RUN from an older version when the same visible author name is reused', () => {
    const groups = prescriptionPrint.deriveProfessionalPrescriptionGroups([
      {
        encounterEventId: 20,
        publishDatetime: '2026-07-15T08:00:00',
        patientPharmaIndicationResume: [
          {
            MRE_ID: 302,
            DESCRIPTOR: 'Losartán 50 mg',
            HCP_NAME: 'Alexis Rojas',
            PREFERRED_IDENTIFIER_CODE: '111111111',
            PUBLISH_DATETIME: '2026-07-15T08:00:00',
          },
        ],
      },
      {
        encounterEventId: 21,
        publishDatetime: '2026-07-15T09:00:00',
        patientPharmaIndicationResume: [
          {
            MRE_ID: 302,
            DESCRIPTOR: 'Losartán 50 mg',
            HCP_NAME: 'Alexis Rojas',
            PUBLISH_DATETIME: '2026-07-15T09:00:00',
          },
        ],
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      professional: 'Alexis Rojas',
      professionalRun: '',
      prescriberVerified: false,
    });
  });

  it('accepts an exact unambiguous validator name when Eloisa omits the validator RUN', () => {
    const groups = prescriptionPrint.deriveProfessionalPrescriptionGroups([
      {
        patientPharmaIndicationResume: [
          {
            MRE_ID: 350,
            DESCRIPTOR: 'Losartán 50 mg',
            HCP_NAME: 'Alexis Rojas',
            PREFERRED_IDENTIFIER_CODE: '111111111',
            PUBLISH_DATETIME: '2026-07-15T08:00:00',
          },
        ],
      },
    ]);
    const dated = prescriptionPrint.applyProfessionalValidationDates(groups, [], {
      healthCarePractitionerName: 'Alexis Rojas',
      creationDatetime: '2026-07-15T10:00:00',
    });

    expect(dated[0]).toMatchObject({
      professionalRun: '11.111.111-1',
      validationDate: '2026-07-15',
      validationDateTime: '2026-07-15T10:00:00',
      printDateTime: '2026-07-15T08:00:00',
      printDateSource: 'indication',
    });
  });

  it('uses the latest attributable indication time when Eloisa has no historical validation', () => {
    const groups = prescriptionPrint.deriveProfessionalPrescriptionGroups([
      {
        patientPharmaIndicationResume: [
          {
            MRE_ID: 351,
            DESCRIPTOR: 'Mometasona nasal',
            HCP_NAME: 'Claudia Aravena',
            PREFERRED_IDENTIFIER_CODE: '130268447',
            PUBLISH_DATETIME: '2026-07-14T09:41:00-06:00',
          },
        ],
      },
    ]);

    const dated = prescriptionPrint.applyProfessionalValidationDates(groups, [], null);

    expect(dated[0]).toMatchObject({
      professional: 'Claudia Aravena',
      professionalRun: '13.026.844-7',
      validationDateTime: '',
      printDate: '2026-07-14',
      printDateTime: '2026-07-14T09:41:00-06:00',
      printDateSource: 'indication',
    });
  });

  it('does not infer a prescriber RUN only because another row has the same name', () => {
    const groups = prescriptionPrint.deriveProfessionalPrescriptionGroups([
      {
        patientPharmaIndicationResume: [
          {
            MRE_ID: 401,
            DESCRIPTOR: 'Losartán 50 mg',
            HCP_NAME: 'Alexis Rojas',
            PREFERRED_IDENTIFIER_CODE: '111111111',
            PUBLISH_DATETIME: '2026-07-15T08:00:00',
          },
          {
            MRE_ID: 402,
            DESCRIPTOR: 'Paracetamol 500 mg',
            HCP_NAME: 'Alexis Rojas',
            PUBLISH_DATETIME: '2026-07-15T09:00:00',
          },
        ],
      },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.find(group => group.professionalRun === '')).toMatchObject({
      professional: 'Alexis Rojas',
      prescriberVerified: false,
      count: 1,
    });
  });

  it('uses the latest validation made by the same professional', () => {
    const groups = prescriptionPrint.deriveProfessionalPrescriptionGroups([
      {
        patientPharmaIndicationResume: [
          {
            MRE_ID: 1,
            DESCRIPTOR: 'Losartán 50 mg',
            HCP_NAME: 'Daniel Opazo',
            PUBLISH_DATETIME: '2026-07-09T11:15:00',
          },
          {
            MRE_ID: 2,
            DESCRIPTOR: 'Tramadol gotas',
            HCP_NAME: 'Elena Díaz',
            PUBLISH_DATETIME: '2026-07-10T10:00:00',
          },
        ],
        healthCarePractitionerValidator: {
          healthCarePractitionerName: 'Elena Díaz',
          creationDatetime: '2026-07-12T18:00:00-04:00',
        },
      },
    ]);
    const dated = prescriptionPrint.applyProfessionalValidationDates(groups, [], {
      healthCarePractitionerName: 'Elena Díaz',
      creationDatetime: '2026-07-14T21:30:00-04:00',
    });

    expect(dated.find(group => group.professional === 'Elena Díaz')?.validationDate).toBe(
      '2026-07-14'
    );
    expect(dated.find(group => group.professional === 'Elena Díaz')?.validationDateTime).toBe(
      '2026-07-14T21:30:00-04:00'
    );
    expect(dated.find(group => group.professional === 'Daniel Opazo')?.validationDate).toBe('');
  });
});
