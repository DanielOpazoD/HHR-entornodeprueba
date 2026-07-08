import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { findPatientErasures as clientFindPatientErasures } from '@/services/repositories/dailyRecordErasureGuard';

// The server guard (functions/lib/dailyRecordErasureGuard.js) is a hand-written mirror of the
// client one. This test runs a shared battery through BOTH and fails on any behavioural drift.
const require = createRequire(import.meta.url);
const { findPatientErasures: serverFindPatientErasures } =
  require('../../../functions/lib/dailyRecordErasureGuard.js') as {
    findPatientErasures: (
      remote: Record<string, unknown>,
      local: Record<string, unknown>
    ) => { bedId: string; remotePatientName: string }[];
  };

const bed = (patientName: string, cribName?: string) =>
  ({
    patientName,
    ...(cribName ? { clinicalCrib: { patientName: cribName } } : {}),
  }) as never;

const record = (
  beds: Record<string, unknown>,
  movements: { discharges?: unknown[]; transfers?: unknown[]; cma?: unknown[] } = {}
): DailyRecord =>
  ({
    date: '2026-06-26',
    beds,
    discharges: movements.discharges ?? [],
    transfers: movements.transfers ?? [],
    cma: movements.cma ?? [],
  }) as DailyRecord;

const fixtures: { name: string; remote: DailyRecord; local: DailyRecord }[] = [
  {
    name: 'simple erasure with no movement',
    remote: record({ R1: bed('Uno'), R2: bed('Dos') }),
    local: record({ R1: bed('Uno') }),
  },
  {
    name: 'accounted for by a same-bed discharge',
    remote: record({ R2: bed('Dos') }),
    local: record({}, { discharges: [{ patientName: 'Dos', bedId: 'R2' }] }),
  },
  {
    name: 'same-name discharge on a different bed still flags',
    remote: record({ R2: bed('Dos') }),
    local: record({}, { discharges: [{ patientName: 'Dos', bedId: 'R9' }] }),
  },
  {
    name: 'bed-reuse: same-bed discharge with a different name flags',
    remote: record({ R1: bed('Juan') }),
    local: record({}, { discharges: [{ patientName: 'Otro', bedId: 'R1' }] }),
  },
  {
    name: 'CMA accounted for by originalBedId',
    remote: record({ R2: bed('Dos') }),
    local: record({}, { cma: [{ patientName: 'Dos', originalBedId: 'R2' }] }),
  },
  {
    name: 'transfer accounted for by bedId',
    remote: record({ R3: bed('Tres') }),
    local: record({}, { transfers: [{ patientName: 'Tres', bedId: 'R3' }] }),
  },
  {
    name: 'erased clinical crib',
    remote: record({ R1: bed('Madre', 'Recién Nacido') }),
    local: record({ R1: bed('Madre') }),
  },
  {
    name: 'crib not masked by a main-occupant discharge',
    remote: record({ R1: bed('Madre', 'Bebé') }),
    local: record({ R1: bed('Madre') }, { discharges: [{ patientName: 'Madre', bedId: 'R1' }] }),
  },
  {
    name: 'no erasure: both copies hold the patient',
    remote: record({ R1: bed('Uno') }),
    local: record({ R1: bed('Uno') }),
  },
  {
    name: 'multiple erasures preserve bed order',
    remote: record({ R1: bed('Uno'), R2: bed('Dos'), R3: bed('Tres') }),
    local: record({ R1: bed('Uno') }),
  },
  {
    name: 'empty beds on both sides',
    remote: record({}),
    local: record({}),
  },
];

describe('findPatientErasures client/server parity', () => {
  it.each(fixtures)('produces identical results: $name', ({ remote, local }) => {
    const client = clientFindPatientErasures(remote, local);
    const server = serverFindPatientErasures(
      remote as unknown as Record<string, unknown>,
      local as unknown as Record<string, unknown>
    );
    expect(server).toEqual(client);
  });
});
