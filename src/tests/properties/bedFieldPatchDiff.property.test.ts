import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import { BEDS } from '@/constants/beds';
import { clinicalValuesEqual } from '@/features/rayen-import/domain/clinicalIncrementalSync';
import {
  buildUpdatePatientPatches,
  filterUnchangedBedFieldPatches,
} from '@/hooks/controllers/bedManagementPatchController';
import { isUpcEligibleBedId, resolveNormalizedUpcFlag } from '@/shared/census/upcBedPolicy';
import { DataFactory } from '@/tests/factories/DataFactory';
import { patchValueArb } from '@/tests/properties/arbitraries';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus } from '@/types/domain/patientClassification';
import { arePatchValuesDeepEqual } from '@/utils/patchValueEquality';

/**
 * Contrato de diff del guardado de paciente (Fase 2, #293) como propiedades:
 * un reenvío del paciente completo no escribe nada, un cambio real viaja
 * solo, el filtro es idempotente, no inventa ni pierde cambios, respeta el
 * acompañamiento UPC que exige el servidor, y —la garantía de fondo—
 * aplicar el parche filtrado deja el registro EXACTAMENTE igual que aplicar
 * el parche completo. Las sagas #282–#290 fueron casos particulares de
 * violar alguna de estas cinco frases.
 */

const RECORD_DATE = '2026-04-20';

const PLAIN_KEYS = [
  'age',
  'pathology',
  'diagnosisComments',
  'status',
  'hasWristband',
  'surgicalComplication',
  'devices',
  'isIsolated',
  'admissionDate',
  'treatingPhysicianName',
  'insurance',
  'isUPC',
] as const;

type PlainKey = (typeof PLAIN_KEYS)[number];

const bedIdArb = fc.constantFrom(...BEDS.map(bed => bed.id));

/**
 * Campos «planos» de un paciente CONSISTENTE: sin cambio de identidad ni de
 * especialidad (que disparan limpiezas legítimas) y con isUPC coherente con
 * la elegibilidad de la cama (el filtro re-ancla isUPC normalizado).
 */
const plainFieldsArb = (bedId: string) =>
  fc.record({
    age: fc.integer({ min: 0, max: 99 }).map(String),
    pathology: fc.string({ maxLength: 10 }),
    diagnosisComments: fc.option(fc.string({ maxLength: 10 }), { nil: undefined }),
    status: fc.constantFrom(PatientStatus.ESTABLE, PatientStatus.DE_CUIDADO, PatientStatus.GRAVE),
    hasWristband: fc.boolean(),
    surgicalComplication: fc.boolean(),
    devices: fc.uniqueArray(fc.constantFrom('VVP', 'CVC', 'CUP', 'VMI', 'SNG'), { maxLength: 3 }),
    isIsolated: fc.option(fc.boolean(), { nil: undefined }),
    admissionDate: fc.constantFrom('2026-04-18', '2026-04-19', RECORD_DATE),
    treatingPhysicianName: fc.option(fc.constantFrom('Dra. Araya', 'Dr. Tuki'), { nil: undefined }),
    insurance: fc.option(fc.constantFrom('Fonasa', 'Isapre', 'Particular'), { nil: undefined }),
    isUPC: isUpcEligibleBedId(bedId) ? fc.boolean() : fc.constant(false),
  });

interface CensusState {
  record: DailyRecord;
  bedId: string;
}

const stateArb: fc.Arbitrary<CensusState> = bedIdArb.chain(bedId =>
  plainFieldsArb(bedId).map(fields => {
    const record = DataFactory.createMockDailyRecord(RECORD_DATE);
    record.beds[bedId] = DataFactory.createMockPatient(bedId, fields);
    return { record, bedId };
  })
);

const currentPatientOf = ({ record, bedId }: CensusState): Record<string, unknown> =>
  record.beds[bedId] as unknown as Record<string, unknown>;

