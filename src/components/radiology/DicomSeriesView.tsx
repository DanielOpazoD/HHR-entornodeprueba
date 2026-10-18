import type { DicomStudyPrefetch } from '@/services/radiology/dicomStudyPrefetch';
import type { DicomLoadState } from '@/services/radiology/dicomLoadState';
import React, { useEffect, useRef, useState } from 'react';
import { Camera, Download, Hand, RotateCcw, Scan, ZoomIn } from 'lucide-react';
import type { DicomCapture, DicomSeries, DicomStudy } from '@/services/radiology/dicomTypes';
import type {
  DicomMode,
  DicomRuntime,
  DicomTool,
  DicomOrientation,
} from '@/services/radiology/dicomRuntime';
import { DicomWindowControls } from './DicomWindowControls';
import { DicomKeyboardControls } from './DicomKeyboardControls';
import { DicomCineControls } from './DicomCineControls';
import { DicomAdvancedControls } from './DicomAdvancedControls';
import { DicomLoadControls } from './DicomLoadControls';
import { DicomViewportGrid, dicomPlaneLabels as labels } from './DicomViewportGrid';
import { DicomFullscreenButton } from './DicomFullscreenButton';
import type { DicomStackState } from '@/services/radiology/dicomProgressiveStack';
import { saveDicomPng } from '@/services/radiology/saveDicomPng';

export const DicomSeriesView: React.FC<{
  study: DicomStudy;
  prefetch?: DicomStudyPrefetch;
  series: DicomSeries;
  title: string;
  onCapture?: (capture: DicomCapture) => void;
}> = ({ study, series, title, onCapture, prefetch }) => {
  const [keyboard, setKeyboard] = useState(true);
  const [loading, setLoading] = useState<DicomLoadState | null>(null);
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
  const [busy, setBusy] = useState(true);
  const [cineBusy, setCineBusy] = useState(false);
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
    prefetch?.select(series.uid);
    void import('@/services/radiology/dicomRuntime')
      .then(({ createDicomRuntime }) =>
        createDicomRuntime(
          study,
          series,
          controller.signal,
          (loaded, total) => {
            if (!controller.signal.aborted) setProgress([loaded, total]);
          },
          prefetch?.fetch
        )
      )
      .then(value => {
        current = value;
        if (controller.signal.aborted) value.dispose();
        else {
          setRuntime(value);
          void value.completion
            .then(() => {
              if (!controller.signal.aborted) {
                setComplete(true);
                prefetch?.complete(series.uid);
              }
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
  }, [study, series, prefetch]);

  useEffect(() => {
    if (!runtime) return;
    let active = true;
    setBusy(true);
    setError('');
    setResampled(false);
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
        if (!state.pending) setOrientations(runtime.orientations());
      }),
    [runtime]
  );
  useEffect(() => runtime?.loading.subscribe(setLoading), [runtime]);
  const waitingForSlice = mode === 'original' && Boolean(stackState?.pending || stackState?.error);
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
      <fieldset className="dicom-interaction-lock">
        <div className="dicom-toolbar" aria-label="Herramientas DICOM">
          <div className="dicom-button-group" aria-label="Modo de visualización">
            {(['original', 'mpr', '3d'] as const).map(value => (
              <button
                key={value}
                type="button"
                disabled={
                  cineBusy ||
                  !runtime ||
                  busy ||
                  (value !== 'original' && (!volumetric || !complete))
                }
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
                { id: 'window', label: 'Contraste (ventana y nivel)', icon: Scan },
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
                  cineBusy ||
                  !runtime ||
                  busy ||
                  waitingForSlice ||
                  (mode === '3d' && tool.id === 'window')
                }
                onClick={() => {
                  runtime?.tool(tool.id);
                  setActiveTool(tool.id);
                }}
              >
                <tool.icon size={16} />
                {tool.id === 'window' && <span>Contraste</span>}
              </button>
            ))}
            {mode === '3d' && (
              <button
                type="button"
                aria-label="Rotar 3D"
                title="Rotar 3D"
                aria-pressed={activeTool === 'rotate'}
                disabled={cineBusy || !runtime || busy || waitingForSlice}
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
              disabled={cineBusy || !runtime || busy || waitingForSlice}
              onClick={() => runtime?.reset()}
            >
              <RotateCcw size={16} />
            </button>
          </div>
          <DicomWindowControls
            key={mode}
            runtime={runtime}
            mode={mode}
            modality={series.modality}
            disabled={cineBusy || busy || waitingForSlice}
          />
          {runtime && mode === 'original' && (
            <DicomCineControls
              key={runtime.sessionId}
              runtime={runtime}
              total={series.instances.length}
              complete={complete}
              available={loading?.available ?? []}
              disabled={busy || waitingForSlice || Boolean(error)}
              busyChanged={setCineBusy}
            />
          )}
          <span className="dicom-toolbar-spacer" />
          <DicomKeyboardControls
            enabled={keyboard}
            change={setKeyboard}
            undo={() => runtime?.undoMeasurement()}
            disabled={cineBusy || busy || !!error}
            canUndo={mode === 'mpr'}
          />
          <DicomFullscreenButton disabled={cineBusy} />
          <button
            type="button"
            aria-label="PNG"
            title="Descargar PNG"
            disabled={cineBusy || !runtime || busy || waitingForSlice || Boolean(error)}
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
              disabled={cineBusy || !runtime || busy || waitingForSlice || Boolean(error)}
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
            disabled={cineBusy || busy || waitingForSlice || Boolean(error)}
            activeTool={activeTool}
            chooseTool={tool => {
              runtime.tool(tool);
              setActiveTool(tool);
            }}
          />
        )}
      </fieldset>
      {busy && (
        <div className="dicom-loading" role="status">
          {loading?.volumeBuilding
            ? 'Construyendo volumen…'
            : runtime
              ? 'Preparando vista…'
              : `Cargando imágenes · ${progress[0]}/${progress[1]}`}
          {!runtime && (
            <progress max={progress[1]} value={progress[0]} aria-label="Carga de imágenes" />
          )}
        </div>
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
        loading={loading}
        controller={runtime?.loading}
        state={mode === 'original' ? stackState : null}
        disabled={cineBusy || !runtime || busy || Boolean(error)}
        select={index => runtime?.select(index)}
      />
      <DicomViewportGrid
        mode={mode}
        keyboard={keyboard}
        title={title}
        busy={busy || cineBusy}
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
      {notice && (
        <div className="dicom-footer" role="status">
          {notice}
        </div>
      )}
    </>
  );
};
