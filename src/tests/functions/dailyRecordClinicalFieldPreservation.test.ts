// @vitest-environment node
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

  it('keeps the devices a save names as its own edit, and the stored ones everywhere else', () => {
    const remote = {
      beds: {
        R1: {
          clinicalEpisodeId: 'episode-1',
          devices: [],
          deviceInstanceHistory: [],
          vitalSigns: { systolic: 121 },
          clinicalCrib: { clinicalEpisodeId: 'episode-rn', devices: ['SNG'] },
        },
        R2: { clinicalEpisodeId: 'episode-2', devices: ['VVP'] },
      },
    };
    const incoming = {
      beds: {
        R1: {
          clinicalEpisodeId: 'episode-1',
          devices: ['CVC'],
          deviceInstanceHistory: [{ id: 'cvc-1', type: 'CVC' }],
          vitalSigns: { systolic: 80 },
          clinicalCrib: { clinicalEpisodeId: 'episode-rn', devices: [] },
        },
        R2: { clinicalEpisodeId: 'episode-2', devices: [] },
      },
    };

    const result = preserveRayenClinicalFields({
      remoteRecord: remote,
      incomingRecord: incoming,
      editedPaths: [
        'beds.R1.devices',
        'beds.R1.deviceInstanceHistory',
        'beds.R1.clinicalCrib.devices',
        // Named, but only the Rayen batch writes it.
        'beds.R1.vitalSigns',
      ],
    });

    expect(result.beds.R1.devices).toEqual(['CVC']);
    expect(result.beds.R1.deviceInstanceHistory).toEqual([{ id: 'cvc-1', type: 'CVC' }]);
    expect(result.beds.R1.clinicalCrib.devices).toEqual([]);
    expect(result.beds.R1.vitalSigns).toEqual({ systolic: 121 });
    // Not named by this save: the stored devices stay.
    expect(result.beds.R2.devices).toEqual(['VVP']);
    expect(
      preserveRayenClinicalFields({ remoteRecord: remote, incomingRecord: incoming }).beds.R1
        .devices
    ).toEqual([]);
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
