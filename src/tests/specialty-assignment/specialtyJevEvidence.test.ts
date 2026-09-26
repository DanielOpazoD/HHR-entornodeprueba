import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { buildJevEvidence } = require('../../../functions/lib/specialtyJevEvidence.js');
const { getCie10Label } = require('../../../functions/lib/specialtyCie10Catalog.js');
const { OPTIONS } = require('../../../functions/lib/specialtyJevAdapter.js');
const policy = { revision: 4,
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

  it('uses catalog labels where available and code only for unknown codes, never record text', () => {
    expect(buildJevEvidence(base).request.state.diagnosis.label).toBe(getCie10Label('J18.9'));
    const unknown = buildJevEvidence({ ...base, patient: { ...base.patient,
      cie10Code: 'F23', cie10Description: 'Nombre y dato privado NO DEBE SALIR' } });
    expect(unknown.request.state.diagnosis).toEqual({ code: 'F23', label: 'CIE-10 F23' });
    expect(JSON.stringify(unknown.request)).not.toContain('NO DEBE SALIR');
    expect(buildJevEvidence({ ...base, patient: { ...base.patient,
      cie10Code: 'J18.9999' } }).request.state.diagnosis.label).toBe('CIE-10 J18.9999');
    expect(buildJevEvidence({ ...base, patient: { ...base.patient,
      cie10Code: 'not-a-code' } })).toBeNull();
  });
});
