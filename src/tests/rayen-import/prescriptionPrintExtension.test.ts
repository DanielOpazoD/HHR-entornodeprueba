// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';

import '../../../extension/prescription-print.js';

const prescriptionPrint = (
  globalThis as typeof globalThis & {
    HhrPrescriptionPrint: {
      INDICATIONS_REPORT_FILE: string;
      PRESCRIPTION_REPORT_FILE: string;
      REGIMEN_REPORT_FILE: string;
      resolveNursingEncounterId: (url: unknown) => string;
      resolveEncounterId: (url: unknown) => string;
      isNursingRouteUrl: (url: unknown) => boolean;
      derivePrescriptionDates: (events: unknown[]) => Array<{
        date: string;
        label: string;
        count: number;
        prescribers: string[];
      }>;
      deriveProfessionalPrescriptionGroups: (events: unknown[]) => Array<{
        key: string;
        professional: string;
        professionalRun: string;
        prescriberVerified: boolean;
        count: number;
        externalCount: number;
        latestDate: string;
        latestDateTime: string;
        medications: Array<{
          id: string;
          medication: string;
          posology: string;
          route: string;
          note: string;
          date: string;
          dateTime: string;
          external?: boolean;
        }>;
      }>;
      applyCurrentMedicationMetadata: (events: unknown[], entries: unknown[]) => unknown[];
      deriveExternalPrescriptionGroups: (groups: Array<Record<string, unknown>>) => Array<{
        key: string;
        external: boolean;
        medication: string;
        professional: string;
        professionalRun: string;
        validationDateTime: string;
        medications: Array<Record<string, unknown>>;
      }>;
      applyProfessionalValidationDates: (
        groups: Array<{
          key: string;
          professional: string;
          professionalRun: string;
          count: number;
          externalCount: number;
          latestDate: string;
          latestDateTime: string;
          medications: Array<Record<string, unknown>>;
        }>,
        events: unknown[],
        currentValidation: unknown
      ) => Array<{
        key: string;
        professional: string;
        professionalRun: string;
        prescriberVerified: boolean;
        count: number;
        externalCount: number;
        latestDate: string;
        latestDateTime: string;
        validationDate: string;
        validationDateTime: string;
        printDate: string;
        printDateTime: string;
        printDateSource: string;
        medications: Array<Record<string, unknown>>;
      }>;
      buildPrescriptionReportUrl: (
        apiOrigin: string,
        encounterId: string,
        practitionerId: string,
        patientId: string
      ) => string;
      buildIndicationsReportUrl: (
        apiOrigin: string,
        encounterId: string,
        practitionerId: string,
        patientId: string
      ) => string;
      buildRegimenReportUrl: (apiOrigin: string, facilityId: string) => string;
      deriveLatestBraden: (
        events: unknown[],
        forms: unknown[]
      ) => null | {
        total: number;
        severity: string;
        dateTime: string;
        author: string;
        source: string;
      };
      deriveScaleHistory: (
        events: unknown[],
        forms: unknown[],
        scaleName: string
      ) => Array<{ total: number; severity: string; dateTime: string; author: string }>;
      deriveLatestNutritionOrder: (entry: unknown) => null | {
        diet: string;
        observation: string;
        dateTime: string;
        author: string;
      };
      deriveLatestShiftChange: (entries: unknown) => null | {
        observation: string;
        dateTime: string;
        author: string;
        isSigned: boolean;
      };
      calculateCudyrCategory: (fields: Array<{ typeId: number; value: number }>) => {
        dependency: number;
        risk: number;
        value: string;
      };
      buildPrescriptionFilename: (
        encounterId: string,
        professional?: string,
        printFormat?: string
      ) => string;
      formatRun: (value: unknown) => string;
      formatDateTimeLabel: (value: unknown) => string;
      formatAgeLabel: (birthDate: unknown, referenceValue?: unknown) => string;
      activeHospitalizedEncounters: (snapshot: unknown) => Array<{
        encounterId: string;
        name: string;
        run: string;
        service: string;
        room: string;
        bed: string;
      }>;
      buildHospitalizedPrescriptionSummary: (
        patient: Record<string, unknown>,
        groups: Array<Record<string, unknown>>,
        currentEncounterId?: string
      ) => {
        encounterId: string;
        name: string;
        medicationCount: number;
        isCurrent: boolean;
        prescribers: Array<{
          professional: string;
          professionalRun: string;
          count: number;
          validationDateTime: string;
        }>;
      };
      buildBatchPrescriptionFilename: (count: number, printFormat: string, date?: string) => string;
      buildBatchIndicationsFilename: (count: number, date?: string) => string;
      buildRegimenFilename: (date?: string) => string;
      extractOfficialPrescriptionMetadata: (buffer: ArrayBuffer) => Promise<{
        folio: string;
        emissionDateTime: string;
        professional: string;
        professionalRun: string;
      }>;
      extractOfficialPrescriptionContent: (buffer: ArrayBuffer) => Promise<{
        patient: Record<string, string>;
        professional: string;
        professionalRun: string;
        prescriptionDate: string;
        printedBy: string;
        address: string;
        emissionDateTime: string;
        folio: string;
        medications: Array<Record<string, string>>;
      } | null>;
    };
  }
).HhrPrescriptionPrint;

