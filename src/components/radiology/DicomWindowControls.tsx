import React, { useState } from 'react';
import { Contrast } from 'lucide-react';
import type { DicomRuntime, DicomMode } from '@/services/radiology/dicomRuntimeTypes';
export const DicomWindowControls: React.FC<{
  runtime: DicomRuntime | null;
  mode: DicomMode;
  modality: string;
  disabled: boolean;
}> = ({ runtime, mode, modality, disabled }) => {
  const [inverted, setInverted] = useState(false);
  return (
    <>
      <select
        aria-label="Ventana predefinida"
        defaultValue=""
        disabled={!runtime || disabled || mode === '3d' || modality !== 'CT'}
        onChange={e => {
          const [width, center] = e.target.value.split(',').map(Number);
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
      {mode !== '3d' && (
        <button
          type="button"
          aria-label="Invertir grises"
          title="Invertir grises"
          aria-pressed={inverted}
          disabled={!runtime || disabled}
          onClick={() => {
            setInverted(!inverted);
            runtime?.invert(!inverted);
          }}
        >
          <Contrast size={16} />
        </button>
      )}
    </>
  );
};