const readPath = (root: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((node, segment) => {
    if (node === null || typeof node !== 'object') return undefined;
    return (node as Record<string, unknown>)[segment];
  }, root);

/** Aplica un parche plano (rutas con puntos) como lo haría la persistencia: undefined = borrar. */
const applyFlatPatch = (record: DailyRecord, patch: Record<string, unknown>): DailyRecord => {
  const next = structuredClone(record) as unknown as Record<string, unknown>;
  Object.entries(patch).forEach(([path, value]) => {
    const segments = path.split('.');
    const last = segments.pop() as string;
    let node: Record<string, unknown> | undefined = next;
    for (const segment of segments) {
      const child = node?.[segment];
      if (child === null || typeof child !== 'object') {
        if (value === undefined) return; // borrar algo que no existe: no-op
        const created: Record<string, unknown> = {};
        (node as Record<string, unknown>)[segment] = created;
        node = created;
      } else {
        node = child as Record<string, unknown>;
      }
    }
    if (value === undefined) delete (node as Record<string, unknown>)[last];
    else (node as Record<string, unknown>)[last] = value;
  });
  return next as unknown as DailyRecord;
};

const flatPatchArb = (state: CensusState): fc.Arbitrary<Record<string, unknown>> => {
  const { record, bedId } = state;
  const otherBedId = BEDS.find(bed => bed.id !== bedId)?.id ?? bedId;
  const pathArb = fc.oneof(
    fc.constantFrom<string>(...PLAIN_KEYS, 'upcChecklist').map(key => `beds.${bedId}.${key}`),
    fc.constant(`bedTypeOverrides.${bedId}`),
    fc.constantFrom(
      'nursesDayShift',
      `beds.${otherBedId}.age`,
      `beds.${bedId}.clinicalCrib.patientName`
    )
  );
  const entryArb = pathArb.chain(path =>
    fc.tuple(
      fc.constant(path),
      fc.oneof(
        fc.constant(structuredClone(readPath(record, path))), // reenvío sin cambio
        patchValueArb, // cambio arbitrario
        fc.constantFrom<unknown>('UCI', 'UTI', undefined, true, false) // valores típicos
      )
    )
  );
  return fc
    .uniqueArray(entryArb, { selector: ([path]) => path, maxLength: 8 })
    .map(entries => Object.fromEntries(entries));
};

describe('buildUpdatePatientPatches · reenvío del paciente', () => {
  it('reenviar cualquier subconjunto de campos sin cambios no escribe nada', () => {
    fc.assert(
      fc.property(
        stateArb.chain(state => fc.tuple(fc.constant(state), fc.subarray([...PLAIN_KEYS]))),
        ([state, keys]) => {
          const current = currentPatientOf(state);
          const resend = Object.fromEntries(
            keys.map(key => [key, structuredClone(current[key])])
          ) as Partial<PatientData>;

          expect(buildUpdatePatientPatches(state.record, state.bedId, resend)).toStrictEqual({});
        }
      )
    );
  });

  it('un único cambio real viaja solo, con su valor, aunque venga con el resto del paciente', () => {
    const changeArb = stateArb.chain(state =>
      fc
        .tuple(
          fc.constant(state),
          fc.constantFrom<PlainKey>(...PLAIN_KEYS),
          plainFieldsArb(state.bedId),
          fc.subarray([...PLAIN_KEYS])
        )
        .filter(
          ([{ record, bedId }, key, fresh]) =>
            !arePatchValuesDeepEqual(
              fresh[key],
              (record.beds[bedId] as unknown as Record<string, unknown>)[key]
            )
        )
    );

    fc.assert(
      fc.property(changeArb, ([state, key, fresh, resendKeys]) => {
        const current = currentPatientOf(state);
        const updates = {
          ...Object.fromEntries(
            resendKeys.filter(k => k !== key).map(k => [k, structuredClone(current[k])])
          ),
          [key]: fresh[key],
        } as Partial<PatientData>;

        const patch = buildUpdatePatientPatches(state.record, state.bedId, updates);
        const path = `beds.${state.bedId}.${key}`;

        expect(Object.keys(patch)).toStrictEqual([path]);
        expect(arePatchValuesDeepEqual((patch as Record<string, unknown>)[path], fresh[key])).toBe(
          true
        );
      })
    );
  });
});

describe('filterUnchangedBedFieldPatches · propiedades', () => {
  const stateWithPatchArb = stateArb.chain(state =>
    fc.tuple(fc.constant(state), flatPatchArb(state))
  );

  it('es idempotente: filtrar lo ya filtrado no cambia el parche', () => {
    fc.assert(
      fc.property(stateWithPatchArb, ([{ record, bedId }, patch]) => {
        const once = filterUnchangedBedFieldPatches(record, bedId, patch);
        expect(filterUnchangedBedFieldPatches(record, bedId, once)).toStrictEqual(once);
      })
    );
  });

  it('no pierde cambios reales, no inventa rutas, poda solo lo idéntico y respeta el acompañamiento UPC', () => {
    fc.assert(
      fc.property(stateWithPatchArb, ([state, patch]) => {
        const { record, bedId } = state;
        const current = currentPatientOf(state);
        const prefix = `beds.${bedId}.`;
        const overridePath = `bedTypeOverrides.${bedId}`;
        const isUpcPath = `${prefix}isUPC`;
        const filtered = filterUnchangedBedFieldPatches(record, bedId, patch);

        Object.entries(patch).forEach(([path, value]) => {
          const field = path.startsWith(prefix) ? path.slice(prefix.length) : null;
          const isOwnBedField = field !== null && !field.includes('.');

          if (path === overridePath) {
            const changed = !arePatchValuesDeepEqual(value, record.bedTypeOverrides?.[bedId]);
            expect(path in filtered).toBe(changed);
            if (changed) expect(filtered[path]).toBe(value);
            return;
          }
          if (isOwnBedField) {
            const changed = !arePatchValuesDeepEqual(value, current[field]);
            if (changed) expect(filtered[path]).toBe(value);
            else if (field !== 'isUPC') expect(path in filtered).toBe(false);
            return;
          }
          // Rutas ajenas a la cama (otras camas, cuna, raíz) pasan intactas.
          expect(path in filtered).toBe(true);
          expect(filtered[path]).toBe(value);
        });

        Object.keys(filtered).forEach(path => {
          expect(path in patch || path === isUpcPath).toBe(true);
        });

        if (overridePath in filtered) {
          expect(isUpcPath in filtered || `${prefix}upcChecklist` in filtered).toBe(true);
        }

        const upcWasUnchanged =
          !(isUpcPath in patch) || arePatchValuesDeepEqual(patch[isUpcPath], current.isUPC);
        if (isUpcPath in filtered && upcWasUnchanged) {
          // Re-anclaje del acompañante: el valor vigente normalizado, nunca uno inventado.
          expect(filtered[isUpcPath]).toBe(resolveNormalizedUpcFlag(bedId, Boolean(current.isUPC)));
        }
      })
    );
  });

  it('aplicar el parche filtrado deja el registro igual que aplicar el parche completo', () => {
    fc.assert(
      fc.property(stateWithPatchArb, ([{ record, bedId }, patch]) => {
        const filtered = filterUnchangedBedFieldPatches(record, bedId, patch);
        expect(
          clinicalValuesEqual(applyFlatPatch(record, filtered), applyFlatPatch(record, patch))
        ).toBe(true);
      })
    );
  });
});
