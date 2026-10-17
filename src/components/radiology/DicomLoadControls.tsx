import React from 'react';
import type { DicomStackState } from '@/services/radiology/dicomProgressiveStack';

export const DicomLoadControls: React.FC<{
  progress: number[];
  state: DicomStackState | null;
  disabled: boolean;
  select: (index: number) => void;
}> = ({ progress, state, disabled, select }) => (
  <div className="dicom-load-controls">
    <span role="status">
      {progress[0] < progress[1]
        ? `${progress[0]}/${progress[1]} imágenes · descargando`
        : `${progress[1]} imágenes · serie completa`}
    </span>
    <progress max={progress[1]} value={progress[0]} aria-label="Descarga de la serie" />
    {state && (
      <>
        <label htmlFor="dicom-slice-position">Corte</label>
        <input
          id="dicom-slice-position"
          aria-label="Corte solicitado"
          type="range"
          min="1"
          max={progress[1]}
          value={state.requested + 1}
          disabled={disabled}
          onChange={event => select(Number(event.target.value) - 1)}
        />
        <output aria-label="Estado del corte">
          {state.pending
            ? `Cargando ${state.requested + 1}/${progress[1]}…`
            : `${(state.current ?? state.requested) + 1}/${progress[1]}`}
        </output>
      </>
    )}
  </div>
);
