import { describe, expect, it } from 'vitest';
import {
  makePayload,
  parseClinicalEnrichmentPayload,
} from './rayenClinicalEnrichmentFunctions.test-support';

describe('Rayen clinical enrichment payload budget', () => {
  it('measures combined checkpoints without duplicating target metadata', () => {
    const payload = makePayload();
    const fields = {
      deviceDetails: { padding: '' },
      clinicalSyncCheckpoint: { version: 1, fingerprintVersion: 1, sources: {} },
    };
    const receivedTarget = {
      bedId: payload.patches[0].bedId,
      clinicalEpisodeId: payload.patches[0].clinicalEpisodeId,
      clinicalCrib: false,
      fields,
    };
    const receivedSections = { patches: [receivedTarget] };
    const rawOverhead = Buffer.byteLength(JSON.stringify(receivedSections), 'utf8');
    fields.deviceDetails.padding = 'x'.repeat(500_000 - rawOverhead);
    payload.patches[0].fields = fields as never;

    const normalizedSections = {
      patches: [{ ...receivedTarget, fields: { deviceDetails: fields.deviceDetails } }],
      checkpoints: [
        {
          ...receivedTarget,
          fields: { clinicalSyncCheckpoint: fields.clinicalSyncCheckpoint },
        },
      ],
    };

    expect(Buffer.byteLength(JSON.stringify(receivedSections), 'utf8')).toBe(500_000);
    expect(Buffer.byteLength(JSON.stringify(normalizedSections), 'utf8')).toBeGreaterThan(500_000);
    expect(() => parseClinicalEnrichmentPayload(payload)).not.toThrow();
  });
});
