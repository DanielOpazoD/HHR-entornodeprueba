import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { RAYEN_OWNED_CLINICAL_FIELDS } from '@/types/domain/rayenClinicalFields';

const require = createRequire(import.meta.url);
const {
  RAYEN_CLINICAL_FIELDS,
  preserveRayenClinicalFields,
} = require('../../../functions/lib/dailyRecordClinicalFieldPreservation.js');

describe('daily-record clinical field preservation', () => {
  it('keeps the client ownership contract aligned with the server fence', () => {
    expect([...RAYEN_OWNED_CLINICAL_FIELDS]).toEqual([...RAYEN_CLINICAL_FIELDS]);
  });

  it('matches authoritative clinical fields by episode when the patient changes bed', () => {
    const remote = {
      beds: {
        R1: {
          clinicalEpisodeId: 'episode-1',
          vitalSigns: { systolic: 121 },
        },
      },
    };
    const incoming = {
      beds: {
        R2: {
          clinicalEpisodeId: 'episode-1',
          patientName: 'Paciente trasladado',
          vitalSigns: { systolic: 80 },
        },
      },
    };

    expect(preserveRayenClinicalFields({ remoteRecord: remote, incomingRecord: incoming })).toEqual(
      {
        beds: {
          R2: {
            clinicalEpisodeId: 'episode-1',
            patientName: 'Paciente trasladado',
            vitalSigns: { systolic: 121 },
          },
        },
      }
    );
  });

  it('removes client-supplied batch fields from episodes not present in the remote record', () => {
    const result = preserveRayenClinicalFields({
      remoteRecord: { beds: {} },
      incomingRecord: {
        beds: {
          R1: {
            clinicalEpisodeId: 'new-episode',
            patientName: 'Paciente nuevo',
            vitalSigns: { systolic: 70 },
            clinicalSyncCheckpoint: { version: 2 },
          },
        },
      },
    });

    expect(result.beds.R1).toEqual({
      clinicalEpisodeId: 'new-episode',
      patientName: 'Paciente nuevo',
    });
  });
});
