import React, { useEffect, useState } from 'react';
import {
  Circle,
  CircleDot,
  Info,
  Pipette,
  Ruler,
  Spline,
  Square,
  Trash2,
  Triangle,
  Undo2,
} from 'lucide-react';
import type { DicomTool } from '@/services/radiology/dicomRuntimeTypes';
import './dicomMeasurements.css';

export type DicomMeasureTool = Extract<
  DicomTool,
  'length' | 'angle' | 'cobb' | 'probe' | 'roi' | 'rectangle' | 'circle'
>;
const tools: Array<{ id: DicomMeasureTool; label: string; icon: typeof Ruler; text?: string }> = [
  { id: 'length', label: 'Distancia', icon: Ruler },
  { id: 'angle', label: 'Ángulo', icon: Triangle },
  { id: 'cobb', label: 'Ángulo de Cobb', icon: Spline, text: 'Cobb' },
  { id: 'probe', label: 'Densidad puntual', icon: Pipette },
  { id: 'roi', label: 'ROI elíptica', icon: Circle },
  { id: 'rectangle', label: 'ROI rectangular', icon: Square },
  { id: 'circle', label: 'ROI circular', icon: CircleDot },
];

/** A small status line with the HU under the pointer; empty outside validated CT. */
export const DicomCursorHu: React.FC<{
  subscribe?: (listener: (value: number | null) => void) => () => void;
}> = ({ subscribe }) => {
  const [value, setValue] = useState<number | null>(null);
  // The runtime reports null when its view closes, so a new view never shows an old value.
  useEffect(() => subscribe?.(setValue), [subscribe]);
  return (
    <output className="dicom-cursor-hu" aria-label="HU bajo el cursor">
      {value === null ? '' : `Cursor: ${Math.round(value)} HU`}
    </output>
  );
};

/** Measurements on Original and Comparar. They last while the viewer is open; none is saved. */
export const DicomMeasureTools: React.FC<{
  activeTool: string;
  choose: (tool: DicomMeasureTool) => void;
  undo: () => void;
  clear: () => void;
  disabled: boolean;
  onCursorHu?: (listener: (value: number | null) => void) => () => void;
  /** Inside an existing toolbar (Comparar) instead of its own row, so the panes keep their size. */
  inline?: boolean;
}> = ({ activeTool, choose, undo, clear, disabled, onCursorHu, inline }) => (
  <fieldset
    className={inline ? 'dicom-measure-inline' : 'dicom-advanced dicom-measure'}
    disabled={disabled}
    aria-label="Mediciones"
  >
    <div className="dicom-button-group">
      {tools.map(tool => (
        <button
          key={tool.id}
          type="button"
          aria-label={tool.label}
          title={tool.label}
          aria-pressed={activeTool === tool.id}
          onClick={() => choose(tool.id)}
        >
          <tool.icon size={16} aria-hidden="true" />
          {tool.text && <span>{tool.text}</span>}
        </button>
      ))}
      <button
        type="button"
        aria-label="Deshacer última medición"
        title="Deshacer última medición (Ctrl/⌘ Z)"
        onClick={undo}
      >
        <Undo2 size={16} aria-hidden="true" />
      </button>
      <button type="button" aria-label="Borrar medidas" title="Borrar medidas" onClick={clear}>
        <Trash2 size={16} aria-hidden="true" />
      </button>
    </div>
    <DicomCursorHu subscribe={onCursorHu} />
    <details className="dicom-popover dicom-help">
      <summary aria-label="Información de mediciones" title="Información de mediciones">
        <Info size={15} />
      </summary>
      <div className="dicom-popover-body">
        <small>
          Las medidas duran mientras el visor está abierto: se conservan al cambiar de serie o de
          vista y se borran al cerrarlo. No se guardan ni se incluyen en PNG, MP4 o anexos. HU solo
          aparece en TC con calibración HU válida; en RX, RM y otras modalidades la densidad es un
          valor de píxel, sin unidad. En radiografías la distancia indica si la calibración es en el
          paciente (ERMF), en el detector o no declarada; sin espaciado se mide en píxeles.
        </small>
      </div>
    </details>
  </fieldset>
);
