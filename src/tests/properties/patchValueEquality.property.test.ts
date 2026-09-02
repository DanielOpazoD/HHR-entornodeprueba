import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { clinicalValuesEqual } from '@/features/rayen-import/domain/clinicalIncrementalSync';
import { arePatchValuesDeepEqual } from '@/utils/patchValueEquality';
import { patchObjectArb, patchValueArb } from '@/tests/properties/arbitraries';

/**
 * `arePatchValuesDeepEqual` decide qué campos del censo NO se escriben (Fase
 * 2, #293). Si dijera «igual» de más, se perderían ediciones; si dijera
 * «distinto» de más, volverían los reenvíos completos y los splits
 * clínico/estructural innecesarios. Las propiedades fijan que es una
 * igualdad de verdad (reflexiva, simétrica) y que coincide con la ÚNICA otra
 * noción de igualdad de valores que tiene la app: la canonicalización
 * clínica del checkpoint incremental (`clinicalValuesEqual`), que también
 * trata `undefined` como clave ausente.
 */

const stripUndefinedKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripUndefinedKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, stripUndefinedKeys(item)])
  );
};

const withUndefinedNoise = (
  value: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> =>
  keys.reduce((acc, key) => (key in acc ? acc : { ...acc, [key]: undefined }), { ...value });

describe('arePatchValuesDeepEqual · propiedades', () => {
  it('es reflexiva sobre una copia estructural y simétrica sobre pares arbitrarios', () => {
    fc.assert(
      fc.property(patchValueArb, patchValueArb, (a, b) => {
        expect(arePatchValuesDeepEqual(a, structuredClone(a))).toBe(true);
        expect(arePatchValuesDeepEqual(a, b)).toBe(arePatchValuesDeepEqual(b, a));
      })
    );
  });

  it('coincide con la canonicalización clínica del checkpoint (una sola noción de igualdad)', () => {
    fc.assert(
      fc.property(patchValueArb, patchValueArb, (a, b) => {
        expect(arePatchValuesDeepEqual(a, b)).toBe(clinicalValuesEqual(a, b));
      })
    );
  });

  it('una clave con undefined equivale a una clave ausente, a cualquier profundidad', () => {
    fc.assert(
      fc.property(
        patchObjectArb,
        fc.array(fc.stringMatching(/^[a-z]{1,4}$/), { maxLength: 3 }),
        (object, noiseKeys) => {
          expect(arePatchValuesDeepEqual(object, stripUndefinedKeys(object))).toBe(true);
          expect(arePatchValuesDeepEqual(object, withUndefinedNoise(object, noiseKeys))).toBe(true);
        }
      )
    );
  });

  it('un valor presente (null, "" o false incluido) nunca equivale a la clave ausente', () => {
    fc.assert(
      fc.property(
        patchObjectArb,
        fc.stringMatching(/^[a-z]{1,4}$/),
        fc.oneof(fc.constant(null), fc.constant(''), fc.constant(false), fc.constant(0)),
        (object, key, presentValue) => {
          const without = { ...object };
          delete without[key];
          expect(arePatchValuesDeepEqual({ ...without, [key]: presentValue }, without)).toBe(false);
        }
      )
    );
  });
});
