import React from 'react';
import { Keyboard, Undo2 } from 'lucide-react';
export const DicomKeyboardControls: React.FC<{
  enabled: boolean;
  change: (value: boolean) => void;
  undo: () => void;
  disabled: boolean;
  canUndo: boolean;
}> = ({ enabled, change, undo, disabled, canUndo }) => (
  <details className="dicom-popover dicom-keyboard">
    <summary aria-label="Teclado" title="Teclado">
      <Keyboard size={16} />
    </summary>
    <div className="dicom-popover-body">
      <label>
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={e => change(e.target.checked)}
        />{' '}
        Atajos en el plano
      </label>
      <dl>
        <dt>↑ / ↓</dt>
        <dd>Corte anterior / siguiente</dd>
        <dt>Re Pág / Av Pág</dt>
        <dd>10 cortes</dd>
        <dt>← / →</dt>
        <dd>Plano anterior / siguiente</dd>
        <dt>⌘ Z / Ctrl Z</dt>
        <dd>Deshacer última medición</dd>
        <dt>Tab</dt>
        <dd>Recorrer controles</dd>
      </dl>
      <button type="button" disabled={disabled || !canUndo} onClick={undo}>
        <Undo2 size={15} /> Deshacer medición
      </button>
    </div>
  </details>
);
