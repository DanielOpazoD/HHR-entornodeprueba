import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RayenSyncTechnicalMetricsPanel } from '@/features/rayen-import/components/RayenSyncTechnicalMetricsPanel';

describe('RayenSyncTechnicalMetricsPanel', () => {
  it('keeps aggregate telemetry collapsed and exposes every measured stage on demand', () => {
    render(
      <RayenSyncTechnicalMetricsPanel
        performance={{
          stagesMs: {
            preflight: 120,
            dualCapture: 1_500,
            reconciliation: 2_000,
            historicalEvidence: 700,
            clinicalReads: 3_500,
            writeQueueWait: 80,
            persistence: 400,
          },
          counters: { requests: 14, cacheHits: 3, patches: 2, retries: 1, timeouts: 0 },
          coordination: {
            target: 'historical',
            structuralReplans: 2,
            confirmedEpisodes: 10,
            omittedEpisodes: 1,
            clinicalRetries: 1,
          },
          sourceQuality: {
            treatingPhysicians: {
              encounters: 11,
              catalogEntries: 14,
              assignedEncounters: 8,
              sourceResolvedNames: 6,
              plannedResolvedNames: 8,
            },
          },
        }}
      />
    );

    const panel = screen.getByTestId('rayen-sync-technical-metrics');
    expect(panel).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Detalle técnico'));

    expect(screen.getByRole('group', { name: 'Telemetría técnica agregada' })).toBeVisible();
    expect(panel).toHaveTextContent('Preflight');
    expect(panel).toHaveTextContent('Captura dual');
    expect(panel).toHaveTextContent('Evidencia histórica incluida');
    expect(panel).toHaveTextContent('Espera interna sumada');
    expect(panel).toHaveTextContent('Persistencia sumada');
    expect(panel).toHaveTextContent(
      'Las esperas y persistencias se suman entre pacientes; pueden superar la duración total'
    );
    expect(panel).toHaveTextContent(
      '14 solicitudes Eloísa · 3 aciertos de caché · 2 parches · 1 reintento · 0 timeouts'
    );
    expect(panel).toHaveTextContent(
      'Contexto histórico · 2 replanteamientos estructurales · 10 episodios confirmados · 1 omitidos · 1 reintento clínico'
    );
    expect(panel).toHaveTextContent(
      'Médicos tratantes: 8 asignados · 6 nombres desde Eloísa · 8 disponibles para sincronizar · 14 en catálogo · 11 encuentros'
    );
    expect(panel).toHaveTextContent(
      'no contiene pacientes, camas, episodios, nombres profesionales'
    );
  });

  it('renders nothing for legacy events without technical telemetry', () => {
    const { container } = render(<RayenSyncTechnicalMetricsPanel />);
    expect(container).toBeEmptyDOMElement();
  });
});
