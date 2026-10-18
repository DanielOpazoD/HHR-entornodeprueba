import React from 'react';
import { Activity } from 'lucide-react';
import type { DicomStackState } from '@/services/radiology/dicomProgressiveStack';
import type { DicomLoadState } from '@/services/radiology/dicomLoadState';
import type { ProgressiveDicomSeries } from '@/services/radiology/dicomSeriesLoader';

export const DicomLoadControls: React.FC<{
  progress: number[];
  loading: DicomLoadState | null;
  controller?: ProgressiveDicomSeries['loading'];
  state: DicomStackState | null;
  disabled: boolean;
  select: (index: number) => void;
}> = ({ progress, loading, controller, state, disabled, select }) => {
  const ready = loading?.ready ?? progress[0],
    total = progress[1];
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  return (
    <div className="dicom-load-controls">
      <span role="status" aria-label="Imágenes preparadas">
        {ready}/{total}
      </span>
      <progress max={total} value={ready} aria-label="Descarga de la serie" />
      {state && (
        <>
          <label htmlFor="dicom-slice-position">Corte</label>
          <input
            id="dicom-slice-position"
            aria-label="Corte solicitado"
            type="range"
            min="1"
            max={total}
            value={state.requested + 1}
            disabled={disabled}
            onChange={event => select(Number(event.target.value) - 1)}
          />
          <output aria-label="Estado del corte">
            {state.pending
              ? `Cargando ${state.requested + 1}/${total}…`
              : state.error
                ? `Corte ${state.requested + 1} no disponible`
                : `${(state.current ?? state.requested) + 1}/${total}`}
          </output>
        </>
      )}
      {loading && controller && (
        <details className="dicom-load-detail">
          <summary aria-label="Carga y conexión" title="Carga y conexión">
            <Activity size={16} />
          </summary>
          <div>
            <label>
              Conexiones{' '}
              <select
                aria-label="Descargas simultáneas"
                value={loading.limit}
                disabled={disabled}
                onChange={event => controller.setLimit(Number(event.target.value))}
              >
                {[1, 2, 3, 4, 5, 6].map(value => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <dl className="dicom-load-stats">
              <dt>Velocidad media</dt>
              <dd>
                {loading.elapsedMs > 0
                  ? ((loading.networkBytes ?? 0) / 1048576 / (loading.elapsedMs / 1000)).toFixed(2)
                  : '0.00'}{' '}
                MiB/s
              </dd>
              <dt>En curso</dt>
              <dd>
                {loading.activeDownloads} red · {loading.activeDecodes} preparación
              </dd>
              <dt>Descargadas</dt>
              <dd>
                {loading.downloaded}/{total}
              </dd>
              <dt>Concurrencia</dt>
              <dd>{loading.concurrency}</dd>
              <dt>Memoria originales</dt>
              <dd>{(loading.rawBytes / 1048576).toFixed(1)} / 256 MiB</dd>
              <dt>Reintentos</dt>
              <dd>{loading.retries}</dd>
              <dt>Primer corte</dt>
              <dd>{loading.firstReadyMs === null ? '—' : seconds(loading.firstReadyMs)}</dd>
              <dt>Tiempo</dt>
              <dd>{seconds(loading.elapsedMs)}</dd>
            </dl>
            <details>
              <summary>Tiempos acumulados</summary>
              <dl
                className="dicom-load-stats"
                title="Las tareas se solapan. La espera incluye autenticación, proxy y red."
              >
                <dt>Respuesta</dt>
                <dd>{seconds(loading.timings.headers)}</dd>
                <dt>Transferencia</dt>
                <dd>{seconds(loading.timings.transfer)}</dd>
                <dt>Preparación</dt>
                <dd>{seconds(loading.timings.decode)}</dd>
                <dt>Volumen</dt>
                <dd>{seconds(loading.timings.volume)}</dd>
                <dt>MMRAD → proxy</dt>
                <dd>{loading.timings.upstreamSamples ? seconds(loading.timings.upstream) : '—'}</dd>
              </dl>
            </details>
          </div>
        </details>
      )}
      {loading && loading.failed.length > 0 && (
        <span role="status">
          {loading.failed.length} cortes con fallo de conexión.
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              controller?.retryFailed();
              if (state?.error) select(state.requested);
            }}
          >
            Reintentar cortes fallidos
          </button>
        </span>
      )}
    </div>
  );
};
