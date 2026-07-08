import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createEpisodeAdmissionTracker as createFrontendEpisodeTracker } from '@/services/calculations/minsal/episodeTracker';

const require = createRequire(import.meta.url);
const {
  createEpisodeAdmissionTracker: createFunctionsEpisodeTracker,
} = require('../../../functions/lib/minsal/minsalEpisodeTracker.js');

const replayEpisodeScenario = (
  createTracker: typeof createFrontendEpisodeTracker
): {
  firstAdmission?: string;
  reopenedAdmission?: string;
  episodeStart?: string;
} => {
  const tracker = createTracker();

  tracker.observeBed(
    {
      patientName: 'Paciente Uno',
      rut: '11.111.111-1',
      admissionDate: '2025-01-01',
    },
    '2026-03-01'
  );
  tracker.observeBed(
    {
      patientName: 'Paciente Uno',
      rut: '11.111.111-1',
      admissionDate: '2026-03-02',
    },
    '2026-03-02'
  );

  const firstAdmission = tracker.resolveAdmissionDate('11.111.111-1', '2024-01-01');
  const episodeStart = tracker.resolveEpisodeStartDate('11.111.111-1', '2024-01-01');

  tracker.closeEpisode('11.111.111-1');
  tracker.observeBed(
    {
      patientName: 'Paciente Uno',
      rut: '11.111.111-1',
      admissionDate: '2026-03-18',
    },
    '2026-03-18'
  );

  const reopenedAdmission = tracker.resolveAdmissionDate('11.111.111-1', '2024-01-01');

  return {
    firstAdmission,
    reopenedAdmission,
    episodeStart,
  };
};

const replayCanonicalEpisodeIdScenario = (
  createTracker: typeof createFrontendEpisodeTracker
): {
  morningAdmission?: string;
  afternoonAdmission?: string;
} => {
  const tracker = createTracker();

  const morningPatient = {
    clinicalEpisodeId: 'episode-morning',
    patientName: 'Paciente Uno',
    rut: '11.111.111-1',
    admissionDate: '2026-03-05',
  };
  const afternoonPatient = {
    clinicalEpisodeId: 'episode-afternoon',
    patientName: 'Paciente Uno',
    rut: '11.111.111-1',
    admissionDate: '2026-03-05',
  };

  tracker.observeBed(morningPatient, '2026-03-05');
  tracker.closeEpisode(morningPatient);
  tracker.observeBed(afternoonPatient, '2026-03-05');

  return {
    morningAdmission: tracker.resolveAdmissionDate(morningPatient, '2024-01-01'),
    afternoonAdmission: tracker.resolveAdmissionDate(afternoonPatient, '2024-01-01'),
  };
};

describe('minsal episode tracker parity', () => {
  it('keeps frontend and functions trackers aligned for open, close and reopen episodes', () => {
    const frontend = replayEpisodeScenario(createFrontendEpisodeTracker);
    const backend = replayEpisodeScenario(createFunctionsEpisodeTracker);

    expect(frontend).toEqual({
      firstAdmission: '2026-03-01',
      reopenedAdmission: '2026-03-18',
      episodeStart: '2026-03-01',
    });
    expect(backend).toEqual(frontend);
  });

  it('prefers clinicalEpisodeId when tracking same-RUT same-day episodes', () => {
    const frontend = replayCanonicalEpisodeIdScenario(createFrontendEpisodeTracker);
    const backend = replayCanonicalEpisodeIdScenario(createFunctionsEpisodeTracker);

    expect(frontend).toEqual({
      morningAdmission: '2026-03-05',
      afternoonAdmission: '2026-03-05',
    });
    expect(backend).toEqual(frontend);
  });
});