describe('extension nursing prescription print helpers', () => {
  it('activates only for a numeric nursing encounter route', () => {
    expect(
      prescriptionPrint.resolveNursingEncounterId(
        'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse/141437'
      )
    ).toBe('141437');
    expect(
      prescriptionPrint.resolveNursingEncounterId(
        'https://fichamedico.rayensalud.cl/dashboard/encounter-list/141437'
      )
    ).toBe('');
    expect(
      prescriptionPrint.resolveNursingEncounterId(
        'https://example.com/dashboard/encounter-list-nurse/141437'
      )
    ).toBe('');
  });

  it('resolves the episode when a nursing profile is kept on the generic work-list route', () => {
    expect(
      prescriptionPrint.resolveEncounterId(
        'https://fichamedico.rayensalud.cl/dashboard/encounter-list/141437'
      )
    ).toBe('141437');
    expect(
      prescriptionPrint.resolveEncounterId(
        'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse?encId=141438'
      )
    ).toBe('141438');
    expect(
      prescriptionPrint.resolveEncounterId('https://example.com/dashboard/encounter-list/141437')
    ).toBe('');
    expect(
      prescriptionPrint.resolveEncounterId(
        'https://fichamedico.rayensalud.cl/dashboard/reports?encId=999999'
      )
    ).toBe('');
    expect(
      prescriptionPrint.resolveEncounterId(
        'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse/141437?encId=141438'
      )
    ).toBe('');
    expect(
      prescriptionPrint.isNursingRouteUrl(
        'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse/141437'
      )
    ).toBe(true);
  });

  it('groups available non-archived medication indications by publication date', () => {
    const dates = prescriptionPrint.derivePrescriptionDates([
      {
        publishDatetime: '2026-07-09T09:03:00',
        patientPharmaIndicationResume: [
          { PUBLISH_DATETIME: '2026-07-09T09:03:00', HCP_NAME: 'Daniel Opazo' },
          { PUBLISH_DATETIME: '2026-07-09T09:03:00', HCP_NAME: 'Daniel Opazo' },
          { PUBLISH_DATETIME: '2026-07-09T09:03:00', ARCHIVED: true },
        ],
      },
      {
        publishDatetime: '2026-07-12T11:00:00',
        patientPharmaIndicationResume: [{ HCP_NAME: 'Ana Enfermera' }],
      },
    ]);

    expect(dates).toEqual([
      {
        date: '2026-07-12',
        label: '12-07-2026',
        count: 1,
        prescribers: ['Ana Enfermera'],
      },
      {
        date: '2026-07-09',
        label: '09-07-2026',
        count: 2,
        prescribers: ['Daniel Opazo'],
      },
    ]);
  });

  it('builds a constrained official report URL and a stable download filename', () => {
    expect(
      prescriptionPrint.buildPrescriptionReportUrl(
        'https://fichamedicoback.rayensalud.cl/api/ignored',
        '141437',
        '7936',
        '88921'
      )
    ).toBe(
      'https://fichamedicoback.rayensalud.cl/api/report/Reporte_Receta_Medica.pdf?enc_id=141437&hcp_id=7936&pat_id=88921'
    );
    expect(
      prescriptionPrint.buildIndicationsReportUrl(
        'https://fichamedicoback.rayensalud.cl',
        '141437',
        '7936',
        '88921'
      )
    ).toBe(
      'https://fichamedicoback.rayensalud.cl/api/report/Reporte_Indicaciones_Paciente.pdf?enc_id=141437&hcp_id=7936&pat_id=88921'
    );
    expect(prescriptionPrint.buildPrescriptionFilename('141437')).toBe(
      'Receta_medica_141437_vigente.pdf'
    );
    expect(prescriptionPrint.buildPrescriptionFilename('141437', 'Elena Díaz')).toBe(
      'Receta_medica_141437_elena-diaz.pdf'
    );
    expect(prescriptionPrint.buildPrescriptionFilename('141437', 'Elena Díaz', 'compact')).toBe(
      'Receta_medica_141437_elena-diaz_compacta.pdf'
    );
    expect(
      prescriptionPrint.buildPrescriptionReportUrl(
        'https://fichamedicoback.rayensalud.cl',
        '../admin',
        '7936',
        '88921'
      )
    ).toBe('');
  });

  it('keeps prescription and general indications reports as separate official files', () => {
    expect(prescriptionPrint.INDICATIONS_REPORT_FILE).toBe('Reporte_Indicaciones_Paciente.pdf');
    expect(prescriptionPrint.PRESCRIPTION_REPORT_FILE).toBe('Reporte_Receta_Medica.pdf');
    expect(prescriptionPrint.REGIMEN_REPORT_FILE).toBe('Reporte_Regimen.pdf');
    expect(
      prescriptionPrint.buildRegimenReportUrl(
        'https://fichamedicoback.rayensalud.cl/api/ignored',
        '1342'
      )
    ).toBe('https://fichamedicoback.rayensalud.cl/api/report/Reporte_Regimen.pdf?fac_id=1342');
    expect(prescriptionPrint.buildRegimenReportUrl('https://example.com', '../1342')).toBe('');
  });

  it('selects the latest available BRADEN across history and summary forms', () => {
    const braden = prescriptionPrint.deriveLatestBraden(
      [
        {
          publishDatetime: '2026-07-15T08:40:00-04:00',
          evaluationInstrumentsResume: [
            { FORM_NAME: 'Escala de riesgo UPP (Braden)', LABEL: 'Puntaje', VALUE: '14' },
            {
              FORM_NAME: 'Escala de riesgo UPP (Braden)',
              LABEL: 'Nivel de Severidad',
              VALUE: 'Riesgo moderado',
              PUBLISH_DATE_HCP_NAME: 'Valeria Salfate',
            },
          ],
        },
      ],
      [
        {
          nameForm: 'Escala de riesgo UPP (Braden)',
          encounterEventId: 10,
          authorHealthCarePractitionerName: 'Enfermera anterior',
          metaCampList: [
            {
              id: 'BRAD_Puntaje',
              label: 'Puntaje',
              value: '17',
              createDatetime: '14-07-2026 22:10:00 -04:00',
            },
            { id: 'BRAD_ResultadoScore', label: 'Nivel de Severidad', valueName: 'Riesgo bajo' },
          ],
        },
      ]
    );

    expect(braden).toEqual({
      total: 14,
      severity: 'Riesgo moderado',
      dateTime: '2026-07-15T08:40:00-04:00',
      author: 'Valeria Salfate',
      source: 'history',
    });
  });

  it('uses the BRADEN summary form when history has no result', () => {
    expect(
      prescriptionPrint.deriveLatestBraden(
        [],
        [
          {
            nameForm: 'Escala de riesgo UPP (Braden)',
            encounterEventId: 11,
            authorHealthCarePractitionerName: 'Ana Enfermera',
            metaCampList: [
              {
                id: 'BRAD_Puntaje',
                label: 'Puntaje',
                value: '18',
                createDatetime: '15-07-2026 06:05:00 -04:00',
              },
              { id: 'BRAD_ResultadoScore', label: 'Nivel de Severidad', valueName: 'Sin riesgo' },
            ],
          },
        ]
      )
    ).toMatchObject({
      total: 18,
      severity: 'Sin riesgo',
      dateTime: '2026-07-15T06:05:00',
      author: 'Ana Enfermera',
      source: 'form',
    });
  });

  it('selects a newer BRADEN form even when history already has an older result', () => {
    const braden = prescriptionPrint.deriveLatestBraden(
      [
        {
          encounterEventId: 1,
          publishDatetime: '2026-07-14T08:00:00-06:00',
          evaluationInstrumentsResume: [
            { FORM_NAME: 'Escala Braden', LABEL: 'BRAD_Puntaje', VALUE: '14' },
            {
              FORM_NAME: 'Escala Braden',
              LABEL: 'BRAD_ResultadoScore',
              VALUE_NAME: 'Riesgo moderado',
            },
          ],
        },
      ],
      [
        {
          encounterEventId: 2,
          nameForm: 'Escala Braden',
          authorHealthCarePractitionerName: 'Ana Enfermera',
          metaCampList: [
            {
              id: 'BRAD_Puntaje',
              value: '18',
              createDatetime: '15-07-2026 06:05:00 -04:00',
            },
            {
              id: 'BRAD_ResultadoScore',
              valueName: 'Sin riesgo',
            },
          ],
        },
      ]
    );

    expect(braden).toMatchObject({
      total: 18,
      severity: 'Sin riesgo',
      source: 'form',
      dateTime: '2026-07-15T06:05:00',
    });
  });

  it('keeps only active hospitalized encounters and orders them by location', () => {
    const patients = prescriptionPrint.activeHospitalizedEncounters({
      encounters: [
        {
          encounterId: '141438',
          firstGivenName: 'Ana',
          firstFamilyName: 'Paoa',
          service: 'Cirugía',
          room: 'Sala 2',
          bed: 'C2',
        },
        {
          encounterId: '141437',
          firstGivenName: 'Ines',
          nextGivenNames: 'Leiva',
          firstFamilyName: 'Riroroko',
          run: '8.932.066-6',
          service: 'Cirugía',
          room: 'Sala 1',
          bed: 'C1',
        },
        { encounterId: '141439', firstGivenName: 'Alta', hasMedicalDischarge: true },
        { encounterId: '141440', firstGivenName: 'Fallecida', isDead: true },
      ],
    });

    expect(patients.map(patient => patient.encounterId)).toEqual(['141437', '141438']);
    expect(patients[0]).toMatchObject({
      name: 'Ines Leiva Riroroko',
      run: '8.932.066-6',
      bed: 'C1',
    });
  });

  it('summarizes medication count, date/time and prescriber for bulk selection', () => {
    const summary = prescriptionPrint.buildHospitalizedPrescriptionSummary(
      { encounterId: '141437', name: 'Ines Leiva Riroroko', bed: 'H6C1' },
      [
        {
          professional: 'Elena Díaz',
          professionalRun: '17752753K',
          count: 5,
          validationDateTime: '2026-07-14T22:34:00-04:00',
        },
        {
          professional: 'Daniel Opazo',
          professionalRun: '16.111.222-3',
          count: 3,
          latestDateTime: '2026-07-13T08:15:00-04:00',
        },
      ],
      '141437'
    );

    expect(summary).toMatchObject({
      encounterId: '141437',
      medicationCount: 8,
      isCurrent: true,
    });
    expect(summary.prescribers[0]).toEqual({
      professional: 'Elena Díaz',
      professionalRun: '17.752.753-K',
      count: 5,
      validationDateTime: '2026-07-14T22:34:00-04:00',
    });
    expect(prescriptionPrint.formatDateTimeLabel(summary.prescribers[0]?.validationDateTime)).toBe(
      '14-07-2026 20:34'
    );
    expect(prescriptionPrint.buildBatchPrescriptionFilename(8, 'compact', '2026-07-15')).toBe(
      'Recetas_hospitalizados_2026-07-15_8_pacientes_compactas.pdf'
    );
    expect(prescriptionPrint.buildBatchIndicationsFilename(8, '2026-07-15')).toBe(
      'Indicaciones_hospitalizados_2026-07-15_8_pacientes.pdf'
    );
    expect(prescriptionPrint.buildRegimenFilename('2026-07-15')).toBe(
      'Regimenes_hospitalizados_BRADEN_2026-07-15.pdf'
    );
  });

  it('renders zoned clinical timestamps in Pacific/Easter and preserves naive local values', () => {
    expect(prescriptionPrint.formatDateTimeLabel('2026-07-15T14:56:00Z')).toBe('15-07-2026 08:56');
    expect(prescriptionPrint.formatDateTimeLabel('2026-07-15T10:56:00-04:00')).toBe(
      '15-07-2026 08:56'
    );
    expect(prescriptionPrint.formatDateTimeLabel('2026-07-15T08:56:00')).toBe('15-07-2026 08:56');
    expect(prescriptionPrint.formatDateTimeLabel('2026-01-15T14:00:00Z')).toBe('15-01-2026 09:00');
  });

  it('calculates a human-readable age using the local Rapa Nui calendar date', () => {
    expect(prescriptionPrint.formatAgeLabel('1990-07-16', '2026-07-15T14:56:00Z')).toBe(
      '35 años, 11 meses, 29 días'
    );
    expect(prescriptionPrint.formatAgeLabel('2025-02-31', '2026-07-15')).toBe('');
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
      ['Daniel Opazo', 1],
      ['Elena Díaz', 1],
    ]);
    expect(groups[0]?.medications[0]).toMatchObject({
      medication: 'Losartán 50 mg',
      posology: '1 cada 12 horas',
      date: '2026-07-09',
      dateTime: '2026-07-09T11:15:00',
    });
    expect(groups[0]?.professionalRun).toBe('17.752.753-K');
    expect(groups[0]?.latestDateTime).toBe('2026-07-09T11:15:00');
    expect(groups[0]?.externalCount).toBe(0);
    expect(groups[1]?.key).toBe('professional:elena-diaz');
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

  it('extracts the official folio, emission time and prescriber identity from a compressed PDF', async () => {
    const document = new jsPDF({ compress: true });
    document.text('Fecha impresión', 20, 20);
    document.text('14-07-2026  21:45', 120, 20);
    document.text('Folio: 012D5533', 120, 35);
    document.text('Prescriptor:', 20, 50);
    document.text('RUN:', 20, 65);
    document.text('Fecha:', 120, 50);
    document.text('Daniel Opazo', 60, 50);
    document.text('17.752.753-K', 60, 65);

    const metadata = await prescriptionPrint.extractOfficialPrescriptionMetadata(
      document.output('arraybuffer')
    );

    expect(metadata).toEqual({
      folio: '012D5533',
      emissionDateTime: '14-07-2026 21:45',
      professional: 'Daniel Opazo',
      professionalRun: '17.752.753-K',
    });
    expect(prescriptionPrint.formatRun('17752753K')).toBe('17.752.753-K');
    expect(prescriptionPrint.formatRun('ABC123')).toBe('');
    expect(prescriptionPrint.formatRun('17.752.753-1')).toBe('');
  });

  it('anchors emission time to its labeled header instead of an earlier timestamp', async () => {
    const document = new jsPDF({ compress: true });
    document.text('01-01-2020  00:01', 20, 10);
    document.text('Fecha emisión', 20, 20);
    document.text('15-07-2026  08:56', 120, 20);
    document.text('Folio: 012D5533', 120, 35);

    const metadata = await prescriptionPrint.extractOfficialPrescriptionMetadata(
      document.output('arraybuffer')
    );

    expect(metadata.emissionDateTime).toBe('15-07-2026 08:56');
  });

  it('extracts metadata when the official PDF declares FlateDecode as a filter array', async () => {
    const document = new jsPDF({ compress: true });
    document.text('Fecha impresión', 20, 20);
    document.text('15-07-2026  08:56', 120, 20);
    document.text('Folio: 012D5533', 120, 35);
    const original = new Uint8Array(document.output('arraybuffer'));
    const source = new TextDecoder('latin1').decode(original);
    const needle = '/Filter /FlateDecode';
    const index = source.indexOf(needle);
    expect(index).toBeGreaterThanOrEqual(0);
    const replacement = new TextEncoder().encode('/Filter [/FlateDecode]');
    const modified = new Uint8Array(original.length - needle.length + replacement.length);
    modified.set(original.slice(0, index));
    modified.set(replacement, index);
    modified.set(original.slice(index + needle.length), index + replacement.length);

    const metadata = await prescriptionPrint.extractOfficialPrescriptionMetadata(modified.buffer);
    expect(metadata).toMatchObject({ folio: '012D5533', emissionDateTime: '15-07-2026 08:56' });
  });

  it('extracts equivalent patient, medication and footer content from the official PDF layout', async () => {
    const document = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
    document.text('Fecha impresión', 434, 30);
    document.text('14-07-2026  23:23', 500, 30);
    document.text('Dirección', 20, 56);
    document.text('Simón Paoa N°S/N', 100, 56);
    document.text('Folio: D292620E', 500, 80);
    document.text('Nombres:', 20, 110);
    document.text('Ines Leiva Riroroko', 70, 110);
    document.text('RUN:', 20, 130);
    document.text('8.932.066-6', 90, 130);
    document.text('Sexo:', 180, 130);
    document.text('Mujer', 220, 130);
    document.text('Edad:', 310, 130);
    document.text('59 año(s)', 350, 130);
    document.text('Cama:', 20, 150);
    document.text('H6C1', 70, 150);
    document.text('Sala:', 190, 150);
    document.text('Habitacion 6', 240, 150);
    document.text('Servicio:', 364, 150);
    document.text('Área Médico Quirúrgica', 414, 150);
    document.text('Diagnóstico(s):', 20, 175);
    document.text('Insuficiencia cardiaca', 100, 175);
    document.text('descompensada con edema', 20, 187);
    document.text('Medicamento', 20, 205);
    document.text('Posología e indicaciones', 310, 205);
    document.text('Despacho Farmacia', 500, 205);
    document.line(20, 210, 310, 210);
    document.line(310, 210, 500, 210);
    document.line(500, 210, 590, 210);
    document.text('Espironolactona 25 mg Comprimidos , vía oral', 20, 220);
    document.text('presentación hospitalaria de liberación prolongada', 20, 240);
    document.text('1 comprimido al día vo', 310, 220);
    document.text('con control de presión arterial', 310, 240);
    document.text('Pendiente', 500, 220);
    document.text('09-07-2026 11:15', 20, 252);
    document.line(20, 265, 310, 265);
    document.line(310, 265, 500, 265);
    document.line(500, 265, 590, 265);
    document.text('Prescriptor:', 20, 300);
    document.text('Elena Diaz', 99, 300);
    document.text('RUN:', 20, 320);
    document.text('19.525.925-9', 99, 320);
    document.text('Fecha:', 427, 300);
    document.text('15-07-2026', 473, 300);
    document.text('Impreso por', 20, 360);
    document.text('Valeria Salfate', 71, 360);

    const content = await prescriptionPrint.extractOfficialPrescriptionContent(
      document.output('arraybuffer')
    );

    expect(content).toMatchObject({
      patient: {
        name: 'Ines Leiva Riroroko',
        run: '8.932.066-6',
        sex: 'Mujer',
        age: '59 año(s)',
        bed: 'H6C1',
        room: 'Habitacion 6',
        service: 'Área Médico Quirúrgica',
        diagnosis: 'Insuficiencia cardiaca descompensada con edema',
      },
      professional: 'Elena Diaz',
      professionalRun: '19.525.925-9',
      prescriptionDate: '15-07-2026',
      printedBy: 'Valeria Salfate',
      address: 'Simón Paoa N°S/N',
      emissionDateTime: '14-07-2026 23:23',
      folio: 'D292620E',
    });
    expect(content?.medications).toEqual([
      expect.objectContaining({
        medication:
          'Espironolactona 25 mg Comprimidos , vía oral presentación hospitalaria de liberación prolongada',
        posology: '1 comprimido al día vo con control de presión arterial',
        dispatch: 'Pendiente',
        dateTime: '09-07-2026 11:15',
      }),
    ]);
  });

  it('uses the official table borders when adjacent medication rows have different heights', async () => {
    const document = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
    document.text('Fecha impresión', 434, 30);
    document.text('14-07-2026  23:23', 500, 30);
    document.text('Dirección', 20, 56);
    document.text('Simón Paoa N°S/N', 100, 56);
    document.text('Folio: D292620E', 500, 80);
    document.text('Nombres:', 20, 110);
    document.text('Paciente Prueba', 70, 110);
    document.text('RUN:', 20, 130);
    document.text('8.932.066-6', 90, 130);
    document.text('Sexo:', 180, 130);
    document.text('Mujer', 220, 130);
    document.text('Edad:', 310, 130);
    document.text('59 año(s)', 350, 130);
    document.text('Cama:', 20, 150);
    document.text('H6C1', 70, 150);
    document.text('Sala:', 190, 150);
    document.text('Habitacion 6', 240, 150);
    document.text('Servicio:', 364, 150);
    document.text('Área Médico Quirúrgica', 414, 150);
    document.text('Diagnóstico(s):', 20, 175);
    document.text('Dolor agudo', 100, 175);
    document.text('Medicamento', 20, 205);
    document.text('Posología e indicaciones', 310, 205);
    document.text('Despacho Farmacia', 500, 205);
    document.line(20, 210, 310, 210);
    document.line(310, 210, 500, 210);
    document.line(500, 210, 590, 210);

    document.text('Losartán 50 mg Comprimidos , vía oral', 20, 222);
    document.text('1/2 comprimido cada 12 horas', 310, 222);
    document.text('Despachado', 500, 222);
    document.text('09-07-2026 11:15', 20, 242);
    document.line(20, 250, 310, 250);
    document.line(310, 250, 500, 250);
    document.line(500, 250, 590, 250);

    document.text('Tramadol Clorhidrato 100 mg/1 ml Solución para', 20, 262);
    document.text('gotas orales, frasco 10 ml', 20, 278);
    document.text(', vía oral', 20, 294);
    document.text('10 gotas cada 8 horas', 310, 262);
    document.text('SOS en caso de dolor', 310, 278);
    document.text('Indicación por Dr. Jofré', 310, 294);
    document.text('Pendiente de despacho', 500, 262);
    document.text('14-07-2026 19:48', 20, 320);
    document.line(20, 330, 310, 330);
    document.line(310, 330, 500, 330);
    document.line(500, 330, 590, 330);

    document.text('Prescriptor:', 20, 380);
    document.text('Elena Diaz', 99, 380);
    document.text('RUN:', 20, 400);
    document.text('19.525.925-9', 99, 400);
    document.text('Fecha:', 427, 380);
    document.text('15-07-2026', 473, 380);
    document.text('Impreso por', 20, 450);
    document.text('Valeria Salfate', 71, 450);

    const content = await prescriptionPrint.extractOfficialPrescriptionContent(
      document.output('arraybuffer')
    );

    expect(content?.medications).toEqual([
      expect.objectContaining({
        medication: 'Losartán 50 mg Comprimidos , vía oral',
        posology: '1/2 comprimido cada 12 horas',
        dispatch: 'Despachado',
        dateTime: '09-07-2026 11:15',
      }),
      expect.objectContaining({
        medication:
          'Tramadol Clorhidrato 100 mg/1 ml Solución para gotas orales, frasco 10 ml , vía oral',
        posology: '10 gotas cada 8 horas SOS en caso de dolor Indicación por Dr. Jofré',
        dispatch: 'Pendiente de despacho',
        dateTime: '14-07-2026 19:48',
      }),
    ]);
  });

  it('fails closed when an official-looking PDF does not prove any medication row', async () => {
    const document = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
    document.text('Nombres:', 20, 110);
    document.text('Paciente Prueba', 70, 110);
    document.text('Diagnóstico(s):', 20, 175);
    document.text('Medicamento', 20, 205);
    document.text('Posología e indicaciones', 310, 205);

    await expect(
      prescriptionPrint.extractOfficialPrescriptionContent(document.output('arraybuffer'))
    ).resolves.toBeNull();
  });

  it('fails closed when an otherwise complete official row has no posology', async () => {
    const document = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
    document.text('Fecha impresión', 434, 30);
    document.text('14-07-2026  23:23', 500, 30);
    document.text('Dirección', 20, 56);
    document.text('Simón Paoa N°S/N', 100, 56);
    document.text('Folio: D292620E', 500, 80);
    document.text('Nombres:', 20, 110);
    document.text('Paciente Prueba', 70, 110);
    document.text('RUN:', 20, 130);
    document.text('8.932.066-6', 90, 130);
    document.text('Sexo:', 180, 130);
    document.text('Mujer', 220, 130);
    document.text('Edad:', 310, 130);
    document.text('59 año(s)', 350, 130);
    document.text('Cama:', 20, 150);
    document.text('H6C1', 70, 150);
    document.text('Sala:', 190, 150);
    document.text('Habitacion 6', 240, 150);
    document.text('Servicio:', 364, 150);
    document.text('Área Médico Quirúrgica', 414, 150);
    document.text('Diagnóstico(s):', 20, 175);
    document.text('Medicamento', 20, 205);
    document.text('Posología e indicaciones', 310, 205);
    document.text('Despacho Farmacia', 500, 205);
    document.line(20, 210, 310, 210);
    document.line(310, 210, 500, 210);
    document.line(500, 210, 590, 210);
    document.text('Losartán 50 mg Comprimidos , vía oral', 20, 220);
    document.text('09-07-2026 11:15', 20, 252);
    document.line(20, 265, 310, 265);
    document.line(310, 265, 500, 265);
    document.line(500, 265, 590, 265);
    document.text('Prescriptor:', 20, 300);
    document.text('Elena Diaz', 99, 300);
    document.text('RUN:', 20, 320);
    document.text('19.525.925-9', 99, 320);
    document.text('Fecha:', 427, 300);
    document.text('15-07-2026', 473, 300);
    document.text('Impreso por', 20, 360);
    document.text('Valeria Salfate', 71, 360);

    await expect(
      prescriptionPrint.extractOfficialPrescriptionContent(document.output('arraybuffer'))
    ).resolves.toBeNull();
  });

  it('derives the current nutrition order without treating archived data as active', () => {
    const regimen = prescriptionPrint.deriveLatestNutritionOrder([
      {
        dietName: 'Común',
        observation: 'Diabético',
        startDateTime: '2026-07-14T08:10:00-06:00',
        authorHealthCarePractitionerName: 'Elena Díaz',
        archived: false,
      },
      {
        dietName: 'Papilla',
        startDateTime: '2026-07-15T08:10:00-06:00',
        archived: true,
      },
    ]);

    expect(regimen).toEqual(
      expect.objectContaining({
        diet: 'Común',
        observation: 'Diabético',
        dateTime: '2026-07-14T08:10:00-06:00',
        author: 'Elena Díaz',
      })
    );
  });

  it('orders instrument history and excludes archived complete forms', () => {
    const history = prescriptionPrint.deriveScaleHistory(
      [
        {
          publishDatetime: '2026-07-14T08:00:00-06:00',
          evaluationInstrumentsResume: [
            { FORM_NAME: 'Escala Braden', LABEL: 'BRAD_Puntaje', VALUE: '16' },
            { FORM_NAME: 'Escala Braden', LABEL: 'BRAD_ResultadoScore', VALUE_NAME: 'Riesgo bajo' },
          ],
        },
      ],
      [
        {
          nameForm: 'Escala Braden',
          createDateTime: '2026-07-15T09:00:00-06:00',
          archived: true,
          metaCampList: [{ id: 'BRAD_Puntaje', value: '8' }],
        },
      ],
      'BRADEN'
    );

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ total: 16, severity: 'Riesgo bajo' });
  });

  it('preserves a numeric zero score and deduplicates the same scale event across endpoints', () => {
    const history = prescriptionPrint.deriveScaleHistory(
      [
        {
          encounterEventId: 123,
          publishDatetime: '2026-07-09T18:20:39-04:00',
          evaluationInstrumentsResume: [
            { FORM_NAME: 'Escala Downton', LABEL: 'DOWNTON_Puntaje', VALUE: 0 },
            {
              FORM_NAME: 'Escala Downton',
              LABEL: 'DOWNTON_ResultadoScore',
              VALUE_NAME: 'Sin riesgo',
            },
          ],
        },
      ],
      [
        {
          nameForm: 'Escala Downton',
          createDateTime: '09-07-2026 18:20:39',
          authorHealthCarePractitionerName: 'Valeria Salfate',
          metaCampList: [
            { id: 'DOWNTON_Puntaje', value: 0 },
            { id: 'DOWNTON_ResultadoScore', valueName: 'Sin riesgo' },
          ],
        },
      ],
      'DOWNTON'
    );

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ total: 0, severity: 'Sin riesgo' });
  });

  it('keeps distinct score applications that share a timestamp but have different totals', () => {
    const history = prescriptionPrint.deriveScaleHistory(
      [
        {
          publishDatetime: '2026-07-15T08:00:00-04:00',
          evaluationInstrumentsResume: [
            { FORM_NAME: 'Escala Braden', LABEL: 'BRAD_Puntaje', VALUE: 12 },
            { FORM_NAME: 'Escala Braden', LABEL: 'BRAD_ResultadoScore', VALUE_NAME: 'Riesgo alto' },
          ],
        },
      ],
      [
        {
          nameForm: 'Escala Braden',
          createDateTime: '15-07-2026 08:00:00',
          metaCampList: [
            { id: 'BRAD_Puntaje', value: 16 },
            { id: 'BRAD_ResultadoScore', valueName: 'Riesgo bajo' },
          ],
        },
      ],
      'BRADEN'
    );

    expect(history.map(item => item.total).sort()).toEqual([12, 16]);
  });

  it('selects the latest nursing handoff and calculates the official CUDYR category', () => {
    const handoff = prescriptionPrint.deriveLatestShiftChange([
      {
        id: 1,
        encounterEventTypeId: 2,
        observation: 'Paciente estable',
        startDateTime: '2026-07-14T19:00:00-06:00',
        authorHealthCarePractitionerName: 'Valeria Salfate',
        isSigned: true,
      },
      {
        id: 2,
        encounterEventTypeId: 2,
        observation: 'Sin novedades durante la noche',
        startDateTime: '2026-07-15T07:00:00-06:00',
        authorHealthCarePractitionerName: 'Camila Rojas',
      },
      {
        id: 3,
        encounterEventTypeId: 1,
        observation: 'Nota médica',
        startDateTime: '2026-07-15T08:00:00-06:00',
      },
    ]);

    expect(handoff).toMatchObject({
      observation: 'Sin novedades durante la noche',
      author: 'Camila Rojas',
      isSigned: false,
    });
    expect(
      prescriptionPrint.calculateCudyrCategory([
        { typeId: 1, value: 3 },
        { typeId: 1, value: 3 },
        { typeId: 1, value: 3 },
        { typeId: 2, value: 3 },
        { typeId: 2, value: 3 },
        { typeId: 2, value: 3 },
        { typeId: 2, value: 3 },
        { typeId: 2, value: 3 },
      ])
    ).toEqual({ dependency: 9, risk: 15, value: 'B2' });
  });
});
