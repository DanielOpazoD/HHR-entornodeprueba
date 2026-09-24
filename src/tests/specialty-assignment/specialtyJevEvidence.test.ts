import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { buildJevEvidence } = require('../../../functions/lib/specialtyJevEvidence.js');
const { OPTIONS } = require('../../../functions/lib/specialtyJevAdapter.js');
const policy = { revision: 4,
  diagnosisLabels: { 'J18.9': 'Neumonía de prueba' },
  aiRubrics: Object.fromEntries(OPTIONS.map((key: string) => [key,
    `Criterio de prueba sintético para ${key}.`])),
};
const base = { date: '2026-09-23', bedId: 'R1', target: 'bed',
  patient: { clinicalEpisodeId: 'synthetic-episode', cie10Code: 'J18.9',
    patientName: 'NO DEBE SALIR', rut: 'NO DEBE SALIR' }, policy };

describe('Jev evidence scoping', () => {
  it('sends no patient identifiers and invalidates a stale episode or policy', () => {
    const evidence = buildJevEvidence(base);
    expect(JSON.stringify(evidence.request)).not.toMatch(/NO DEBE SALIR|synthetic-episode|R1/);
    expect(buildJevEvidence({ ...base, patient: { ...base.patient,
      clinicalEpisodeId: 'new-episode' } }).digest).not.toBe(evidence.digest);
    expect(buildJevEvidence({ ...base, policy: { ...policy, revision: 5 } }).digest)
      .not.toBe(evidence.digest);
  });

  it('requires an approved canonical label', () => {
    expect(buildJevEvidence({ ...base, policy: { ...policy,
      diagnosisLabels: {} } })).toBeNull();
  });
});
