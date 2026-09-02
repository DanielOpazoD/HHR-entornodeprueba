import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ALL_CONFLICT_DOMAIN_CONTEXTS,
  classifyConflictChangedContexts,
} from '@/services/repositories/conflictResolutionDomainPolicy';
import { mergePatientDevices } from '@/services/repositories/conflictResolutionDeviceMergeUtils';
import { mergeMovementArrayById } from '@/services/repositories/conflictResolutionMovementMergePolicy';

/**
 * La resolución de conflictos local/remoto del registro diario tiene tres
 * piezas puras que deciden qué sobrevive: los movimientos por id (con
 * tombstones), los dispositivos activos (con retiros locales) y la
 * clasificación de contextos afectados. Sus invariantes escritos en prosa en
 * los módulos («un tombstone nunca revive», «un dispositivo retirado no
 * vuelve», «la unión por id no pierde nada») se fijan aquí para cualquier
 * combinación de snapshots, no para los casos que ya se reportaron.
 */

interface MovementLike {
  id: string;
  patientName: string;
  deletedAt?: string;
}

const movementArb: fc.Arbitrary<MovementLike> = fc
  .record({
    id: fc.stringMatching(/^m[0-9]{1,2}$/),
    patientName: fc.constantFrom('Ana', 'Beto', 'Cata'),
    deletedAt: fc.option(fc.constant('2026-07-11T10:00:00.000Z'), { nil: undefined }),
  })
  .map(({ deletedAt, ...rest }) => (deletedAt ? { ...rest, deletedAt } : rest));

const movementListArb = fc.uniqueArray(movementArb, { selector: item => item.id, maxLength: 8 });

const isDeleted = (movement: MovementLike | undefined): boolean =>
  Boolean(movement?.deletedAt?.trim());

const idsOf = (items: MovementLike[]): string[] => items.map(item => item.id);

describe('mergeMovementArrayById · propiedades', () => {
  it('es la unión por id: ningún movimiento se pierde y ninguno se duplica', () => {
    fc.assert(
      fc.property(movementListArb, movementListArb, fc.boolean(), (remote, local, preferLocal) => {
        const merged = mergeMovementArrayById(remote, local, preferLocal);
        const expectedIds = new Set([...idsOf(remote), ...idsOf(local)]);

        expect(new Set(idsOf(merged))).toEqual(expectedIds);
        expect(idsOf(merged).length).toBe(expectedIds.size);
      })
    );
  });

  it('un tombstone de cualquiera de los dos lados nunca revive, prefiera quien prefiera', () => {
    fc.assert(
      fc.property(movementListArb, movementListArb, fc.boolean(), (remote, local, preferLocal) => {
        const merged = new Map(
          mergeMovementArrayById(remote, local, preferLocal).map(item => [item.id, item])
        );
        const remoteById = new Map(remote.map(item => [item.id, item]));
        const localById = new Map(local.map(item => [item.id, item]));

        merged.forEach((item, id) => {
          const remoteItem = remoteById.get(id);
          const localItem = localById.get(id);
          if (isDeleted(remoteItem) || isDeleted(localItem)) {
            expect(isDeleted(item)).toBe(true);
          } else if (remoteItem && localItem) {
            expect(item).toBe(preferLocal ? localItem : remoteItem);
          } else {
            expect(item).toBe(localItem ?? remoteItem);
          }
        });
      })
    );
  });

  it('es idempotente y neutra: volver a mezclar con el mismo lado local no cambia nada, y un lado consigo mismo es él', () => {
    fc.assert(
      fc.property(movementListArb, movementListArb, fc.boolean(), (remote, local, preferLocal) => {
        const merged = mergeMovementArrayById(remote, local, preferLocal);
        expect(mergeMovementArrayById(merged, local, preferLocal)).toEqual(merged);
        expect(mergeMovementArrayById(remote, remote, preferLocal)).toEqual(remote);
      })
    );
  });

  it('cuando ambos lados coinciden en lo compartido, el resultado no depende de quién es remoto', () => {
    fc.assert(
      fc.property(movementListArb, movementListArb, fc.boolean(), (remote, local, preferLocal) => {
        const localById = new Map(local.map(item => [item.id, item]));
        const agreeingLocal = local.map(item => item);
        const agreeingRemote = remote.map(item => localById.get(item.id) ?? item);

        const oneWay = mergeMovementArrayById(agreeingRemote, agreeingLocal, preferLocal);
        const otherWay = mergeMovementArrayById(agreeingLocal, agreeingRemote, preferLocal);

        const byId = (items: MovementLike[]) => new Map(items.map(item => [item.id, item]));
        expect(byId(oneWay)).toEqual(byId(otherWay));
      })
    );
  });
});

const deviceArb = fc.constantFrom('VVP', 'CVC', 'CUP', 'VMI', 'SNG', 'SF');
const deviceListArb = fc.uniqueArray(deviceArb, { maxLength: 4 });
const deviceDetailsArb = fc.dictionary(
  deviceArb,
  fc.record({ removalDate: fc.constantFrom('', '2026-07-10') }),
  { maxKeys: 4 }
);
const deviceHistoryArb = fc.array(
  fc.record({
    type: deviceArb,
    status: fc.constantFrom('Active', 'Removed'),
    removalDate: fc.constantFrom('', '2026-07-10'),
  }),
  { maxLength: 5 }
);

