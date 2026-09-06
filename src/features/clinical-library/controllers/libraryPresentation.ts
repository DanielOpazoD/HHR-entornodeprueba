import type { LibraryDocumentFormat } from '../domain/libraryCatalogTypes';
import type { ScoreTone } from '../domain/scoreEngine';

export interface DocumentFormatBadge {
  label: string;
  className: string;
  hint: string;
}

export const DOCUMENT_FORMAT_BADGES: Readonly<Record<LibraryDocumentFormat, DocumentFormatBadge>> =
  {
    pdf: { label: 'PDF', className: 'border-slate-200 bg-slate-50 text-slate-600', hint: 'PDF' },
    docx: { label: 'DOCX', className: 'border-slate-200 bg-slate-50 text-slate-600', hint: 'Word' },
    image: {
      label: 'IMG',
      className: 'border-slate-200 bg-slate-50 text-slate-600',
      hint: 'Imagen',
    },
  };

export const TONE_BADGE_CLASSES: Readonly<Record<ScoreTone, string>> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  info: 'border-medical-200 bg-medical-50 text-medical-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-red-200 bg-red-50 text-red-800',
};

export const formatDocumentSize = (sizeKb: number): string =>
  sizeKb >= 1024
    ? `${(sizeKb / 1024).toLocaleString('es-CL', { maximumFractionDigits: 1 })} MB`
    : `${Math.round(sizeKb)} KB`;

export const documentPagesLabel = (pages?: number): string | null =>
  pages ? `${pages} ${pages === 1 ? 'página' : 'páginas'}` : null;

export const documentFileName = (url: string): string => {
  const rawName = (url.split('/').pop() ?? '').trim();
  try {
    return decodeURIComponent(rawName) || 'documento';
  } catch {
    return rawName || 'documento';
  }
};

/** Decimales proporcionales a la magnitud: 0,012 · 1,75 · 26,3 · 105. */
export const formatClinicalNumber = (value: number, maxDecimals?: number): string => {
  const magnitude = Math.abs(value);
  // Una dosis real nunca debe leerse como cero: bajo el último decimal se muestra el umbral.
  const decimalsCap = maxDecimals ?? 3;
  const floor = 10 ** -decimalsCap / 2;
  if (magnitude > 0 && magnitude < floor) {
    return `< ${floor.toLocaleString('es-CL', { maximumFractionDigits: decimalsCap + 1 })}`;
  }
  const decimals =
    maxDecimals ?? (magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : magnitude >= 1 ? 2 : 3);
  return value.toLocaleString('es-CL', { maximumFractionDigits: decimals });
};
