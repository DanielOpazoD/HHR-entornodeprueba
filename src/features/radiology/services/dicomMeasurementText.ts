import type { DicomImageInfo } from './dicomImageRegistry';

export type DicomMeasurementKind =
  | 'length'
  | 'angle'
  | 'cobb'
  | 'probe'
  | 'ellipse'
  | 'rectangle'
  | 'circle';
/** `hu` only for classic CT with a validated HU mapping; `pixel` is a stored value, no unit. */
export type DicomDensity = 'hu' | 'pixel' | 'none';

export interface DicomMeasurementValue {
  kind: DicomMeasurementKind;
  length?: number;
  /** mm when the image has a physical spacing; px otherwise. Never mm without spacing. */
  unit?: 'mm' | 'px';
  area?: number;
  /** Cornerstone's calibration label for projection radiographs (ERMF, Proj, Calibrated…). */
  calibration?: string;
  angle?: number;
  density?: DicomDensity;
  value?: number;
  mean?: number;
  stdDev?: number;
  min?: number;
  max?: number;
  /** An ROI outside the image or without area: no statistic is shown for it. */
  invalid?: boolean;
}

type Stats = Record<string, unknown> | undefined;
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const dicomDensity = (
  info: Pick<DicomImageInfo, 'modality' | 'huCalibrated' | 'color'> | undefined
): DicomDensity => {
  if (!info || info.color) return 'none';
  if (info.modality === 'CT') return info.huCalibrated ? 'hu' : 'none';
  return 'pixel';
};

/** Cornerstone writes units as `mm`, `mm²`, `px`, `px²`, optionally followed by its label. */
export const parseDicomUnit = (unit: unknown) => {
  if (typeof unit !== 'string') return undefined;
  const [base, ...label] = unit.trim().split(/\s+/);
  const physical = base === 'mm' || base === 'mm²';
  if (!physical && base !== 'px' && base !== 'px²') return undefined;
  return { unit: physical ? ('mm' as const) : ('px' as const), calibration: label.join(' ') };
};

const densityOf = (stats: NonNullable<Stats>, density: DicomDensity) =>
  density === 'pixel' || (density === 'hu' && stats.modalityUnit === 'HU') ? density : 'none';

export const readDicomMeasurement = (
  kind: DicomMeasurementKind,
  stats: Stats,
  density: DicomDensity
): DicomMeasurementValue | undefined => {
  if (!stats) return undefined;
  if (kind === 'length') {
    const unit = parseDicomUnit(stats.unit);
    return unit && finite(stats.length) && stats.length >= 0
      ? { kind, length: stats.length, ...unit }
      : undefined;
  }
  if (kind === 'angle' || kind === 'cobb')
    return finite(stats.angle) ? { kind, angle: stats.angle } : undefined;
  if (kind === 'probe') {
    const shown = densityOf(stats, density);
    if (shown === 'none') return { kind, density: 'none' };
    return finite(stats.value) ? { kind, density: shown, value: stats.value } : undefined;
  }
  const unit = parseDicomUnit(stats.areaUnit);
  if (!unit || stats.isEmptyArea || !finite(stats.area) || stats.area <= 0)
    return { kind, invalid: true };
  const area = { kind, area: stats.area, ...unit };
  const shown = densityOf(stats, density);
  if (shown === 'none' || !finite(stats.mean) || !finite(stats.stdDev) || stats.stdDev < 0)
    return { ...area, density: 'none' };
  return {
    ...area,
    density: shown,
    mean: stats.mean,
    stdDev: stats.stdDev,
    min: finite(stats.min) ? stats.min : undefined,
    max: finite(stats.max) ? stats.max : undefined,
  };
};

const calibrationLabels: Record<string, string> = {
  ERMF: 'en paciente, ERMF',
  Calibrated: 'calibrada con referencia',
  Proj: 'en detector',
  Unknown: 'calibración no declarada',
  User: 'calibración manual',
  Error: 'calibración con error',
};
/** Where a radiograph distance was calibrated, following Cornerstone's labels. */
export const dicomCalibrationLabel = (
  value: Pick<DicomMeasurementValue, 'unit' | 'calibration'>
) =>
  value.unit === 'px'
    ? 'sin calibrar'
    : value.calibration
      ? (calibrationLabels[value.calibration] ?? `calibración ${value.calibration}`)
      : '';
const suffix = (value: DicomMeasurementValue) => {
  const label = dicomCalibrationLabel(value);
  return label ? ` (${label})` : '';
};

