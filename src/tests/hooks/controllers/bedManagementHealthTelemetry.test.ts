// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildBedPatchFailureTelemetryEvent } from '@/hooks/controllers/bedManagementHealthTelemetry';
import { sanitizeOperationalTelemetryEvent } from '@/shared/observability/operationalTelemetryPrivacy';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createEmptyPatient } from '@/domain/patient/patientFactory';

const record = DataFactory.createMockDailyRecord('2026-01-01', {
  ...DataFactory.createMockDailyRecord('2026-05-21'),
  beds: {
    R1: {
      ...createEmptyPatient('R1'),
      patientName: 'Paciente Sintético',
      rut: '11.111.111-1',
      clinicalEpisodeId: 'episodio-sintetico',
      pathology: 'Neumonia sintética',
    },
  },
});
const event = () =>
  buildBedPatchFailureTelemetryEvent(
    record,
    { type: 'UPDATE_PATIENT', bedId: 'R1', field: 'pathology', value: 'x' } as never,
    new Error('Rechazada')
  );

describe('telemetry of a refused bed edit', () => {
  it('records who the refused edit was about', () => {
    expect(event().context).toMatchObject({
      bedId: 'R1',
      patientName: 'Paciente Sintético',
      rut: '11.111.111-1',
      clinicalEpisodeId: 'episodio-sintetico',
      pathology: 'Neumonia sintética',
    });
  });

  it('keeps that identity out of what leaves through external telemetry', () => {
    const external = JSON.stringify(
      sanitizeOperationalTelemetryEvent({ ...event(), timestamp: '2026-05-21T14:03:00.000Z' })
    );

    expect(external).not.toContain('Paciente Sintético');
    expect(external).not.toContain('11.111.111-1');
    expect(external).not.toContain('Neumonia sintética');
  });
});
