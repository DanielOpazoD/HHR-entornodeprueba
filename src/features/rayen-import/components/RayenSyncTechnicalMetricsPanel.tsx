import React from 'react';
import type { RayenSyncPerformance } from '@/types/domain/rayenSync';

type StageKey = keyof RayenSyncPerformance['stagesMs'];

const SEP = ' · ';
const ROW_CLASS = 'tabular-nums text-slate-500';
const NOTE_CLASS = 'text-[10px] text-slate-400';

const STAGE_LABELS: Record<StageKey, string> = {
  preflight: 'Preflight',
  dualCapture: 'Captura dual',
  captureHealthBefore: 'Conexión previa incluida',
  captureFichaMedico: 'Ficha Médico incluida',
  fichaContext: 'Ficha: contexto',
  fichaListsAndCatalog: 'Ficha: listas y catálogo',
  fichaPatientReads: 'Ficha: lecturas por paciente',
  fichaDiagnosisCoding: 'Ficha: codificación',
  captureGestionCamas: 'Gestión de Camas incluida',
  captureHealthAfter: 'Conexión posterior incluida',
  reconciliation: 'Reconciliación total',
  historicalEvidence: 'Evidencia histórica incluida',
  reviewWait: 'Revisión humana',
  structuralPersistence: 'Guardado estructural',
  clinicalReads: 'Lecturas clínicas',
  writeQueueWait: 'Espera interna sumada',
  persistence: 'Persistencia sumada',
  currentClinicalPersistence: 'Persistencia clínica actual',
  historicalCudyrPersistence: 'Persistencia CUDYR histórica',
  closeWait: 'Espera del cierre tras el guardado',
  staffRegistration: 'Registro del personal incluido',
  cudyrArchive: 'Archivo CUDYR',
  cudyrArchivePlacementReads: 'Archivo CUDYR: ubicaciones sumadas',
  cudyrArchiveWrites: 'Archivo CUDYR: escrituras sumadas',
};

const formatDuration = (durationMs: number): string =>
  durationMs < 1_000
    ? `${durationMs} ms`
    : `${(durationMs / 1_000).toLocaleString('es-CL', { maximumFractionDigits: 1 })} s`;

const inflect = (value: number, singular: string, suffix = 's'): string =>
  `${singular}${value === 1 ? '' : suffix}`;

const qty = (value: number, singular: string, suffix = 's', tail = ''): string =>
  `${value} ${inflect(value, singular, suffix)}${tail}`;

const retryQty = (value: number, tail = ''): string => qty(value, 'reintento', 's', tail);

export const RayenSyncTechnicalMetricsPanel: React.FC<{
  performance?: RayenSyncPerformance;
  embedded?: boolean;
}> = ({ performance, embedded = false }) => {
  if (!performance) return null;
  const { stagesMs, counters, coordination, persistenceTrace, sourceQuality } = performance;
  const stageKeys = (Object.keys(STAGE_LABELS) as StageKey[]).filter(key => stagesMs[key] != null);
  const physicianQuality = sourceQuality?.treatingPhysicians;
  const current = persistenceTrace?.current;
  const historical = persistenceTrace?.historical;
  const Container = embedded ? 'div' : 'details';

  return (
    <Container
      data-testid="rayen-sync-technical-metrics"
      className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-700"
    >
      {!embedded && (
        <summary className="cursor-pointer font-bold text-slate-700">Detalle técnico</summary>
      )}
      <div className="mt-2 space-y-2" role="group" aria-label="Telemetría técnica agregada">
        {(stagesMs.captureFichaMedico != null || stagesMs.captureGestionCamas != null) && (
          <p>
            Las fuentes se leen en paralelo; sus tiempos están incluidos en la captura dual y no se
            suman.
          </p>
        )}
        {stageKeys.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
            {stageKeys.map(key => (
              <div key={key} className="flex items-baseline justify-between gap-2">
                <dt className="text-slate-500">{STAGE_LABELS[key]}</dt>
                <dd className="font-semibold tabular-nums">{formatDuration(stagesMs[key] ?? 0)}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="font-medium tabular-nums text-slate-600">
          {[
            qty(counters.requests, 'solicitud', 'es', ' Eloísa'),
            qty(counters.cacheHits, 'acierto', 's', ' de caché'),
            qty(counters.patches, 'parche'),
            retryQty(counters.retries),
            qty(counters.timeouts, 'timeout'),
          ].join(SEP)}
        </p>
        {(current || historical) && (
          <p className={ROW_CLASS}>
            {`Persistencia autoritativa: ${[
              qty(current?.callableAttempts ?? 0, 'actual', 'es'),
              qty(historical?.callableAttempts ?? 0, 'histórica'),
              retryQty(
                (current?.clientRetries ?? 0) + (historical?.clientRetries ?? 0),
                ' cliente'
              ),
              retryQty(
                (current?.transactionRetries ?? 0) + (historical?.transactionRetries ?? 0),
                ' Firestore'
              ),
            ].join(SEP)}`}
          </p>
        )}
        {coordination && (
          <p className={ROW_CLASS}>
            {[
              ...(coordination.target
                ? [`Contexto ${coordination.target === 'historical' ? 'histórico' : 'actual'}`]
                : []),
              qty(
                coordination.structuralReplans,
                'replanteamiento',
                's',
                ` ${inflect(coordination.structuralReplans, 'estructural', 'es')}`
              ),
              `${coordination.confirmedEpisodes} episodios confirmados`,
              `${coordination.omittedEpisodes} omitidos`,
              retryQty(
                coordination.clinicalRetries,
                ` ${inflect(coordination.clinicalRetries, 'clínico')}`
              ),
            ].join(SEP)}
          </p>
        )}
        {physicianQuality && (
          <p className={ROW_CLASS}>
            {`Médicos tratantes: ${[
              `${physicianQuality.assignedEncounters} asignados`,
              `${physicianQuality.sourceResolvedNames} nombres desde Eloísa`,
              `${physicianQuality.plannedResolvedNames} disponibles para sincronizar`,
              `${physicianQuality.catalogEntries} en catálogo`,
              `${physicianQuality.encounters} encuentros`,
            ].join(SEP)}`}
          </p>
        )}
        {(stagesMs.writeQueueWait != null || stagesMs.persistence != null) && (
          <p className={NOTE_CLASS}>
            Las esperas y persistencias se suman entre pacientes; pueden superar la duración total
            de la sincronización.
          </p>
        )}
        <p className={NOTE_CLASS}>
          Sólo agregados técnicos; no contiene pacientes, camas, episodios, nombres profesionales ni
          valores clínicos.
        </p>
      </div>
    </Container>
  );
};
