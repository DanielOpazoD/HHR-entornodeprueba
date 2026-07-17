// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { prescriptionPrint } from './prescriptionPrintTestHarness';

describe('extension prescription operations', () => {
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

  it('keeps a prescription batch valid only for its verified session lifetime', () => {
    const now = Date.parse('2026-07-16T12:00:00Z');
    const batch = { sessionKey: 'tab-4:session-a', expiresAt: now + 60_000 };

    expect(prescriptionPrint.isPrescriptionBatchSessionValid(batch, 'tab-4:session-a', now)).toBe(
      true
    );
    expect(
      prescriptionPrint.isPrescriptionBatchSessionValid(batch, 'tab-4:session-a', now + 60_000)
    ).toBe(false);
    expect(prescriptionPrint.isPrescriptionBatchSessionValid(batch, 'tab-4:session-b', now)).toBe(
      false
    );
    expect(
      prescriptionPrint.isPrescriptionBatchSessionValid(
        { sessionKey: 'tab-4:session-a', expiresAt: null },
        'tab-4:session-a',
        now + 24 * 60 * 60_000
      )
    ).toBe(true);
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
});
