import React from 'react';
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
      <span role="status">
        {ready === total
          ? `${total} imágenes · serie completa`
          : ready > 0
            ? `${ready}/${total} listas · ya puedes navegar`
            : 'Preparando primer corte…'}
        {loading && ready < total && ` · ${loading.downloaded}/${total} descargadas`}
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
          <summary>Carga y conexión</summary>
          <div>
            <label>
              Máximo de descargas simultáneas{' '}
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
            <p>
              Descargando: {loading.activeDownloads} · preparando: {loading.activeDecodes} ·
              concurrencia adaptativa: {loading.concurrency}
            </p>
            <p>
              Originales en memoria: {(loading.rawBytes / 1048576).toFixed(1)} / 256 MB ·
              reintentos: {loading.retries}
            </p>
            <p>
              Primer corte preparado:{' '}
              {loading.firstReadyMs === null ? 'pendiente' : seconds(loading.firstReadyMs)} ·
              transcurrido: {seconds(loading.elapsedMs)}
            </p>
            <p>
              Tiempos acumulados (las tareas se solapan): espera de respuesta{' '}
              {seconds(loading.timings.headers)} · transferencia al navegador{' '}
              {seconds(loading.timings.transfer)} · preparación/decodificación{' '}
              {seconds(loading.timings.decode)} · volumen {seconds(loading.timings.volume)}
            </p>
            <p>
              MMRAD hacia el proxy:{' '}
              {loading.timings.upstreamSamples ? seconds(loading.timings.upstream) : 'sin medición'}
              . La espera incluye autenticación, proxy y red; no equivale al tiempo interno de
              MMRAD. No se guardan ni envían estas métricas.
            </p>
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
