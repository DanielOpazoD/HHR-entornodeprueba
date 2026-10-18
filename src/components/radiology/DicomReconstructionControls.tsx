import React, { useState } from 'react';
import { Rotate3D, RotateCcw } from 'lucide-react';
import type { DicomRuntime, DicomTool } from '@/services/radiology/dicomRuntimeTypes';
import type { MprReconstructionState } from '@/services/radiology/dicomMprReconstruction';
import { useDicomReconstruction } from './useDicomReconstruction';

export const DicomReconstructionControls: React.FC<{
  runtime: DicomRuntime;
  chooseTool: (tool: DicomTool) => void;
}> = ({ runtime, chooseTool }) => {
  const state = useDicomReconstruction(runtime);
  const [error, setError] = useState('');
  if (!state) return null;
  const update = (patch: Parameters<DicomRuntime['reconstruct']>[0]) => {
    try {
      runtime.reconstruct(patch);
      chooseTool((patch?.rotate ?? (patch && state.rotate)) ? 'reference' : 'window');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo reconstruir.');
    }
  };
  return (
    <details className="dicom-popover dicom-volume-settings">
      <summary aria-label="Reconstrucción MPR" title="Reconstrucción MPR">
        <Rotate3D size={16} />
      </summary>
      <div className="dicom-popover-body">
        <label>
          <input
            type="checkbox"
            aria-label="Rotar planos"
            checked={state.rotate}
            onChange={event => update({ rotate: event.target.checked })}
          />{' '}
          Rotar planos
        </label>
        <label>
          Espesor (mm)
          <input
            aria-label="Espesor MPR en milímetros"
            type="number"
            min="0"
            max="50"
            step="0.5"
            value={state.thickness}
            onChange={event => update({ thickness: Number(event.target.value) })}
          />
        </label>
        <label>
          Proyección
          <select
            aria-label="Proyección MPR"
            value={state.mode}
            disabled={!state.thickness}
            onChange={event =>
              update({ mode: event.target.value as MprReconstructionState['mode'] })
            }
          >
            <option value="average">Promedio</option>
            <option value="mip">MIP</option>
            <option value="minip">MinIP</option>
          </select>
        </label>
        <button type="button" onClick={() => update(null)}>
          <RotateCcw size={15} /> Restablecer MPR
        </button>
        <small>
          0 mm: corte fino. Arrastra los tiradores de las líneas para rotar. El espesor es total y
          se centra en cada plano; «Parcial» indica recorte en el borde del volumen en el punto de
          referencia.
        </small>
        {!state.quantitative && (
          <small>
            HU y ROI disponibles en corte fino ortogonal. Distancia y ángulo miden sobre el plano
            central.
          </small>
        )}
        {error && <small role="alert">{error}</small>}
      </div>
    </details>
  );
};
