import { BEDS } from '@/constants/beds';
import type { MMRADExam, MMRADSearchResult } from '@/services/radiology/mmradService';
import { getTodayISO } from '@/utils/dateCoreUtils';

interface RadiologyPatient {
  bedId: string;
  label: string;
  patientName: string;
  rut: string;
  diagnosis?: string;
}

export const buildUniqueRadiologyPatients = (patients: RadiologyPatient[]): RadiologyPatient[] => {
  const bedOrder = new Map(BEDS.map((bed, idx) => [bed.id, idx]));
  const seen = new Set<string>();

  return patients
    .filter(patient => {
      if (!patient.rut || seen.has(patient.rut)) {
        return false;
      }
      seen.add(patient.rut);
      return true;
    })
    .sort((a, b) => (bedOrder.get(a.bedId) ?? 999) - (bedOrder.get(b.bedId) ?? 999));
};

export const extractMMRADModalities = (exams: MMRADExam[]): string[] => {
  const modalities = new Set<string>();
  for (const exam of exams) {
    const modality = (exam.mod || '').trim().toUpperCase();
    if (modality) {
      modalities.add(modality);
    }
  }

  return Array.from(modalities).sort((a, b) => {
    if (a === 'CT') return -1;
    if (b === 'CT') return 1;
    return a.localeCompare(b);
  });
};

const mmradDateToTimestamp = (raw: string): number => {
  if (!raw) return 0;
  const parts = raw.split(/[/.-]/);
  if (parts.length === 3 && parts[0].length <= 2) {
    const [dd, mm, yyyy] = parts;
    return new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`).getTime() || 0;
  }
  return new Date(raw).getTime() || 0;
};

export const buildFilteredMMRADExams = (
  result: MMRADSearchResult | null,
  activeModTab: string | null
): MMRADExam[] => {
  if (!result) return [];

  const exams = activeModTab
    ? result.examenes.filter(exam => (exam.mod || '').trim().toUpperCase() === activeModTab)
    : [...result.examenes];

  exams.sort((a, b) => mmradDateToTimestamp(b.fecha_examen) - mmradDateToTimestamp(a.fecha_examen));
  return exams;
};

export const resolveInitialMMRADModalityTab = (modalities: string[]): string | null => {
  if (modalities.length === 0) return null;
  return modalities.includes('CT') ? 'CT' : null;
};

export const resolveMMRADDatePresetRange = (
  preset: 'last-month' | 'last-year' | 'last-5-years',
  now = new Date()
): { from: string; to: string } => {
  const to = getTodayISO(now);
  const from = new Date(`${to}T12:00:00Z`);

  if (preset === 'last-month') {
    from.setUTCMonth(from.getUTCMonth() - 1);
  } else if (preset === 'last-year') {
    from.setUTCFullYear(from.getUTCFullYear() - 1);
  } else {
    from.setUTCFullYear(from.getUTCFullYear() - 5);
  }

  return {
    from: from.toISOString().split('T')[0],
    to,
  };
};

export const buildMMRADExamKey = (exam: MMRADExam): string =>
  exam.informe_html_url || exam.pdf_url || `${exam.nombre_examen}-${exam.fecha_examen}`;
