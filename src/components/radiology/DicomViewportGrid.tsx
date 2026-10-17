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
}) => (
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
        {!busy && !error && orientations[index] && (
          <div className="dicom-orientation" aria-hidden="true">
            {(['top', 'right', 'bottom', 'left'] as const).map(edge => (
              <span key={edge} className={`dicom-edge-${edge}`}>
                {orientations[index][edge]}
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
        </button>
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
          onPointerDown={() => activate(index)}
          onContextMenu={event => event.preventDefault()}
          onKeyDown={event => {
            if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !busy && !error) {
              event.preventDefault();
              runtime?.step(index, event.key === 'ArrowUp' ? -1 : 1);
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
