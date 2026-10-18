import { useDicomReconstruction } from './useDicomReconstruction';
import React from 'react';
import { Maximize2, Minimize2, Minus, Plus } from 'lucide-react';
import type { DicomMode, DicomRuntime, DicomOrientation } from '@/services/radiology/dicomRuntime';

export const dicomPlaneLabels = {
  original: ['Original'],
  mpr: ['Axial', 'Coronal', 'Sagital'],
  '3d': ['3D'],
};
export const DicomViewportGrid: React.FC<{
  mode: DicomMode;
  keyboard?: boolean;
  title: string;
  busy: boolean;
  error: string;
  pending: boolean;
  activePlane: number;
  expanded: number | null;
  orientations: DicomOrientation[];
  runtime: DicomRuntime | null;
  elements: React.MutableRefObject<Array<HTMLDivElement | null>>;
  activate: (index: number) => void;
  expand: (index: number | null) => void;
}> = ({
  mode,
  keyboard = true,
  title,
  busy,
  error,
  pending,
  activePlane,
  expanded,
  orientations,
  runtime,
  elements,
  activate,
  expand,
}) => {
  const reconstruction = useDicomReconstruction(runtime);
  const currentOrientations =
    mode === 'mpr' && reconstruction ? (runtime?.orientations() ?? orientations) : orientations;
  return (
    <div
      className={`dicom-grid dicom-grid--${mode}`}
      aria-busy={busy || pending}
      data-expanded={expanded !== null}
    >
      {dicomPlaneLabels[mode].map((label, index) => (
        <div
          className="dicom-pane"
          key={`${mode}-${index}`}
          data-active={index === activePlane}
          data-concealed={expanded !== null && expanded !== index}
          data-expanded={expanded === index}
          aria-hidden={expanded !== null && expanded !== index}
        >
          {!busy && !error && currentOrientations[index] && (
            <div className="dicom-orientation" aria-hidden="true">
              {(['top', 'right', 'bottom', 'left'] as const).map(edge => (
                <span key={edge} className={`dicom-edge-${edge}`}>
                  {currentOrientations[index][edge]}
                </span>
              ))}
            </div>
          )}
          <button
            type="button"
            className="dicom-plane"
            aria-pressed={index === activePlane}
            onClick={() => activate(index)}
          >
            {label}
            {mode === 'mpr' && reconstruction?.planes[index]?.oblique ? ' · Oblicuo' : ''}
          </button>
          {mode === 'mpr' && reconstruction && (
            <output className="dicom-reconstruction-label" aria-label={`Reconstrucción ${label}`}>
              {reconstruction.planes[index]?.label}
            </output>
          )}
          {mode === 'mpr' && (
            <button
              type="button"
              className="dicom-expand-plane"
              aria-label={expanded === index ? 'Volver a los tres planos' : `Ampliar ${label}`}
              title={expanded === index ? 'Volver a los tres planos' : `Ampliar ${label}`}
              onClick={() => {
                activate(index);
                expand(expanded === index ? null : index);
              }}
            >
              {expanded === index ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          )}
          <div
            className="dicom-canvas"
            data-pending={pending || Boolean(error)}
            ref={element => {
              elements.current[index] = element;
            }}
            tabIndex={0}
            role="img"
            aria-label={`${label} · ${title}`}
            onFocus={() => activate(index)}
            onPointerDown={() => activate(index)}
            onContextMenu={event => event.preventDefault()}
            onKeyDownCapture={event => {
              // Cornerstone binds Z to a global history and prevents Tab by default.
              // Keep viewport shortcuts session-scoped and preserve native focus traversal.
              if (event.key !== 'Escape') event.stopPropagation();
              if (!keyboard || busy || error) return;
              if (
                (event.ctrlKey || event.metaKey) &&
                event.key.toLowerCase() === 'z' &&
                !event.shiftKey &&
                mode === 'mpr'
              ) {
                event.preventDefault();
                runtime?.undoMeasurement();
                return;
              }
              if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
              if (
                ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key) &&
                mode !== '3d'
              ) {
                event.preventDefault();
                runtime?.step(
                  index,
                  { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 }[event.key as 'ArrowUp']
                );
              }
              if (
                (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
                mode === 'mpr' &&
                expanded === null
              ) {
                event.preventDefault();
                const next = (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
                activate(next);
                elements.current[next]?.focus();
              }
            }}
          />
          {mode !== '3d' && (
            <div className="dicom-scroll-controls">
              <button
                type="button"
                aria-label={`Corte anterior ${label}`}
                disabled={!runtime || busy || Boolean(error)}
                onClick={() => runtime?.step(index, -1)}
              >
                <Minus size={14} />
              </button>
              <button
                type="button"
                aria-label={`Corte siguiente ${label}`}
                disabled={!runtime || busy || Boolean(error)}
                onClick={() => runtime?.step(index, 1)}
              >
                <Plus size={14} />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
