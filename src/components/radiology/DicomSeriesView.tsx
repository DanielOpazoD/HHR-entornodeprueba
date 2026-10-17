import React, { useEffect, useRef, useState } from 'react';
import { Camera, Download, Hand, RotateCcw, Scan, ZoomIn } from 'lucide-react';
import type { DicomCapture, DicomSeries, DicomStudy } from '@/services/radiology/dicomTypes';
import type {
  DicomMode,
  DicomRuntime,
  DicomTool,
  DicomOrientation,
} from '@/services/radiology/dicomRuntime';
import { DicomAdvancedControls } from './DicomAdvancedControls';
import { DicomLoadControls } from './DicomLoadControls';
import { DicomViewportGrid, dicomPlaneLabels as labels } from './DicomViewportGrid';
import { DicomFullscreenButton } from './DicomFullscreenButton';
import type { DicomStackState } from '@/services/radiology/dicomProgressiveStack';
import { saveDicomPng } from '@/services/radiology/saveDicomPng';

export const DicomSeriesView: React.FC<{
  study: DicomStudy;
  series: DicomSeries;
  title: string;
  onCapture?: (capture: DicomCapture) => void;
}> = ({ study, series, title, onCapture }) => {
  const [runtime, setRuntime] = useState<DicomRuntime | null>(null);
  const [mode, setMode] = useState<DicomMode>('original');
  const [activeTool, setActiveTool] = useState<DicomTool>('window');
  const [activePlane, setActivePlane] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [complete, setComplete] = useState(false);
  const [stackState, setStackState] = useState<DicomStackState | null>(null);
  const [orientations, setOrientations] = useState<DicomOrientation[]>([]);
  const [progress, setProgress] = useState([0, series.instances.length]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resampled, setResampled] = useState(false);
  const [excludesLocalizers, setExcludesLocalizers] = useState(false);
  const [busy, setBusy] = useState(true);
  const elements = useRef<Array<HTMLDivElement | null>>([]);
  const alive = useRef(true);
  const captureSequence = useRef(0);
  const captureContext = JSON.stringify([
    mode,
    activePlane,
    stackState?.current,
    stackState?.requested,
    stackState?.pending,
  ]);
  const latestCaptureContext = useRef(captureContext);
  latestCaptureContext.current = captureContext;
  useEffect(() => {
    const controller = new AbortController();
    let current: DicomRuntime | undefined;
    alive.current = true;
    void import('@/services/radiology/dicomRuntime')
      .then(({ createDicomRuntime }) =>
        createDicomRuntime(study, series, controller.signal, (loaded, total) => {
          if (!controller.signal.aborted) setProgress([loaded, total]);
        })
      )
      .then(value => {
        current = value;
        if (controller.signal.aborted) value.dispose();
        else {
          setRuntime(value);
          void value.completion
            .then(() => {
              if (!controller.signal.aborted) setComplete(true);
            })
            .catch(reason => {
              if (!controller.signal.aborted) {
                setError(
                  reason instanceof Error ? reason.message : 'No se pudo completar la serie.'
                );
                setBusy(false);
              }
            });
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'No se pudo cargar la serie.');
          setBusy(false);
        }
      });
    return () => {
      alive.current = false;
      controller.abort();
      current?.dispose();
    };
  }, [study, series]);

  useEffect(() => {
    if (!runtime) return;
    let active = true;
    setBusy(true);
    setError('');
    setResampled(false);
    setExcludesLocalizers(mode !== 'original' && runtime.hasLocalizers());
    const targets = elements.current
      .slice(0, labels[mode].length)
      .filter((item): item is HTMLDivElement => Boolean(item));
    void runtime
      .show(mode, targets)
      .then(() => {
        if (active) {
          setActiveTool(mode === '3d' ? 'rotate' : mode === 'mpr' ? 'reference' : 'window');
          setActivePlane(0);
          setOrientations(runtime.orientations());
          setResampled(runtime.isResampled());
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : 'No se pudo reconstruir la vista.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [runtime, mode]);

  useEffect(
    () =>
      runtime?.onStack(state => {
        setStackState(state);
        if (state.error) setError(state.error);
        if (!state.pending) setOrientations(runtime.orientations());
      }),
    [runtime]
  );
  const waitingForSlice = mode === 'original' && Boolean(stackState?.pending);
  const capture = async (): Promise<DicomCapture> => {
    if (!alive.current || latestCaptureContext.current !== captureContext)
      throw new DOMException('Captura cancelada', 'AbortError');
    if (!runtime || busy || error || waitingForSlice)
      throw new Error('Espera a que termine de cargar la vista.');
    const sequence = ++captureSequence.current;
    const image = await runtime.capture(activePlane);
    if (
      !alive.current ||
      sequence !== captureSequence.current ||
      latestCaptureContext.current !== captureContext
    )
      throw new DOMException('Captura cancelada', 'AbortError');
    return {
      ...image,
      id: crypto.randomUUID(),
      patientId: study.patientId,
      studyUid: study.uid,
      seriesUid: series.uid,
      caption: `${title} · ${study.date} · ${series.description || `Serie ${series.number}`} · ${labels[mode][activePlane]} · ${image.sliceLabel}`,
    };
  };
  const act = async (action: () => Promise<void>) => {
    setNotice('');
    try {
      await action();
    } catch (reason) {
      if (alive.current && !(reason instanceof DOMException && reason.name === 'AbortError'))
        setNotice(reason instanceof Error ? reason.message : 'No se pudo capturar la imagen.');
    }
  };
  const volumetric =
    (series.modality === 'CT' || series.modality === 'MR') && series.instances.length >= 3;
  return (
    <>
      <div className="dicom-toolbar" aria-label="Herramientas DICOM">
        <div className="dicom-button-group" aria-label="Modo de visualización">
          {(['original', 'mpr', '3d'] as const).map(value => (
            <button
              key={value}
              type="button"
              disabled={!runtime || busy || (value !== 'original' && (!volumetric || !complete))}
              aria-pressed={mode === value}
              onClick={() => {
                if (mode === value) return;
                captureSequence.current++;
                setBusy(true);
                setExpanded(null);
                setMode(value);
              }}
            >
              {value === 'original' ? 'Original' : value === 'mpr' ? 'MPR' : '3D'}
            </button>
          ))}
        </div>
        <div className="dicom-button-group">
          {(
            [
              { id: 'window', label: 'Ventana y nivel', icon: Scan },
              { id: 'pan', label: 'Mover', icon: Hand },
              { id: 'zoom', label: 'Zoom', icon: ZoomIn },
            ] as const
          ).map(tool => (
            <button
              type="button"
              key={tool.id}
              aria-label={tool.label}
              title={tool.label}
              aria-pressed={activeTool === tool.id}
              disabled={
                !runtime || busy || waitingForSlice || (mode === '3d' && tool.id === 'window')
              }
              onClick={() => {
                runtime?.tool(tool.id);
                setActiveTool(tool.id);
              }}
            >
              <tool.icon size={16} />
            </button>
          ))}
          {mode === '3d' && (
            <button
              type="button"
              aria-label="Rotar 3D"
              title="Rotar 3D"
              aria-pressed={activeTool === 'rotate'}
              disabled={!runtime || busy || waitingForSlice}
              onClick={() => {
                runtime?.tool('rotate');
                setActiveTool('rotate');
              }}
            >
              <RotateCcw size={16} />
            </button>
          )}
          <button
            type="button"
            title="Restablecer vista"
            aria-label="Restablecer vista"
            disabled={!runtime || busy || waitingForSlice}
            onClick={() => runtime?.reset()}
          >
            <RotateCcw size={16} />
          </button>
        </div>
        <select
          aria-label="Ventana predefinida"
          defaultValue=""
          disabled={
            !runtime || busy || waitingForSlice || mode === '3d' || series.modality !== 'CT'
          }
          onChange={event => {
            const [width, center] = event.target.value.split(',').map(Number);
            if (width) runtime?.window(width, center);
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
        <span className="dicom-toolbar-spacer" />
        <DicomFullscreenButton />
        <button
          type="button"
          aria-label="PNG"
          title="Descargar PNG"
          disabled={!runtime || busy || waitingForSlice || Boolean(error)}
          onClick={() => void act(() => saveDicomPng(capture))}
        >
          <Download size={15} />
          <span className="dicom-export-label">PNG</span>
        </button>
        {onCapture && (
          <button
            type="button"
            aria-label="Añadir al informe"
            title="Añadir al informe"
            disabled={!runtime || busy || waitingForSlice || Boolean(error)}
            onClick={() =>
              void act(async () => {
                onCapture(await capture());
                setNotice('Captura añadida a los anexos del informe.');
              })
            }
          >
            <Camera size={15} />
            <span className="dicom-export-label">Añadir al informe</span>
          </button>
        )}
      </div>
      {runtime && (
        <DicomAdvancedControls
          key={mode}
          runtime={runtime}
          mode={mode}
          modality={series.modality}
          disabled={busy || waitingForSlice || Boolean(error)}
          activeTool={activeTool}
          chooseTool={tool => {
            runtime.tool(tool);
            setActiveTool(tool);
          }}
        />
      )}
      {busy && (
        <div className="dicom-loading" role="status">
          {runtime ? 'Preparando vista…' : `Cargando imágenes · ${progress[0]}/${progress[1]}`}
          {!runtime && (
            <progress max={progress[1]} value={progress[0]} aria-label="Carga de imágenes" />
          )}
        </div>
      )}
      {excludesLocalizers && mode !== 'original' && !busy && (
        <p className="dicom-status dicom-volume-notice" role="status">
          MPR y 3D usan los cortes volumétricos. Los localizadores de planificación se conservan en
          Original y no forman parte del volumen.
        </p>
      )}
      {resampled && !busy && !error && (
        <p className="dicom-status dicom-volume-notice" role="status">
          Volumen remuestreado para combinar distintas matrices. La interpolación no añade detalle;
          comprueba los hallazgos en Original.
        </p>
      )}
      {error && (
        <p className="dicom-status" role="alert">
          {error}
          {runtime && mode !== 'original' && (
            <button type="button" onClick={() => setMode('original')}>
              Volver a original
            </button>
          )}
        </p>
      )}
      <DicomLoadControls
        progress={progress}
        state={mode === 'original' ? stackState : null}
        disabled={!runtime || busy || Boolean(error)}
        select={index => runtime?.select(index)}
      />
      <DicomViewportGrid
        mode={mode}
        title={title}
        busy={busy}
        error={error}
        pending={waitingForSlice}
        activePlane={activePlane}
        expanded={expanded}
        orientations={orientations}
        runtime={runtime}
        elements={elements}
        activate={setActivePlane}
        expand={setExpanded}
      />
      <div className="dicom-footer">
        <span>
          {mode === '3d'
            ? 'Rotar, acercar y ajustar tejido · recorte reversible'
            : mode === 'mpr' && activeTool === 'reference'
              ? 'Pulsa un punto para localizarlo en los tres planos · rueda para recorrer · coordenadas LPS en mm'
              : 'Rueda o flechas para recorrer · arrastrar para ajustar'}
        </span>
        {notice && <span role="status">{notice}</span>}
      </div>
    </>
  );
};
