import React, { useId, useState } from 'react';
import { Calculator } from 'lucide-react';
import type { DicomMeasurement } from '@/services/radiology/dicomMeasurementStore';
import { dicomMeasurementPlace } from '@/services/radiology/dicomMeasurementReport';
import { dicomDecimal } from '@/services/radiology/dicomMeasurementText';
import {
  dicomSegmentAngle,
  estimateAbcHalf,
  estimateEllipsoid,
} from '@/services/radiology/dicomVolumeEstimates';

type Field = { value: string; source?: string };
const number = (field: Field) => Number(field.value.replace(',', '.'));
const mm = (value: number) => dicomDecimal(value, 1);

/** A diameter typed in mm or taken from a distance measured in mm. */
const Diameter: React.FC<{
  label: string;
  field: Field;
  distances: DicomMeasurement[];
  change: (field: Field) => void;
}> = ({ label, field, distances, change }) => {
  const id = useId();
  return (
    <div className="dicom-calculator-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        inputMode="decimal"
        value={field.value}
        onChange={event => change({ value: event.target.value })}
      />
      <select
        aria-label={`${label}: tomar de una distancia`}
        value={field.source ?? ''}
        onChange={event => {
          const item = distances.find(candidate => candidate.id === event.target.value);
          change(
            item?.value?.length !== undefined
              ? { value: mm(item.value.length), source: item.id }
              : { value: field.value }
          );
        }}
      >
        <option value="">Distancia…</option>
        {distances.map(item => (
          <option key={item.id} value={item.id}>
            {dicomMeasurementPlace(item)} · {mm(item.value!.length!)} mm
          </option>
        ))}
      </select>
    </div>
  );
};

/**
 * Volume estimates for a transfer decision, with their formula. They use the distances already
 * measured, or values typed by the clinician, and are never a volumetry.
 */
export const DicomVolumeCalculator: React.FC<{
  items: readonly DicomMeasurement[];
  /** Read on each render: the series may complete after the panel first drew. */
  intervalOf?: () => number | undefined;
}> = ({ items, intervalOf }) => {
  const sliceInterval = intervalOf?.();
  const [formula, setFormula] = useState<'abc' | 'ellipsoid'>('abc');
  const [fields, setFields] = useState<Record<'a' | 'b' | 'c', Field>>({
    a: { value: '' },
    b: { value: '' },
    c: { value: '' },
  });
  const [slices, setSlices] = useState('');
  const [thickness, setThickness] = useState<string | null>(null);
  // Cross-sectional distances only: a radiograph's mm may be at the detector or undeclared.
  const distances = items.filter(
    item =>
      item.kind === 'length' &&
      (item.modality === 'CT' || item.modality === 'MR') &&
      item.value?.unit === 'mm' &&
      !item.value.calibration &&
      item.value.length !== undefined
  );
  const set = (key: 'a' | 'b' | 'c') => (field: Field) =>
    setFields(current => ({ ...current, [key]: field }));
  const interval = thickness ?? (sliceInterval ? mm(sliceInterval) : '');
  const step = number({ value: interval });
  const abc = estimateAbcHalf({
    a: number(fields.a),
    b: number(fields.b),
    slices: Number(slices),
    thickness: step,
  });
  const ellipsoid = estimateEllipsoid({
    a: number(fields.a),
    b: number(fields.b),
    c: number(fields.c),
  });
  const [first, second] = [fields.a.source, fields.b.source].map(id =>
    distances.find(item => item.id === id)
  );
  const sameSlice =
    first &&
    second &&
    first.seriesUid === second.seriesUid &&
    first.view === second.view &&
    first.slice === second.slice;
  const angle = sameSlice ? dicomSegmentAngle(first.points, second.points) : undefined;
  return (
    <details className="dicom-calculator">
      <summary>
        <Calculator size={14} aria-hidden="true" /> Volumen estimado
      </summary>
      <div className="dicom-calculator-body">
        <label>
          Fórmula
          <select
            aria-label="Fórmula de volumen"
            value={formula}
            onChange={event => setFormula(event.target.value as 'abc' | 'ellipsoid')}
          >
            <option value="abc">ABC/2 · hemorragia intracerebral</option>
            <option value="ellipsoid">Elipsoide · π/6 · a · b · c</option>
          </select>
        </label>
        {formula === 'abc' ? (
          <>
            <Diameter
              label="A, diámetro mayor (mm)"
              field={fields.a}
              distances={distances}
              change={set('a')}
            />
            <Diameter
              label="B, perpendicular a A en el mismo corte (mm)"
              field={fields.b}
              distances={distances}
              change={set('b')}
            />
            {first && second && !sameSlice && (
              <small role="note">A y B deben medirse en el mismo corte.</small>
            )}
            {angle !== undefined && Math.abs(90 - angle) > 15 && (
              <small role="note">
                A y B forman {dicomDecimal(angle, 0)}°; B debe ser perpendicular a A.
              </small>
            )}
            <label>
              Cortes con hemorragia
              <input
                aria-label="Cortes con hemorragia"
                inputMode="numeric"
                value={slices}
                onChange={event => setSlices(event.target.value)}
              />
            </label>
            <label>
              Intervalo entre cortes (mm)
              <input
                aria-label="Intervalo entre cortes (mm)"
                inputMode="decimal"
                value={interval}
                onChange={event => setThickness(event.target.value)}
              />
            </label>
            <small>
              {sliceInterval && thickness === null
                ? 'Intervalo tomado de la posición de los cortes de esta serie; confírmalo.'
                : 'Ingresa el intervalo entre cortes de la serie medida.'}
            </small>
            <output aria-label="Resultado ABC/2">
              {abc
                ? `C = ${slices} × ${mm(step)} mm = ${mm(abc.c)} mm. ` +
                  `ABC/2 = ${mm(number(fields.a))} × ${mm(number(fields.b))} × ${mm(abc.c)} / 2 = ` +
                  `${dicomDecimal(abc.ml, 1)} mL (estimado)`
                : 'Completa A, B, cortes e intervalo.'}
            </output>
          </>
        ) : (
          <>
            {(['a', 'b', 'c'] as const).map(key => (
              <Diameter
                key={key}
                label={`${key}, diámetro (mm)`}
                field={fields[key]}
                distances={distances}
                change={set(key)}
              />
            ))}
            <small>Tres diámetros ortogonales; pueden medirse en los planos de MPR.</small>
            <output aria-label="Resultado elipsoide">
              {ellipsoid
                ? `π/6 × ${mm(number(fields.a))} × ${mm(number(fields.b))} × ${mm(number(fields.c))} = ` +
                  `${dicomDecimal(ellipsoid.ml, 1)} mL (estimado)`
                : 'Completa los tres diámetros.'}
            </output>
          </>
        )}
        <small>Estimación geométrica: no reemplaza la volumetría ni el informe radiológico.</small>
      </div>
    </details>
  );
};
