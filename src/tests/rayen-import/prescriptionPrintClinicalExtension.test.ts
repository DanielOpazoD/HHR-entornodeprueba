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
