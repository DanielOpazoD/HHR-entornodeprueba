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
            captureHealthBefore: 30,
            captureFichaMedico: 120,
            fichaContext: 4,
            fichaListsAndCatalog: 10,
            fichaPatientReads: 72,
            fichaDiagnosisCoding: 3,
            captureGestionCamas: 450,
            captureHealthAfter: 20,
            reconciliation: 2_000,
            historicalEvidence: 700,
            reviewWait: 45_000,
            structuralPersistence: 2_100,
            clinicalReads: 3_500,
            writeQueueWait: 80,
            persistence: 400,
            currentClinicalPersistence: 250,
            historicalCudyrPersistence: 150,
          },
          counters: { requests: 14, cacheHits: 3, patches: 2, retries: 1, timeouts: 0 },
          coordination: {
            target: 'historical',
            structuralReplans: 2,
            confirmedEpisodes: 10,
            omittedEpisodes: 1,
            clinicalRetries: 1,
          },
          persistenceTrace: {
            current: { callableAttempts: 1, clientRetries: 0, transactionRetries: 0 },
            historical: { callableAttempts: 2, clientRetries: 1, transactionRetries: 1 },
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
    expect(panel).toHaveTextContent('Ficha: lecturas por paciente');
    for (const label of [
      'Conexión previa incluida',
      'Ficha Médico incluida',
      'Gestión de Camas incluida',
      'Conexión posterior incluida',
    ]) {
      expect(panel).toHaveTextContent(label);
    }
    expect(panel).toHaveTextContent('Las fuentes se leen en paralelo');
    expect(panel).toHaveTextContent('Evidencia histórica incluida');
    expect(panel).toHaveTextContent('Revisión humana');
    expect(panel).toHaveTextContent('Guardado estructural');
    expect(panel).toHaveTextContent('Espera interna sumada');
    expect(panel).toHaveTextContent('Persistencia sumada');
    expect(panel).toHaveTextContent('Persistencia clínica actual');
    expect(panel).toHaveTextContent('Persistencia CUDYR histórica');
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
      'Persistencia autoritativa: 1 actual · 2 históricas · 1 reintento cliente · 1 reintento Firestore'
    );
    expect(panel).toHaveTextContent(
      'Médicos tratantes: 8 asignados · 6 nombres desde Eloísa · 8 disponibles para sincronizar · 14 en catálogo · 11 encuentros'
    );
    expect(panel).toHaveTextContent(
      'no contiene pacientes, camas, episodios, nombres profesionales'
    );
  });

  it('explains overlap when only Gestión de Camas timing is available', () => {
    render(
      <RayenSyncTechnicalMetricsPanel
        performance={{
          stagesMs: { dualCapture: 1000, captureGestionCamas: 700 },
          counters: { requests: 0, cacheHits: 0, patches: 0, retries: 0, timeouts: 0 },
        }}
      />
    );
    fireEvent.click(screen.getByText('Detalle técnico'));
    expect(screen.getByText(/Las fuentes se leen en paralelo/)).toBeVisible();
  });

  it('renders nothing for legacy events without technical telemetry', () => {
    const { container } = render(<RayenSyncTechnicalMetricsPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('does not mislabel legacy retry telemetry without a temporal target as current', () => {
    render(
      <RayenSyncTechnicalMetricsPanel
        performance={{
          stagesMs: {},
          counters: { requests: 0, cacheHits: 0, patches: 0, retries: 0, timeouts: 0 },
          coordination: {
            structuralReplans: 0,
            confirmedEpisodes: 0,
            omittedEpisodes: 0,
            clinicalRetries: 1,
          },
        }}
      />
    );

    fireEvent.click(screen.getByText('Detalle técnico'));

    expect(screen.queryByText(/Contexto actual/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 reintento clínico/)).toBeVisible();
  });

  it('renders singular and plural inflections and embedded mode without summary disclosure', () => {
    render(
      <RayenSyncTechnicalMetricsPanel
        embedded
        performance={{
          stagesMs: {
            closeWait: 95,
            staffRegistration: 40,
            cudyrArchive: 1_200,
            cudyrArchivePlacementReads: 300,
            cudyrArchiveWrites: 400,
          },
          counters: { requests: 1, cacheHits: 1, patches: 1, retries: 2, timeouts: 1 },
          coordination: {
            target: 'current',
            structuralReplans: 1,
            confirmedEpisodes: 4,
            omittedEpisodes: 0,
            clinicalRetries: 2,
          },
          persistenceTrace: {
            historical: { callableAttempts: 1, clientRetries: 2, transactionRetries: 2 },
          },
        }}
      />
    );

    const panel = screen.getByTestId('rayen-sync-technical-metrics');
    expect(panel.tagName).toBe('DIV');
    expect(screen.queryByText('Detalle técnico')).not.toBeInTheDocument();
    expect(panel).toHaveTextContent('Espera del cierre tras el guardado');
    expect(panel).toHaveTextContent('Registro del personal incluido');
    expect(panel).toHaveTextContent('Archivo CUDYR: ubicaciones sumadas');
    expect(panel).toHaveTextContent('Archivo CUDYR: escrituras sumadas');
    expect(panel).toHaveTextContent(
      '1 solicitud Eloísa · 1 acierto de caché · 1 parche · 2 reintentos · 1 timeout'
    );
    expect(panel).toHaveTextContent(
      'Persistencia autoritativa: 0 actuales · 1 histórica · 2 reintentos cliente · 2 reintentos Firestore'
    );
    expect(panel).toHaveTextContent(
      'Contexto actual · 1 replanteamiento estructural · 4 episodios confirmados · 0 omitidos · 2 reintentos clínicos'
    );
  });
});
