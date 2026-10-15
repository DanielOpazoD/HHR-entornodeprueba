import type { Worksheet } from 'exceljs';
import type { CudyrReportRow } from '@/types/domain/cudyrReport';
import type { CudyrSupplementPatient } from '@/types/domain/cudyrSupplement';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import type { CudyrSourceSheet } from './cudyrSourceTypes';
import { cudyrSourceAdmissionInstant, resolveCudyrSourceEpisode } from './cudyrSourceEpisode';

type Marker = { date: string; time: string; kind: 'Ingreso' | 'Egreso' };
const validDate = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(date)) &&
  new Date(date).toISOString().slice(0, 10) === date;
const validTime = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

/** Use proven episode context. Never infer an admission date from the first category. */
export const markCudyrSourceMovements = (
  sheet: Worksheet,
  source: CudyrSourceSheet,
  patients: CudyrSupplementPatient[],
  rows: CudyrReportRow[],
  excerpt: boolean,
  excludedDates: Map<number, Set<string>> = new Map(),
  allPatients: CudyrSupplementPatient[] = patients
) => {
  if (!source.reportId) return;
  patients.forEach((patient, index) => {
    const context = resolveCudyrSourceEpisode(
      source.reportId!,
      source.month,
      patient,
      allPatients,
      rows
    );
    if (!context) return;
    const { own, episode, boundary } = context;
    const markers: Marker[] = [];
    const at = cudyrSourceAdmissionInstant(own);
    if (at !== null) {
      const stamp = calendarStampInClinicalTimeZone(new Date(at));
      const admissionCell = sheet.getCell(index + 2, 5);
      admissionCell.value = new Date(`${stamp.iso}T00:00:00Z`);
      admissionCell.numFmt = 'dd-mm-yyyy';
      admissionCell.note =
        `Ingreso confirmado en HHR: ${stamp.iso} ${stamp.hhmm} (Rapa Nui), mismo episodio vinculado.` +
        (boundary
          ? ' Cruce de mes: documento y nombre completo coincidentes con un único episodio y egreso confirmado del día 1.'
          : '');
      markers.push({ date: stamp.iso, time: stamp.hhmm, kind: 'Ingreso' });
    }
    const discharges = own.flatMap(r =>
      r.movements
        .filter(
          m =>
            m.clinicalEpisodeId === episode &&
            ['discharges', 'transfers'].includes(m.section) &&
            m.source === 'gestion_camas' &&
            validDate(m.date)
        )
        .map(m => ({
          date: m.date,
          time: validTime(m.time) ? m.time : '',
          kind: 'Egreso' as const,
        }))
    );
    const corrections = own.flatMap(r =>
      r.correction?.clinicalEpisodeId === episode ? [r.correction] : []
    );
    const latest = Math.max(0, ...corrections.map(c => c.revision));
    const corrected = corrections.filter(c => c.revision === latest).map(c => c.actualDischarge);
    const departures =
      corrected.length && corrected.every(c => c && validDate(c.date))
        ? corrected.map(c => ({
            date: c!.date,
            time: validTime(c!.time || '') ? c!.time! : '',
            kind: 'Egreso' as const,
          }))
        : corrected.some(Boolean)
          ? []
          : discharges;
    const unique = new Map(departures.map(m => [`${m.date}|${m.time}`, m]));
    if (unique.size === 1) markers.push([...unique.values()][0]);
    for (const day of patient.days.filter(d => !excerpt || d.sourceDay === 1)) {
      if (excludedDates.get(patient.sourceRow)?.has(day.sourceDate)) continue;
      const matches = markers.filter(m => m.date === day.sourceDate);
      if (!matches.length) continue;
      const cell = sheet.getCell(index + 2, 7 + day.sourceDay);
      cell.value = {
        richText: [
          ...matches.map(m => ({
            text: `${m.kind === 'Ingreso' ? '▼' : '▲'} `,
            font: { color: { argb: m.kind === 'Ingreso' ? 'FF047857' : 'FF475569' } },
          })),
          { text: day.originalValue, font: { color: { argb: 'FF111827' } } },
        ],
      };
      cell.note =
        matches
          .map(
            m =>
              `${m.kind}: ${m.date}${m.time ? ` ${m.time}` : ' · hora no informada'} (Rapa Nui) · HHR, episodio vinculado.\n`
          )
          .join('') + `Valor original Eloísa: ${day.originalValue || '(vacío)'}`;
    }
  });
};
