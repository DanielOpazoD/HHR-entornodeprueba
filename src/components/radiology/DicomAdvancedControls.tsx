import {
  Crosshair,
  Ruler,
  Triangle,
  Trash2,
  Link2,
  SlidersHorizontal,
  Info,
  Circle,
  Pipette,
} from 'lucide-react';
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
  const [volume, setVolume] = useState(() => defaultVolumePresentation(modality));
  useEffect(() => runtime.onReference(setReference), [runtime]);

  const updateVolume = (patch: Partial<VolumePresentation>) => {
    const next = { ...volume, ...patch };
    setVolume(next);
    runtime.presentation(next);
  };
  return (
    <fieldset
      hidden={mode === 'original'}
      className="dicom-advanced"
      disabled={disabled}
      aria-label="Visualización avanzada"
    >
      {mode === 'mpr' && (
        <>
          <label title="Planos vinculados">
            <input
              type="checkbox"
              aria-label="Planos vinculados"
              checked={linked}
              onChange={event => {
                setLinked(event.target.checked);
                runtime.reference(event.target.checked, style);
                if (!event.target.checked && activeTool === 'reference') chooseTool('window');
              }}
            />{' '}
            <Link2 size={15} aria-hidden="true" /> <span>Vincular</span>
          </label>
          <button
            type="button"
            aria-label="Punto de referencia"
            title="Punto de referencia"
            aria-pressed={activeTool === 'reference'}
            disabled={!linked}
            onClick={() => chooseTool('reference')}
          >
            <Crosshair size={16} aria-hidden="true" />
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
            {[
              { id: 'probe', label: 'Lectura HU', icon: Pipette },
              { id: 'roi', label: 'ROI elíptica', icon: Circle },
            ].map(item => (
              <button
                key={item.id}
                type="button"
                aria-label={item.label}
                title={
                  runtime.quantitative()
                    ? item.label
                    : 'HU y ROI no disponibles: calibración no confirmada'
                }
                disabled={!runtime.quantitative()}
                aria-pressed={activeTool === item.id}
                onClick={() => chooseTool(item.id as DicomTool)}
              >
                <item.icon size={16} aria-hidden="true" />
                <span>{item.id === 'probe' ? 'HU' : 'ROI'}</span>
              </button>
            ))}

            <button
              type="button"
              aria-label="Distancia"
              title="Distancia"
              aria-pressed={activeTool === 'length'}
              onClick={() => chooseTool('length')}
            >
              <Ruler size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Ángulo"
              title="Ángulo"
              aria-pressed={activeTool === 'angle'}
              onClick={() => chooseTool('angle')}
            >
              <Triangle size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Borrar medidas"
              title="Borrar medidas"
              onClick={() => runtime.clearMeasurements()}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        </>
      )}
      {mode === 'mpr' && (
        <details className="dicom-popover dicom-help">
          <summary aria-label="Información de medidas" title="Información de medidas">
            <Info size={15} />
          </summary>
          <div className="dicom-popover-body">
            <small>
              Medidas temporales: no se guardan ni se incluyen en PNG o anexos. HU: pulsa un punto.
              ROI: arrastra una elipse; DE indica desviación estándar. Solo se habilitan con
              calibración HU y espaciado válidos. En volúmenes remuestreados las estadísticas
              corresponden al volumen interpolado.
            </small>
          </div>
        </details>
      )}
      {mode === '3d' && (
        <details className="dicom-popover dicom-volume-settings">
          <summary>
            <SlidersHorizontal size={15} /> Ajustes 3D
          </summary>
          <div className="dicom-popover-body">
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
          </div>
        </details>
      )}
    </fieldset>
  );
};
