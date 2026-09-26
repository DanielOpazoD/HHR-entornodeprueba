import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { resolvePendingSpecialty } = require('../../../functions/lib/specialtyRules.js');

describe('specialty policy precedence', () => {
  it('honours explicit manual review before an active remembered assignment', () => {
    const outcome = resolvePendingSpecialty(
      { patientName: 'Paciente sintético', clinicalEpisodeId: 'episode-test',
        cie10Code: 'F23', specialty: '' },
      { schemaVersion: 1, revision: 2, autoEnabled: true, memoryEnabled: true,
        aiMode: 'off', rules: [{ id: 'clinical_F23', kind: 'review',
          cie10Code: 'F23', scope: 'all', revision: 2 }],
        memory: [{ id: 'memory_F23', kind: 'assign', cie10Code: 'F23',
          specialty: 'Psiquiatría', scope: 'all', revision: 1 }] }
    );
    expect(outcome).toEqual({ kind: 'review', reason: 'manual_required' });
  });
});
