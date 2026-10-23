import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Hand, Link2, RotateCcw, Scan, ZoomIn } from 'lucide-react';
import type { DicomStudy, DicomSeries } from '@/services/radiology/dicomTypes';
import type { DicomRuntime } from '@/services/radiology/dicomRuntimeTypes';
import type {
  ComparisonLinks,
  ComparisonState,
  DicomComparison,
} from '@/services/radiology/dicomComparison';
import type { DicomStudyPrefetch } from '@/services/radiology/dicomStudyPrefetch';
import { DicomFullscreenButton } from './DicomFullscreenButton';
import './dicomComparison.css';

const ComparisonPanels: React.FC<{
  primary: DicomSeries;
  secondary: DicomSeries;
  runtime: DicomRuntime;
}> = ({ primary, secondary, runtime }) => {
  const elements = useRef<Array<HTMLDivElement | null>>([]);
  const session = useRef<DicomComparison | undefined>(undefined);
  const [state, setState] = useState<ComparisonState | null>(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const [links, setLinks] = useState<ComparisonLinks>({
    position: true,
    zoom: false,
    window: false,
  });
  const [tools, setTools] = useState(['window', 'window']);
  useEffect(() => {
    const controller = new AbortController();
    let current: DicomComparison | undefined;
    void runtime
      .compare(secondary, elements.current as HTMLDivElement[], controller.signal, value => {
        if (!controller.signal.aborted) setState(value);
      })
      .then(value => {
        current = value;
        if (controller.signal.aborted) value.dispose();
        else session.current = value;
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('No se pudo iniciar la comparación.');
      });
    return () => {
      controller.abort();
      current?.dispose();
      session.current = undefined;
    };
  }, [runtime, secondary]);
  const activate = (panel: number) => {
    setActive(panel);
    session.current?.activate(panel);
  };
  const failed = error || state?.error;
  const controlsDisabled =
    !state || !!failed || !!state.stacks[active]?.pending || !!state.stacks[active]?.error;
  return (
    <>
      <div className="dicom-toolbar dicom-compare-tools" aria-label="Herramientas de comparación">
        <span className="dicom-compare-active">Panel {active + 1}</span>
        {(
          [
            { id: 'window', label: 'Contraste', icon: Scan },
            { id: 'pan', label: 'Mover', icon: Hand },
            { id: 'zoom', label: 'Zoom', icon: ZoomIn },
          ] as const
        ).map(tool => (
          <button
            key={tool.id}
            type="button"
            aria-label={tool.label}
            title={tool.label}
            aria-pressed={tools[active] === tool.id}
            disabled={controlsDisabled}
            onClick={() => {
              session.current?.tool(tool.id);
              setTools(values =>
                values.map((value, index) => (index === active ? tool.id : value))
              );
            }}
          >
            <tool.icon size={16} />
          </button>
        ))}
        <select
          aria-label="Ventana del panel activo"
          value=""
          disabled={controlsDisabled || [primary, secondary][active].modality !== 'CT'}
          onChange={event => {
            const [width, center] = event.target.value.split(',').map(Number);
            session.current?.window(width, center);
          }}
        >
          <option value="" disabled>
            Ventana
          </option>
          <option value="400,40">Tejidos blandos</option>
          <option value="1500,-600">Pulmón</option>
          <option value="2000,500">Hueso</option>
          <option value="80,40">Cerebro</option>
        </select>
        <button
          type="button"
          aria-label="Restablecer panel"
          title="Restablecer panel"
          disabled={controlsDisabled}
          onClick={() => session.current?.reset()}
        >
          <RotateCcw size={16} />
        </button>
        <details className="dicom-popover dicom-compare-links">
          <summary aria-label="Vincular paneles" title="Vincular paneles">
            <Link2 size={16} />
          </summary>
          <div className="dicom-popover-body">
            {(['position', 'zoom', 'window'] as const).map(key => (
              <label key={key}>
                <span>{{ position: 'Posición', zoom: 'Zoom', window: 'Ventana' }[key]}</span>
                <input
                  type="checkbox"
                  checked={links[key]}
                  disabled={!!failed || (key === 'window' && !state?.windowCompatible)}
                  onChange={event => {
                    const next = { ...links, [key]: event.target.checked };
                    setLinks(next);
                    session.current?.link(next);
                  }}
                />
              </label>
            ))}
            {!state?.windowCompatible && (
              <small>Ventana compartida: misma serie o TAC con HU calibrados.</small>
            )}
          </div>
        </details>
        {!!state?.failed && !failed && (
          <button type="button" onClick={() => session.current?.retry()}>
            Reintentar {state.failed} cortes
          </button>
        )}
        <span className="dicom-compare-status" role="status">
          {state?.positionStatus}
        </span>
      </div>
      {failed && (
        <p className="dicom-status" role="alert">
          {failed}
        </p>
      )}
      <div className="dicom-grid dicom-grid--compare">
        {[primary, secondary].map((series, panel) => {
          const stack = state?.stacks[panel];
          const pending = !stack || stack.pending || !!stack.error || !!failed;
          return (
            <div key={panel} className="dicom-pane" data-active={active === panel}>
              <div className="dicom-compare-label">
                <button
                  type="button"
                  aria-label={`Activar panel ${panel + 1}`}
                  aria-pressed={active === panel}
                  onClick={() => {
                    activate(panel);
                    elements.current[panel]?.focus();
                  }}
                >
                  {panel + 1} · {series.description || `Serie ${series.number}`}
                </button>
                <span>
                  {state?.ready[panel] ?? 0}/{series.instances.length}
                </span>
              </div>
              <div
                className="dicom-canvas"
                ref={element => {
                  elements.current[panel] = element;
                }}
                data-pending={pending}
                role="img"
                aria-label={`Comparación panel ${panel + 1}`}
                tabIndex={0}
                onFocus={() => activate(panel)}
                onPointerDown={() => activate(panel)}
                onWheelCapture={() => activate(panel)}
                onContextMenu={event => event.preventDefault()}
                onKeyDownCapture={event => {
                  if (event.key !== 'Escape') event.stopPropagation();
                  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || failed)
                    return;
                  const delta = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 }[event.key];
                  if (delta) {
                    event.preventDefault();
                    session.current?.step(panel, delta);
                  }
                  if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                    event.preventDefault();
                    elements.current[1 - panel]?.focus();
                  }
                }}
              />
              {!pending && state?.orientations[panel] && (
                <div className="dicom-orientation" aria-hidden="true">
                  {(['top', 'right', 'bottom', 'left'] as const).map(edge => (
                    <span key={edge} className={`dicom-edge-${edge}`}>
                      {state.orientations[panel][edge]}
                    </span>
                  ))}
                </div>
              )}
              {!pending && state?.lines[panel] && (
                <svg className="dicom-reference-line" aria-label="Línea de referencia">
                  <line
                    x1={state.lines[panel]![0][0]}
                    y1={state.lines[panel]![0][1]}
                    x2={state.lines[panel]![1][0]}
                    y2={state.lines[panel]![1][1]}
                  />
                </svg>
              )}
              {pending && (
                <span className="dicom-compare-pending" role="status">
                  {stack?.error
                    ? 'Corte no disponible'
                    : failed
                      ? 'Comparación detenida'
                      : 'Cargando corte…'}
                </span>
              )}
              <div className="dicom-compare-scroll">
                <input
                  type="range"
                  aria-label={`Corte panel ${panel + 1}`}
                  min={1}
                  max={series.instances.length}
                  value={(stack?.requested ?? 0) + 1}
                  disabled={!state || !!failed}
                  onChange={event => {
                    activate(panel);
                    session.current?.select(panel, Number(event.target.value) - 1);
                  }}
                />
                <output>
                  {(stack?.requested ?? 0) + 1}/{series.instances.length}
                </output>
                {stack?.error && (
                  <button type="button" onClick={() => session.current?.retry()}>
                    Reintentar
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

export const DicomComparisonView: React.FC<{
  study: DicomStudy;
  primary: DicomSeries;
  runtime: DicomRuntime;
  prefetch?: DicomStudyPrefetch;
  close: () => void;
}> = ({ study, primary, runtime, prefetch, close }) => {
  const [uid, setUid] = useState(primary.uid);
  const secondary = study.series.find(series => series.uid === uid) ?? primary;
  return (
    <>
      <div className="dicom-toolbar" aria-label="Comparación de series">
        <button type="button" onClick={close}>
          <ArrowLeft size={15} /> Volver
        </button>
        <label className="dicom-compare-selector">
          Comparar con
          <select
            aria-label="Segunda serie"
            value={uid}
            onChange={event => {
              prefetch?.select(primary.uid);
              setUid(event.target.value);
            }}
          >
            <option value={primary.uid}>Misma serie · dos ventanas</option>
            {study.series
              .filter(
                series =>
                  series.uid !== primary.uid &&
                  series.instances.every(instance => instance.frames === 1)
              )
              .map(series => (
                <option key={series.uid} value={series.uid}>
                  {series.number} · {series.description || series.modality}
                </option>
              ))}
          </select>
        </label>
        <span className="dicom-toolbar-spacer" />
        <DicomFullscreenButton />
      </div>
      <ComparisonPanels
        key={secondary.uid}
        primary={primary}
        secondary={secondary}
        runtime={runtime}
      />
    </>
  );
};
