import React, { useEffect, useState } from 'react';
import type { DicomMode, DicomRuntime, DicomTool } from '@/services/radiology/dicomRuntime';
import type { DicomReference, ReferenceStyle } from '@/services/radiology/dicomMprTools';
import {
  defaultVolumePresentation,
  volumeLooks,
  type VolumePresentation,
} from '@/services/radiology/dicomPresentation';

export const DicomAdvancedControls: React.FC<{
  runtime: DicomRuntime;
  mode: DicomMode;
  modality: string;
  disabled: boolean;
  activeTool: DicomTool;
  chooseTool: (tool: DicomTool) => void;
}> = ({ runtime, mode, modality, disabled, activeTool, chooseTool }) => {
  const [reference, setReference] = useState<DicomReference | null>(null);
  const [linked, setLinked] = useState(true);
  const [style, setStyle] = useState<ReferenceStyle>('lines');
  const [inverted, setInverted] = useState(false);
  const [volume, setVolume] = useState(() => defaultVolumePresentation(modality));
  useEffect(() => runtime.onReference(setReference), [runtime]);

  const updateVolume = (patch: Partial<VolumePresentation>) => {
    const next = { ...volume, ...patch };
    setVolume(next);
    runtime.presentation(next);
  };
  return (
    <fieldset className="dicom-advanced" disabled={disabled} aria-label="Visualización avanzada">
      {mode === 'mpr' && (
        <>
          <label>
            <input
              type="checkbox"
              checked={linked}
              onChange={event => {
                setLinked(event.target.checked);
                runtime.reference(event.target.checked, style);
                if (!event.target.checked && activeTool === 'reference') chooseTool('window');
              }}
            />{' '}
            Planos vinculados
          </label>
          <button
            type="button"
            aria-pressed={activeTool === 'reference'}
            disabled={!linked}
            onClick={() => chooseTool('reference')}
          >
            Punto de referencia
          </button>
          <select
            aria-label="Marcador de referencia"
            value={style}
            disabled={!linked}
            onChange={event => {
              const next = event.target.value as ReferenceStyle;
              setStyle(next);
              runtime.reference(linked, next);
            }}
          >
            <option value="lines">Líneas cruzadas</option>
            <option value="point">Punto</option>
          </select>
          <output className="dicom-coordinates" aria-label="Coordenadas del punto LPS">
            {linked && reference
              ? `L ${reference.point[0].toFixed(1)} · P ${reference.point[1].toFixed(1)} · S ${reference.point[2].toFixed(1)} mm`
              : 'Referencia desactivada'}
          </output>
          <div className="dicom-button-group">
            <button
              type="button"
              aria-pressed={activeTool === 'length'}
              onClick={() => chooseTool('length')}
            >
              Distancia
            </button>
            <button
              type="button"
              aria-pressed={activeTool === 'angle'}
              onClick={() => chooseTool('angle')}
            >
              Ángulo
            </button>
            <button type="button" onClick={() => runtime.clearMeasurements()}>
              Borrar medidas
            </button>
          </div>
        </>
      )}
      {mode === 'mpr' && (
        <small>Medidas temporales: no se guardan ni se incluyen en PNG o anexos.</small>
      )}
      {mode !== '3d' && (
        <button
          type="button"
          aria-pressed={inverted}
          onClick={() => {
            setInverted(!inverted);
            runtime.invert(!inverted);
          }}
        >
          Invertir grises
        </button>
      )}
      {mode === '3d' && (
        <>
          <label>
            Apariencia
            <select
              aria-label="Tejido 3D"
              value={volume.preset}
              onChange={e => updateVolume({ preset: e.target.value })}
            >
              {(modality === 'MR' ? volumeLooks.MR : volumeLooks.CT).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Opacidad{' '}
            <input
              aria-label="Opacidad 3D"
              type="range"
              min="5"
              max="100"
              value={volume.opacity}
              onChange={e => updateVolume({ opacity: Number(e.target.value) })}
            />
            <output>{volume.opacity}%</output>
          </label>
          {modality === 'CT' && (
            <label>
              Desplazar umbral{' '}
              <input
                aria-label="Desplazamiento del umbral 3D"
                type="range"
                min="-1000"
                max="1000"
                step="10"
                value={volume.shift}
                onChange={e => updateVolume({ shift: Number(e.target.value) })}
              />
              <output>{volume.shift} HU</output>
            </label>
          )}
          <label>
            <input
              type="checkbox"
              checked={volume.shading}
              onChange={e => updateVolume({ shading: e.target.checked })}
            />{' '}
            Iluminación 3D
          </label>
          <label>
            Recorte
            <select
              aria-label="Eje de recorte 3D"
              value={volume.clipAxis}
              onChange={e =>
                updateVolume({ clipAxis: e.target.value as VolumePresentation['clipAxis'] })
              }
            >
              <option value="none">Sin recorte</option>
              <option value="x">Derecha / izquierda</option>
              <option value="y">Anterior / posterior</option>
              <option value="z">Inferior / superior</option>
            </select>
          </label>
          <label>
            Profundidad{' '}
            <input
              aria-label="Profundidad de recorte 3D"
              disabled={volume.clipAxis === 'none'}
              type="range"
              min="0"
              max="95"
              value={volume.clipPercent}
              onChange={e => updateVolume({ clipPercent: Number(e.target.value) })}
            />
            <output>{volume.clipPercent}%</output>
          </label>
          <label>
            <input
              type="checkbox"
              disabled={volume.clipAxis === 'none'}
              checked={volume.clipReverse}
              onChange={e => updateVolume({ clipReverse: e.target.checked })}
            />{' '}
            Desde el lado opuesto
          </label>
          <button
            type="button"
            onClick={() => {
              const defaults = defaultVolumePresentation(modality);
              setVolume(defaults);
              runtime.presentation(defaults);
              runtime.reset();
            }}
          >
            Restablecer 3D
          </button>
          <small>
            Los ajustes de tejido filtran intensidades; no separan órganos. El recorte solo afecta
            esta vista.
          </small>
        </>
      )}
    </fieldset>
  );
};
