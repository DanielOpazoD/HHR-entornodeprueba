// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { prescriptionPrint } from './prescriptionPrintTestHarness';

describe('extension prescription operations', () => {
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

  it('partitions medical and nursing handoffs by the official event type and calculates CUDYR', () => {
    const handoff = prescriptionPrint.deriveLatestShiftChange(
      [
        {
          id: 1,
          encounterEventTypeId: 2,
          observation: 'Paciente estable',
          startDateTime: '2026-07-14T19:00:00-06:00',
          authorHealthCarePractitionerName: 'Valeria Salfate',
          authorHealthCarePractitionerRoleId: 2,
          isSigned: true,
        },
        {
          id: 2,
          encounterEventTypeId: 2,
          observation: 'Sin novedades durante la noche',
          startDateTime: '2026-07-15T07:00:00-06:00',
          authorHealthCarePractitionerName: 'Camila Rojas',
          authorHealthCarePractitionerRoleId: 2,
        },
        {
          id: 4,
          encounterEventTypeId: 1,
          observation: 'Evolución médica más reciente',
          startDateTime: '2026-07-15T09:00:00-06:00',
          authorHealthCarePractitionerName: 'Daniel Opazo',
          authorHealthCarePractitionerRoleId: 1,
        },
        {
          id: 3,
          encounterEventTypeId: 1,
          observation: 'Nota médica',
          startDateTime: '2026-07-15T08:00:00-06:00',
        },
      ],
      { kind: 'nursing' }
    );

    expect(handoff).toMatchObject({
      observation: 'Sin novedades durante la noche',
      author: 'Camila Rojas',
      isSigned: false,
      handoffKind: 'nursing',
    });
    expect(prescriptionPrint.resolveHandoffKind('Médico', '1')).toBe('medical');
    expect(prescriptionPrint.resolveHandoffKind('Enfermera', '2')).toBe('nursing');
    expect(prescriptionPrint.resolveHandoffKind('Tecnólogo Médico', '3')).toBe('');
    expect(prescriptionPrint.resolveHandoffKind('Paramédico', '3')).toBe('');
    expect(prescriptionPrint.resolveHandoffKind('Cirujano Dentista', '1')).toBe('');
    expect(prescriptionPrint.resolveHandoffKind('Médico', '3')).toBe('');
    expect(prescriptionPrint.resolveHandoffKind('Enfermera', '7')).toBe('');
    expect(prescriptionPrint.resolveHandoffKind('Médico', '')).toBe('medical');
    expect(prescriptionPrint.handoffLabelForIdentity('Médico', '1')).toBe(
      'Entrega de turno médica'
    );
    expect(prescriptionPrint.handoffLabelForIdentity('Enfermera', '2')).toBe(
      'Entrega de turno de enfermería'
    );
    expect(prescriptionPrint.handoffLabelForIdentity('Tecnólogo Médico', '3')).toBe(
      'Entrega de turno según rol clínico'
    );
    expect(prescriptionPrint.handoffLabelForIdentity('Cirujano Dentista', '1')).toBe(
      'Entrega de turno según rol clínico'
    );
    expect(prescriptionPrint.handoffLabelForIdentity('Médico', '3')).toBe(
      'Entrega de turno según rol clínico'
    );
    expect(
      prescriptionPrint.cudyrSourceNotice({
        cudyrSource: 'gestion_camas+ficha_medico',
        cudyrHistoryAvailable: true,
        cudyrWarning: 'No fue posible atribuir todos los autores.',
      })
    ).toContain('No fue posible atribuir todos los autores.');
    expect(
      prescriptionPrint.cudyrSourceNotice({
        cudyrSource: 'gestion_camas',
        cudyrHistoryAvailable: true,
        cudyrWarning: 'Definiciones incompletas.',
      })
    ).toContain('Definiciones incompletas.');
    expect(prescriptionPrint.handoffEncounterEventTypeId('medical')).toBe(1);
    expect(prescriptionPrint.handoffEncounterEventTypeId('nursing')).toBe(2);
    expect(
      prescriptionPrint.deriveLatestShiftChange(
        [
          {
            id: 4,
            encounterEventTypeId: 1,
            observation: 'Evolución médica más reciente',
            startDateTime: '2026-07-15T09:00:00-06:00',
            authorHealthCarePractitionerRoleId: 1,
          },
        ],
        { kind: 'medical' }
      )?.observation
    ).toBe('Evolución médica más reciente');
    expect(
      prescriptionPrint.deriveLatestShiftChange(
        [
          {
            id: 5,
            encounterEventTypeId: 3,
            observation: 'Otro evento clínico',
            startDateTime: '2026-07-15T10:00:00-06:00',
            authorHealthCarePractitionerRoleId: 1,
          },
        ],
        { kind: 'medical' }
      )
    ).toBeNull();
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