const unavailable = (modality: string) =>
  modality === 'CT' ? 'HU no disponible' : 'Valor no disponible';
const roiNames = { ellipse: 'ROI', rectangle: 'ROI rectangular', circle: 'ROI circular' };

/** Lines drawn next to the annotation; decimals match the existing MPR labels. */
export const dicomMeasurementLines = (
  kind: DicomMeasurementKind,
  value: DicomMeasurementValue | undefined,
  modality: string
): string[] => {
  if (kind === 'length')
    return value?.length === undefined
      ? ['Distancia no disponible']
      : [`${value.length.toFixed(1)} ${value.unit}${suffix(value)}`];
  if (kind === 'angle' || kind === 'cobb')
    return value?.angle === undefined
      ? ['Ángulo incompleto']
      : [`${kind === 'cobb' ? 'Cobb ' : ''}${value.angle.toFixed(1)}°`];
  if (kind === 'probe') {
    if (!value || value.density === 'none' || value.value === undefined)
      return [unavailable(modality)];
    return value.density === 'hu'
      ? [`${value.value.toFixed(1)} HU`]
      : [`Valor de píxel: ${value.value.toFixed(1)}`];
  }
  if (!value || value.invalid || value.area === undefined) return ['ROI no válida'];
  const lines = [`Área: ${value.area.toFixed(1)} ${value.unit}²${suffix(value)}`];
  if (value.density === 'none' || value.mean === undefined || value.stdDev === undefined)
    return [...lines, unavailable(modality)];
  const unit = value.density === 'hu' ? ' HU' : '';
  lines.push(
    value.density === 'hu'
      ? `Promedio: ${value.mean.toFixed(1)} HU`
      : `Valor de píxel: ${value.mean.toFixed(1)}`,
    `DE: ${value.stdDev.toFixed(1)}${unit}`
  );
  if (value.min !== undefined && value.max !== undefined)
    lines.push(`Mín/Máx: ${value.min.toFixed(0)} / ${value.max.toFixed(0)}${unit}`);
  return lines;
};

/** Spanish decimals for clinical notes: comma, fixed digits, never «-0». */
export const dicomDecimal = (value: number, digits: number) => {
  const rounded = Number(value.toFixed(digits));
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(digits).replace('.', ',');
};
const area = (value: DicomMeasurementValue) =>
  value.unit === 'px'
    ? `${dicomDecimal(value.area!, 0)} px²`
    : value.area! >= 100
      ? `${dicomDecimal(value.area! / 100, 1)} cm²`
      : `${dicomDecimal(value.area!, 1)} mm²`;

/** One measurement as plain Spanish text, e.g. «ROI 35 UH (DE 8), área 1,2 cm²». */
export const dicomMeasurementSummary = (
  kind: DicomMeasurementKind,
  value: DicomMeasurementValue | undefined,
  modality: string
): string => {
  if (kind === 'length')
    return value?.length === undefined
      ? 'distancia no disponible'
      : `distancia ${dicomDecimal(value.length, value.unit === 'px' ? 0 : 1)} ${value.unit}${suffix(value)}`;
  if (kind === 'angle' || kind === 'cobb') {
    const name = kind === 'cobb' ? 'ángulo de Cobb' : 'ángulo';
    return value?.angle === undefined
      ? `${name} incompleto`
      : `${name} ${dicomDecimal(value.angle, 1)}°`;
  }
  if (kind === 'probe') {
    if (!value || value.density === 'none' || value.value === undefined)
      return modality === 'CT' ? 'densidad: UH no disponible' : 'densidad no disponible';
    return value.density === 'hu'
      ? `densidad ${dicomDecimal(value.value, 0)} UH`
      : `valor de píxel ${dicomDecimal(value.value, 0)}`;
  }
  const name = roiNames[kind];
  if (!value || value.invalid || value.area === undefined) return `${name} no válida`;
  const where = `área ${area(value)}${suffix(value)}`;
  if (value.density === 'none' || value.mean === undefined || value.stdDev === undefined)
    return `${name}, ${where}${modality === 'CT' ? ' (UH no disponible)' : ''}`;
  const mean = dicomDecimal(value.mean, 0);
  const deviation = dicomDecimal(value.stdDev, 0);
  return value.density === 'hu'
    ? `${name} ${mean} UH (DE ${deviation}), ${where}`
    : `${name} valor de píxel ${mean} (DE ${deviation}), ${where}`;
};
