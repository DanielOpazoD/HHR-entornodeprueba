import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { findPatientErasures } = require('../../../functions/lib/dailyRecordErasureGuard.js') as {
  findPatientErasures: (
    remote: Record<string, unknown>,
    local: Record<string, unknown>
  ) => { bedId: string; remotePatientName: string }[];
};

const bed = (patientName: string, cribName?: string) => ({
  patientName,
  ...(cribName ? { clinicalCrib: { patientName: cribName } } : {}),
});

describe('dailyRecordErasureGuard.findPatientErasures (server mirror of the client guard)', () => {
  it('flags a cloud patient the incoming record dropped with no movement', () => {
    const remote = { beds: { R1: bed('Paciente Uno'), R2: bed('Paciente Dos') } };
    const local = { beds: { R1: bed('Paciente Uno') }, discharges: [], transfers: [], cma: [] };

    expect(findPatientErasures(remote, local)).toEqual([
      { bedId: 'R2', remotePatientName: 'Paciente Dos' },
    ]);
  });

  it('does not flag when a discharge matches the same patient AND bed', () => {
    const remote = { beds: { R2: bed('Paciente Dos') } };
    const local = { beds: {}, discharges: [{ patientName: 'Paciente Dos', bedId: 'R2' }] };

    expect(findPatientErasures(remote, local)).toEqual([]);
  });

  it('still flags when a same-name discharge is on a DIFFERENT bed', () => {
    const remote = { beds: { R2: bed('Paciente Dos') } };
    const local = { beds: {}, discharges: [{ patientName: 'Paciente Dos', bedId: 'R9' }] };

    expect(findPatientErasures(remote, local)).toEqual([
      { bedId: 'R2', remotePatientName: 'Paciente Dos' },
    ]);
  });

  it('accounts for an emptied bed via a CMA originalBedId', () => {
    const remote = { beds: { R2: bed('Paciente Dos') } };
    const local = { beds: {}, cma: [{ patientName: 'Paciente Dos', originalBedId: 'R2' }] };

    expect(findPatientErasures(remote, local)).toEqual([]);
  });

  it('flags an erased nested clinical-crib occupant', () => {
    const remote = { beds: { R1: bed('Madre', 'Recién Nacido') } };
    const local = { beds: { R1: bed('Madre') } };

    expect(findPatientErasures(remote, local)).toEqual([
      { bedId: 'R1 (cuna RN)', remotePatientName: 'Recién Nacido' },
    ]);
  });

  it('returns nothing when both copies hold the same patients', () => {
    const remote = { beds: { R1: bed('Paciente Uno') } };
    const local = { beds: { R1: bed('Paciente Uno') } };

    expect(findPatientErasures(remote, local)).toEqual([]);
  });

  it('does NOT flag a patient relocated to another bed (internal move, no movement record)', () => {
    // An internal bed move (R4 → R3) carries no discharge/transfer/CMA; the vacated bed is
    // accounted for because the SAME patient still occupies another bed in the incoming record.
    const remote = { beds: { R4: bed('Kevin Villagran') } };
    const local = { beds: { R3: bed('Kevin Villagran') }, discharges: [], transfers: [], cma: [] };

    expect(findPatientErasures(remote, local)).toEqual([]);
  });

  it('matches a relocation by RUT even when only the strong id is stable', () => {
    const remote = { beds: { R4: { patientName: 'Kevin V.', rut: '20.189.620-7' } } };
    const local = { beds: { R3: { patientName: 'Kevin Villagran', rut: '20189620-7' } } };

    expect(findPatientErasures(remote, local)).toEqual([]);
  });

  it('still flags a real erasure when a DIFFERENT patient reused the census (no identity match)', () => {
    const remote = { beds: { R4: bed('Kevin Villagran') } };
    const local = { beds: { R3: bed('Otra Persona') }, discharges: [], transfers: [], cma: [] };

    expect(findPatientErasures(remote, local)).toEqual([
      { bedId: 'R4', remotePatientName: 'Kevin Villagran' },
    ]);
  });
});
