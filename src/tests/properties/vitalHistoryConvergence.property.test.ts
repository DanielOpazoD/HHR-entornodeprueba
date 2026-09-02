import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { mergeReportVitals } from '@/features/rayen-import';
import type { PatientData } from '@/types/domain/patient';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';
import {
  CENSUS_ISO_DAY,
  legacyVitalArb,
  shuffledArb,
  sourcedVitalArb,
  vitalBatchArb,
  vitalStorageKey,
} from '@/tests/properties/arbitraries';

/**
 * El historial de signos vitales converge por re-sincronización: #294 confió
 * en que «los datos ya guardados se sanan al re-sincronizar» porque
 * `mergeVitalHistory` reemplaza por id estable. Estas propiedades fijan esa
 * garantía para CUALQUIER combinación de tomas (no solo los casos reportados):
 * idempotencia, independencia del orden del lote, cota y orden del historial,
 * autoridad de Eloísa sobre un id estable, y que sincronizar por partes
 * equivale a sincronizar todo de una vez.
 */

const basePatient = { bedId: 'R1', patientName: 'Paciente propiedad' } as unknown as PatientData;

const MAX_HISTORY = 48;

const withHistory = (history: PatientVitalSigns[]): PatientData =>
  ({ ...basePatient, vitalSignsHistory: history, vitalSigns: history[0] }) as PatientData;

/** Orden clínico del historial, tal como lo documenta el módulo: fecha, hora, id (desempate). */
const clinicalOrderKey = (record: PatientVitalSigns): string =>
  `${record.recordedDate}|${record.recordedAt}|${record.sourceEventId?.padStart(20, '0') ?? ''}`;

const hasCoreVital = (record: PatientVitalSigns): boolean =>
  record.systolic != null ||
  record.heartRate != null ||
  record.spo2 != null ||
  record.temperature != null;

const historyOf = (patient: PatientData): PatientVitalSigns[] => patient.vitalSignsHistory ?? [];

const uniqueStorageKeys = (records: PatientVitalSigns[]): boolean =>
  new Set(records.map(vitalStorageKey)).size === records.length;

/** Estado previo realista: lo que la app ya guardó tras una sincronización anterior. */
const storedPatientArb = vitalBatchArb(10).map(previous =>
  mergeReportVitals(basePatient, previous, CENSUS_ISO_DAY)
);

describe('mergeReportVitals · convergencia del historial', () => {
  it('es idempotente: repetir el mismo lote devuelve el MISMO objeto (sin escritura)', () => {
    fc.assert(
      fc.property(storedPatientArb, vitalBatchArb(), (stored, incoming) => {
        const once = mergeReportVitals(stored, incoming, CENSUS_ISO_DAY);
        expect(mergeReportVitals(once, incoming, CENSUS_ISO_DAY)).toBe(once);
      })
    );
  });

  it('no depende del orden en que Eloísa entregue las tomas', () => {
    fc.assert(
      fc.property(
        storedPatientArb,
        vitalBatchArb().chain(batch => fc.tuple(fc.constant(batch), shuffledArb(batch))),
        (stored, [incoming, shuffled]) => {
          const expected = mergeReportVitals(stored, incoming, CENSUS_ISO_DAY);
          const actual = mergeReportVitals(stored, shuffled, CENSUS_ISO_DAY);
          expect(historyOf(actual)).toEqual(historyOf(expected));
          expect(actual.vitalSigns).toEqual(expected.vitalSigns);
        }
      )
    );
  });

  it('el historial queda acotado, ordenado por instante clínico, sin futuro y sin duplicados', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(legacyVitalArb, sourcedVitalArb), { maxLength: 70 }),
        vitalBatchArb(30),
        (rawStored, incoming) => {
          // El estado previo puede venir desordenado o con tomas futuras
          // (registro histórico sincronizado tarde): el merge lo sanea.
          const result = mergeReportVitals(withHistory(rawStored), incoming, CENSUS_ISO_DAY);
          const history = historyOf(result);

          expect(history.length).toBeLessThanOrEqual(MAX_HISTORY);
          expect(uniqueStorageKeys(history)).toBe(true);
          history.forEach(record => expect(record.recordedDate <= CENSUS_ISO_DAY).toBe(true));
          for (let index = 1; index < history.length; index += 1) {
            expect(
              clinicalOrderKey(history[index - 1]).localeCompare(clinicalOrderKey(history[index]))
            ).toBeGreaterThanOrEqual(0);
          }
        }
      )
    );
  });

  it('Eloísa manda sobre un id estable: la toma entrante reemplaza a la guardada, o la retira si se movió al futuro', () => {
    fc.assert(
      fc.property(
        storedPatientArb,
        fc.uniqueArray(sourcedVitalArb, { selector: vital => vital.sourceEventId, maxLength: 12 }),
        (stored, incoming) => {
          const history = historyOf(mergeReportVitals(stored, incoming, CENSUS_ISO_DAY));
          const byEvent = new Map(history.map(record => [record.sourceEventId, record]));

          incoming.forEach(record => {
            const storedVersion = byEvent.get(record.sourceEventId);
            if (record.recordedDate > CENSUS_ISO_DAY) {
              expect(storedVersion).toBeUndefined();
            } else if (history.length < MAX_HISTORY) {
              expect(storedVersion).toEqual(record);
            }
          });
        }
      )
    );
  });

  it('sincronizar en dos pasadas converge al mismo historial que una sola pasada completa', () => {
    // Es el caso real de una corrección incremental: la ventana corta de hoy
    // (B) sobre lo que ya trajo la ventana larga de ayer (A). Los ids de A y
    // B son distintos porque el parser no repite eventos entre ventanas.
    const splitBatchArb = fc
      .uniqueArray(sourcedVitalArb, { selector: vital => vital.sourceEventId, maxLength: 20 })
      .chain(all =>
        fc
          .integer({ min: 0, max: all.length })
          .map(cut => [all.slice(0, cut), all.slice(cut)] as const)
      );

    fc.assert(
      fc.property(storedPatientArb, splitBatchArb, (stored, [first, second]) => {
        const stepwise = mergeReportVitals(
          mergeReportVitals(stored, first, CENSUS_ISO_DAY),
          second,
          CENSUS_ISO_DAY
        );
        const atOnce = mergeReportVitals(stored, [...first, ...second], CENSUS_ISO_DAY);

        expect(historyOf(stepwise)).toEqual(historyOf(atOnce));
        expect(stepwise.vitalSigns).toEqual(atOnce.vitalSigns);
      })
    );
  });

  it('la lectura de la celda es la toma más reciente con un vital central, y solo falta si el historial está vacío', () => {
    fc.assert(
      fc.property(storedPatientArb, vitalBatchArb(), (stored, incoming) => {
        const result = mergeReportVitals(stored, incoming, CENSUS_ISO_DAY);
        const history = historyOf(result);
        const expectedGlance = history.find(hasCoreVital) ?? history[0];

        expect(result.vitalSigns).toEqual(expectedGlance);
        expect(result.vitalSigns === undefined).toBe(history.length === 0);
      })
    );
  });
});