describe('mergePatientDevices · propiedades', () => {
  it('el resultado es un subconjunto sin duplicados de la unión, y un retiro local explícito nunca vuelve', () => {
    fc.assert(
      fc.property(
        deviceListArb,
        deviceListArb,
        deviceDetailsArb,
        deviceHistoryArb,
        fc.boolean(),
        (remote, local, details, history, preferLocal) => {
          const merged = mergePatientDevices(remote, local, details, history, preferLocal);
          const union = new Set<string>([...remote, ...local]);
          const detailsByDevice: Record<string, { removalDate: string } | undefined> = details;

          expect(new Set(merged).size).toBe(merged.length);
          merged.forEach(device => {
            expect(union.has(device)).toBe(true);
            expect(String(detailsByDevice[device]?.removalDate ?? '').trim()).toBe('');
          });
        }
      )
    );
  });

  it('una lista local marcada como cambio explícito gana tal cual (sin duplicados), ignorando el remoto', () => {
    fc.assert(
      fc.property(
        deviceListArb,
        fc.array(deviceArb, { maxLength: 6 }),
        deviceDetailsArb,
        deviceHistoryArb,
        fc.boolean(),
        (remote, local, details, history, preferLocal) => {
          const merged = mergePatientDevices(
            remote,
            local,
            details,
            history,
            preferLocal,
            undefined,
            '',
            true
          );
          expect(merged).toEqual(Array.from(new Set(local)));
        }
      )
    );
  });

  it('es idempotente: reaplicar el merge sobre su propio resultado no cambia la lista', () => {
    fc.assert(
      fc.property(
        deviceListArb,
        deviceListArb,
        deviceDetailsArb,
        deviceHistoryArb,
        fc.boolean(),
        (remote, local, details, history, preferLocal) => {
          const merged = mergePatientDevices(remote, local, details, history, preferLocal);
          expect(mergePatientDevices(merged, local, details, history, preferLocal)).toEqual(merged);
        }
      )
    );
  });
});

const changedPathArb = fc.constantFrom(
  'beds.R1.pathology',
  'beds.R1.handoffNoteDayShift',
  'beds.NEO1.devices',
  'medicalHandoffBySpecialty.cirugia',
  'nursesDayShift',
  'tensNightShift',
  'activeExtraBeds',
  'discharges',
  'transfers.0.time',
  'cma',
  'date',
  'lastUpdated',
  'schemaVersion',
  'dateTimestamp',
  'rayenSyncHistory',
  'unknownRoot.field'
);

const sortedContexts = (contexts: readonly string[]): string[] => [...contexts].sort();

describe('classifyConflictChangedContexts · propiedades', () => {
  it('devuelve contextos válidos, sin duplicados y como CONJUNTO (el orden de los paths no importa)', () => {
    fc.assert(
      fc.property(
        fc.array(changedPathArb, { minLength: 1, maxLength: 10 }),
        fc.array(fc.nat({ max: 9 }), { maxLength: 10 }),
        (paths, permutationSteps) => {
          const contexts = classifyConflictChangedContexts(paths);
          contexts.forEach(context => expect(ALL_CONFLICT_DOMAIN_CONTEXTS).toContain(context));
          expect(new Set(contexts).size).toBe(contexts.length);

          const permuted = [...paths];
          permutationSteps.forEach((step, index) => {
            const a = step % permuted.length;
            const b = index % permuted.length;
            [permuted[a], permuted[b]] = [permuted[b], permuted[a]];
          });
          expect(sortedContexts(classifyConflictChangedContexts(permuted))).toEqual(
            sortedContexts(contexts)
          );
        }
      )
    );
  });

  it('es monótona: agregar paths solo puede AGREGAR contextos (nunca ocultar uno ya afectado)', () => {
    fc.assert(
      fc.property(
        fc.array(changedPathArb, { minLength: 1, maxLength: 8 }),
        fc.array(changedPathArb, { maxLength: 8 }),
        (paths, extra) => {
          const before = new Set(classifyConflictChangedContexts(paths));
          const after = new Set(classifyConflictChangedContexts([...paths, ...extra]));
          before.forEach(context => expect(after.has(context)).toBe(true));
        }
      )
    );
  });

  it('un conflicto sin paths o con comodín afecta a todos los contextos conocidos, nunca a «unknown»', () => {
    fc.assert(
      fc.property(fc.array(changedPathArb, { maxLength: 6 }), paths => {
        const everything = sortedContexts(
          ALL_CONFLICT_DOMAIN_CONTEXTS.filter(context => context !== 'unknown')
        );
        expect(sortedContexts(classifyConflictChangedContexts([]))).toEqual(everything);
        expect(sortedContexts(classifyConflictChangedContexts([...paths, '*']))).toEqual(
          everything
        );
      })
    );
  });
});
