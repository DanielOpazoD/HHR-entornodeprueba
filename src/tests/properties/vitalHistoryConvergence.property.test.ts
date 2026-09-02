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
 *
 * Dos límites documentados del módulo que las propiedades respetan en vez de
 * enshrinar al revés: (1) compara el historial como CONJUNTO antes de
 * escribir, así que un historial legacy con los mismos elementos desordenados
 * no se reescribe solo por el orden; (2) dos tomas legacy (sin id) con el
 * mismo instante no tienen desempate, y entre ellas el orden sigue al lote.
 */

const basePatient = { bedId: 'R1', patientName: 'Paciente propiedad' } as unknown as PatientData;

const MAX_HISTORY = 48;

const withHistory = (history: PatientVitalSigns[]): PatientData =>
  ({ ...basePatient, vitalSignsHistory: history, vitalSigns: history[0] }) as PatientData;

/** Instante clínico documentado: día calendario y hora de la toma. */
const instantOf = (record: PatientVitalSigns): string =>
  `${record.recordedDate}|${record.recordedAt}`;

/** Definición documentada de «vital central» que alimenta la celda del censo. */
const hasCoreVital = (record: PatientVitalSigns): boolean =>
  record.systolic != null ||
  record.heartRate != null ||
  record.spo2 != null ||
  record.temperature != null;

const historyOf = (patient: PatientData): PatientVitalSigns[] => patient.vitalSignsHistory ?? [];

const byStorageKey = (records: PatientVitalSigns[]): PatientVitalSigns[] =>
  [...records].sort((left, right) => vitalStorageKey(left).localeCompare(vitalStorageKey(right)));

const expectBoundedCleanHistory = (history: PatientVitalSigns[]): void => {
  expect(history.length).toBeLessThanOrEqual(MAX_HISTORY);
  expect(new Set(history.map(vitalStorageKey)).size).toBe(history.length);
  history.forEach(record => expect(record.recordedDate <= CENSUS_ISO_DAY).toBe(true));
};

const expectNonIncreasingInstants = (history: PatientVitalSigns[]): void => {
  for (let index = 1; index < history.length; index += 1) {
    expect(
      instantOf(history[index - 1]).localeCompare(instantOf(history[index]))
    ).toBeGreaterThanOrEqual(0);
  }
};

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

  it('el conjunto de tomas y su secuencia de instantes no dependen del orden en que Eloísa las entregue', () => {
    // Entre dos tomas legacy con el MISMO instante no hay desempate (límite
    // documentado arriba): se compara el conjunto y la secuencia de instantes,
    // no la lista literal.
    fc.assert(
      fc.property(
        storedPatientArb,
        vitalBatchArb().chain(batch => fc.tuple(fc.constant(batch), shuffledArb(batch))),
        (stored, [incoming, shuffled]) => {
          const expected = mergeReportVitals(stored, incoming, CENSUS_ISO_DAY);
          const actual = mergeReportVitals(stored, shuffled, CENSUS_ISO_DAY);

          expect(byStorageKey(historyOf(actual))).toEqual(byStorageKey(historyOf(expected)));
          expect(historyOf(actual).map(instantOf)).toEqual(historyOf(expected).map(instantOf));
          expect(actual.vitalSigns && instantOf(actual.vitalSigns)).toEqual(
            expected.vitalSigns && instantOf(expected.vitalSigns)
          );
        }
      )
    );
  });

  it('sobre un estado ya canónico, el historial queda acotado, ordenado por instante, sin futuro y sin duplicados', () => {
    fc.assert(
      fc.property(storedPatientArb, vitalBatchArb(30), (stored, incoming) => {
        const history = historyOf(mergeReportVitals(stored, incoming, CENSUS_ISO_DAY));
        expectBoundedCleanHistory(history);
        expectNonIncreasingInstants(history);
      })
    );
  });

  it('sanea un estado previo contaminado (futuro, duplicados, exceso) y solo reordena cuando escribe', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(legacyVitalArb, sourcedVitalArb), { maxLength: 70 }),
        vitalBatchArb(30),
        (rawStored, incoming) => {
          // Un registro histórico sincronizado tarde puede traer un historial
          // desordenado, con tomas futuras o duplicadas, o por sobre la cota.
          const before = withHistory(rawStored);
          const result = mergeReportVitals(before, incoming, CENSUS_ISO_DAY);
          const history = historyOf(result);

          expectBoundedCleanHistory(history);
          // Si el conjunto no cambió, el módulo no escribe (y no reordena):
          // el orden solo se garantiza cuando hubo escritura.
          if (result !== before) expectNonIncreasingInstants(history);
        }
      )
    );
  });

  it('Eloísa manda sobre un id estable: la toma entrante reemplaza a la guardada, o la retira si se movió al futuro', () => {
    fc.assert(
      fc.property(
        storedPatientArb,
        // Hasta 60: por sobre la cota, una toma legítima puede quedar fuera del
        // historial (se conservan las 48 más recientes) — de ahí la guarda.
        fc.uniqueArray(sourcedVitalArb, { selector: vital => vital.sourceEventId, maxLength: 60 }),
        (stored, incoming) => {
          const history = historyOf(mergeReportVitals(stored, incoming, CENSUS_ISO_DAY));
          const byEvent = new Map(history.map(record => [record.sourceEventId, record]));

          incoming.forEach(record => {
            const storedVersion = byEvent.get(record.sourceEventId);
            if (record.recordedDate > CENSUS_ISO_DAY) {
              expect(storedVersion).toBeUndefined();
            } else if (history.length < MAX_HISTORY) {
              expect(storedVersion).toBe(record);
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
    // Se mantiene bajo la cota a propósito (≤ 10 + 20 < 48): con truncación,
    // el elemento 49 de una pasada parcial puede diferir del de la completa.
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

  it('la lectura de la celda es una toma del historial con vital central sin otra más reciente que lo tenga, y solo falta con historial vacío', () => {
    fc.assert(
      fc.property(storedPatientArb, vitalBatchArb(), (stored, incoming) => {
        const result = mergeReportVitals(stored, incoming, CENSUS_ISO_DAY);
        const history = historyOf(result);
        const glance = result.vitalSigns;

        if (history.length === 0) {
          expect(glance).toBeUndefined();
          return;
        }
        expect(glance).toBeDefined();
        const index = history.indexOf(glance as PatientVitalSigns);
        expect(index).toBeGreaterThanOrEqual(0);
        if (hasCoreVital(glance as PatientVitalSigns)) {
          expect(history.slice(0, index).some(hasCoreVital)).toBe(false);
        } else {
          expect(history.some(hasCoreVital)).toBe(false);
          expect(index).toBe(0);
        }
      })
    );
  });
});
