import { buildExamColumnKey } from '@/features/laboratory/hospitalization-reports';
import { formatLabResult, parseDateDDMMYYYY, parseLabMeasurement } from '@/features/laboratory';
import type { LabAnalysisData } from '@/types/domain/labAnalyticsTypes';
import type { LabResultRow, SyslabExamItem } from '@/types/domain/labExamTypes';

export interface LabPoint {
  /** Comparison column of the report ("DD/MM/YYYY HH:MM", with seconds and order id on collisions). */
  columnKey: string;
  dayIso: string;
  time: string;
  /** Raw value in the raw unit, so the scale and its label never disagree. */
  value: number;
  display: string;
}

export interface LabVariable {
  /** Stable identity (analysis and normalized unit); the shown name may gain a unit suffix. */
  id: string;
  /** The analysis name; with the unit appended when the same analysis arrives in several units. */
  name: string;
  analysis: string;
  unit: string;
  points: LabPoint[];
}

export interface LabDayRow {
  columnKey: string;
  name: string;
  time: string;
  display: string;
  unit: string;
  refValue: string;
}

export interface LabSeriesModel {
  /** Numeric variables with at least one result, in clinical order. */
  variables: LabVariable[];
  /** Days with at least one report, oldest first. */
  days: string[];
}

/** Clinical reading order; anything else follows alphabetically. */
const PREFERRED_ORDER = [
  'Creatinina',
  'Proteina C Reactiva',
  'Hemoglobina',
  'Recuento Leucocitos',
  'Recuento de Plaquetas',
  'Sodio',
  'Potasio',
  'Nitrogeno Ureico',
  'Glicemia',
  'Protrombina',
  'INR',
  'Lactato',
  'pH',
  'Bilirrubina Total',
  'Albumina',
];
const DEFAULT_VARIABLES = ['Creatinina', 'Proteina C Reactiva', 'Hemoglobina'];
const COLUMN_KEY = /^(\d{1,2}\/\d{1,2}\/\d{4})(?: (\d{2}:\d{2}(?::\d{2})?))?/;

const rank = (name: string): number => {
  const index = PREFERRED_ORDER.indexOf(name);
  return index === -1 ? PREFERRED_ORDER.length : index;
};
export const compareVariableNames = (a: string, b: string): number =>
  rank(a) - rank(b) || a.localeCompare(b, 'es');

/**
 * Splits a comparison column key ("DD/MM/YYYY HH:MM", "DD/MM/YYYY (#id)", or
 * "DD/MM/YYYY HH:MM:SS (#id)" when two orders share a minute) into day and time. Seconds are kept
 * only when the report carried them, so two orders of the same minute stay apart.
 */
export const parseColumnKey = (columnKey: string): { dayIso: string; time: string } | null => {
  const [, datePart, timePart] = COLUMN_KEY.exec(columnKey) ?? [];
  return datePart ? { dayIso: parseDateDDMMYYYY(datePart), time: timePart ?? '' } : null;
};

const byDayAndTime = (a: LabPoint, b: LabPoint): number =>
  a.dayIso.localeCompare(b.dayIso) || a.time.localeCompare(b.time);

/** "umol/L", "µmol/L" and "μmol/L" are one unit; spacing and case do not split a series either. */
const normalizeUnit = (unit: string): string =>
  unit
    .replace(/\s+/g, '')
    .replace(/[\u00b5\u03bc]/g, 'u')
    .toLowerCase();

/**
 * Numeric series per analysis and unit from the comparison matrix, in the raw unit Syslab used.
 * Qualitative results and bounded values such as "<5" are left to the day table; they have no
 * place on a scale. An analysis reported in two units becomes two series, never one curve.
 */
export const buildLabSeriesModel = (
  analysis: LabAnalysisData,
  exams: readonly SyslabExamItem[]
): LabSeriesModel => {
  const series = new Map<string, LabVariable>();
  for (const [name, columns] of Object.entries(analysis.comparison)) {
    for (const [columnKey, row] of Object.entries(columns)) {
      const when = parseColumnKey(columnKey);
      if (!when || row.qualitative) continue;
      const measurement = parseLabMeasurement(row.result, row);
      if (!measurement || measurement.comparator !== '=') continue;
      const unit = row.unit.trim();
      const key = `${name}|${normalizeUnit(unit)}`;
      const variable = series.get(key) ?? { id: key, name, analysis: name, unit, points: [] };
      variable.points.push({
        columnKey,
        ...when,
        value: measurement.value,
        display: row.result.trim(),
      });
      series.set(key, variable);
    }
  }
  const variables = [...series.values()];
  const unitsPerAnalysis = new Map<string, number>();
  for (const variable of variables) {
    unitsPerAnalysis.set(variable.analysis, (unitsPerAnalysis.get(variable.analysis) ?? 0) + 1);
  }
  for (const variable of variables) {
    variable.points.sort(byDayAndTime);
    if ((unitsPerAnalysis.get(variable.analysis) ?? 0) > 1) {
      variable.name = `${variable.analysis} · ${variable.unit || 'sin unidad'}`;
    }
  }
  variables.sort(
    (a, b) => compareVariableNames(a.analysis, b.analysis) || a.unit.localeCompare(b.unit)
  );
  const days = [...new Set(exams.map(exam => parseDateDDMMYYYY(exam.date)))].sort();
  return { variables, days };
};

