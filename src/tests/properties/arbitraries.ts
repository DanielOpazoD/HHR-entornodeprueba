import * as fc from 'fast-check';

import type { PatientVitalSigns } from '@/types/domain/vitalSigns';

/**
 * Generadores compartidos por los tests de convergencia por propiedades.
 * Modelan datos con la FORMA que produce la app (valores JSON planos con
 * `undefined` como «clave ausente», tomas de signos vitales de Eloísa), no
 * datos arbitrarios: la meta es cubrir la clase de entradas real, no todo
 * lo que TypeScript admite.
 */

const keyArb = fc.stringMatching(/^[a-z]{1,4}$/);

const scalarArb = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer({ min: -1000, max: 1000 }),
  fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 }),
  fc.string({ maxLength: 6 })
);

/**
 * Valor de PARCHE del registro diario: primitivos, arreglos y objetos
 * simples; dentro de un objeto una clave puede valer `undefined` (borrado).
 */
export const patchValueArb: fc.Arbitrary<unknown> = fc.letrec<{ value: unknown; member: unknown }>(
  tie => ({
    value: fc.oneof(
      { depthSize: 'small', maxDepth: 3 },
      scalarArb,
      fc.array(tie('value'), { maxLength: 4 }),
      fc.dictionary(keyArb, tie('member'), { maxKeys: 4 })
    ),
    member: fc.oneof(tie('value'), fc.constant(undefined)),
  })
).value;

/** Objeto plano (raíz siempre objeto) con posibles claves `undefined`. */
export const patchObjectArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(
  keyArb,
  fc.oneof(patchValueArb, fc.constant(undefined)),
  { maxKeys: 5 }
);

export const CENSUS_ISO_DAY = '2026-07-11';
/** Dos días antes, el día previo, el día del censo y un día FUTURO (debe filtrarse). */
export const VITAL_DAYS = ['2026-07-09', '2026-07-10', CENSUS_ISO_DAY, '2026-07-12'] as const;

const pad = (value: number): string => String(value).padStart(2, '0');

const nullableInt = (min: number, max: number) =>
  fc.option(fc.integer({ min, max }), { nil: null });

const vitalBodyArb = fc.record({
  recordedDate: fc.constantFrom(...VITAL_DAYS),
  hour: fc.integer({ min: 0, max: 23 }),
  minute: fc.integer({ min: 0, max: 59 }),
  systolic: nullableInt(60, 220),
  diastolic: nullableInt(30, 130),
  heartRate: nullableInt(30, 200),
  spo2: nullableInt(70, 100),
  temperature: fc.option(
    fc.integer({ min: 340, max: 420 }).map(tenths => tenths / 10),
    { nil: null }
  ),
  respiratoryRate: nullableInt(8, 60),
  painEva: nullableInt(0, 10),
  hgt: nullableInt(40, 500),
  insulinUnits: nullableInt(0, 30),
  insulinQuadrant: fc.option(fc.constantFrom('CSI', 'CSD', 'CII', 'CID'), { nil: null }),
  observations: fc.option(fc.string({ maxLength: 12 }), { nil: null }),
  author: fc.constantFrom('', 'TENS Pérez', 'EU Soto'),
  authorRole: fc.constantFrom('', 'Paramédico', 'Enfermera(o)'),
});

type VitalBody = Omit<PatientVitalSigns, 'recordedAt' | 'sourceEventId'> & {
  hour: number;
  minute: number;
};

const toVital = (body: VitalBody): PatientVitalSigns => {
  const { hour, minute, ...rest } = body;
  return { ...rest, recordedAt: `${rest.recordedDate} ${pad(hour)}:${pad(minute)}` };
};

/** Toma SIN identidad estable (registros previos a la sincronización incremental). */
export const legacyVitalArb: fc.Arbitrary<PatientVitalSigns> = vitalBodyArb.map(toVital);

/** Toma CON `sourceEventId` (identidad estable de Eloísa). */
export const sourcedVitalArb: fc.Arbitrary<PatientVitalSigns> = fc
  .tuple(vitalBodyArb, fc.integer({ min: 1, max: 60 }))
  .map(([body, eventNumber]) => ({ ...toVital(body), sourceEventId: `ev-${eventNumber}` }));

/** Identidad de contenido (lo que distingue a dos tomas legacy). */
export const vitalContentKey = (record: PatientVitalSigns): string => {
  const { sourceEventId: _ignored, ...content } = record;
  return JSON.stringify(content);
};

/** Identidad con la que la app almacena la toma: evento estable o contenido. */
export const vitalStorageKey = (record: PatientVitalSigns): string =>
  record.sourceEventId ? `event:${record.sourceEventId}` : `legacy:${vitalContentKey(record)}`;

/**
 * Lote homogéneo tal como lo produce el parser de Eloísa: o todas las tomas
 * traen id estable (desde la sincronización incremental) o ninguna (legacy).
 * Sin repetir identidad dentro del lote, que es lo que el parser garantiza.
 */
export const vitalBatchArb = (maxLength = 12): fc.Arbitrary<PatientVitalSigns[]> =>
  fc.oneof(
    fc.uniqueArray(sourcedVitalArb, { selector: vital => vital.sourceEventId, maxLength }),
    fc.uniqueArray(legacyVitalArb, { selector: vitalContentKey, maxLength })
  );

/** Barajado determinista bajo el control de fast-check (para probar independencia del orden). */
export const shuffledArb = <T>(items: readonly T[]): fc.Arbitrary<T[]> =>
  fc.shuffledSubarray([...items], { minLength: items.length, maxLength: items.length });