/** Ids of creatinina, PCR and hemoglobina when present; otherwise the first variables with a trend. */
export const selectDefaultLabVariables = (variables: readonly LabVariable[], limit: number) => {
  const ids = variables.map(variable => variable.id);
  const preferred = variables
    .filter(variable => DEFAULT_VARIABLES.includes(variable.analysis))
    .map(variable => variable.id);
  if (preferred.length) return preferred.slice(0, limit);
  const trending = variables.filter(variable => variable.points.length > 1).map(v => v.id);
  return (trending.length ? trending : ids).slice(0, limit);
};

/** Every result reported on one day, numeric or not, in clinical order. */
export const buildLabDayRows = (analysis: LabAnalysisData, dayIso: string): LabDayRow[] => {
  const rows: LabDayRow[] = [];
  for (const [name, columns] of Object.entries(analysis.comparison)) {
    for (const [columnKey, row] of Object.entries(columns) as Array<[string, LabResultRow]>) {
      const when = parseColumnKey(columnKey);
      if (!when || when.dayIso !== dayIso) continue;
      const formatted = formatLabResult(row.result, row.unit);
      rows.push({
        columnKey,
        name,
        time: when.time,
        display: formatted.display,
        unit: formatted.displayUnit || row.unit,
        refValue: row.refValue,
      });
    }
  }
  return rows.sort(
    (a, b) => compareVariableNames(a.name, b.name) || a.columnKey.localeCompare(b.columnKey)
  );
};

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Calendar day as a UTC noon instant: pure calendar arithmetic, device clock not involved. */
const calendarUtc = (iso: string, dayOffset = 0): number => {
  const [, year = '1970', month = '01', day = '01'] = ISO_DAY.exec(iso) ?? [];
  return Date.UTC(Number(year), Number(month) - 1, Number(day) + dayOffset, 12);
};

export const calendarDaysBetween = (fromIso: string, toIso: string): number =>
  Math.round((calendarUtc(toIso) - calendarUtc(fromIso)) / 86_400_000);

const pad2 = (value: number): string => String(value).padStart(2, '0');

export const addCalendarDays = (iso: string, days: number): string => {
  const date = new Date(calendarUtc(iso, days));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
};

/** Bound date labels by available pixels, not by the length of a hospitalization. */
export const buildLabAxisDays = (startIso: string, endIso: string, width: number): string[] => {
  const lastDay = Math.max(0, calendarDaysBetween(startIso, endIso));
  if (lastDay === 0) return [endIso];
  const spacing = startIso.slice(0, 4) === endIso.slice(0, 4) ? 72 : 104;
  const slots = Math.max(2, Math.floor(width / spacing) + 1);
  const step = Math.max(1, Math.ceil(lastDay / (slots - 1)));
  const days: string[] = [];
  for (let offset = 0; offset < lastDay; offset += step) {
    // Reserve enough room for the final date and its census label.
    if (offset > 0 && lastDay - offset < step * 0.75) continue;
    days.push(addCalendarDays(startIso, offset));
  }
  days.push(endIso);
  return days;
};

/** Round scale with three to five clean ticks around the values. */
export const buildNiceTicks = (
  min: number,
  max: number
): { min: number; max: number; ticks: number[] } => {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / 2;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * power).find(s => s >= raw) ?? power * 10;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = lo; value <= hi + step / 1000; value += step) ticks.push(+value.toFixed(6));
  if (ticks.length < 2) ticks.push(+(lo + step).toFixed(6));
  return { min: ticks[0] ?? lo, max: ticks[ticks.length - 1] ?? hi, ticks };
};

const numberFormat = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 });
export const formatLabNumber = (value: number): string => numberFormat.format(value);

/** Last six source columns, retaining the original order identity even without a visible time. */
export const buildRecentLabColumns = (
  analysis: LabAnalysisData,
  exams: SyslabExamItem[],
  throughDay: string
) => {
  const sources = new Map(exams.map(exam => [buildExamColumnKey(exam, exam.date, exams), exam]));
  return analysis.examDates
    .flatMap(key => {
      const when = parseColumnKey(key);
      return when && when.dayIso <= throughDay ? [{ key, ...when, exam: sources.get(key) }] : [];
    })
    .sort(
      (a, b) =>
        b.dayIso.localeCompare(a.dayIso) ||
        b.time.localeCompare(a.time) ||
        b.key.localeCompare(a.key)
    )
    .slice(0, 6);
};
