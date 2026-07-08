type ClinicalDocumentStatus = 'draft' | 'ready_for_signature' | 'signed' | 'archived';

export const formatClinicalDocumentDateTime = (isoString?: string): string => {
  if (!isoString) return '—';
  const value = new Date(isoString);
  return Number.isNaN(value.getTime())
    ? isoString
    : value.toLocaleString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
};

export const formatClinicalDocumentDate = (value?: string): string => {
  if (!value) return 'Sin fecha';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const year = parsed.getFullYear();
  return `${day}-${month}-${year}`;
};

export const resolveClinicalDocumentSourceDateLabel = (value?: string): string =>
  value ? formatClinicalDocumentDate(value) : 'Sin fecha';

export const formatClinicalDocumentPdfDate = (rawDate?: string): string | null => {
  if (!rawDate) return null;

  const dateOnlyMatch = rawDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    return resolveClinicalDocumentSourceDateLabel(rawDate);
  }

  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const year = parsed.getFullYear();
  return `${day}/${month}/${year}`;
};

export const getClinicalDocumentStatusLabel = (status: ClinicalDocumentStatus): string => {
  switch (status) {
    case 'ready_for_signature':
    case 'signed':
      return 'Borrador';
    case 'archived':
      return 'Archivada';
    default:
      return 'Borrador';
  }
};

export const getClinicalDocumentStatusClassName = (status: ClinicalDocumentStatus): string => {
  switch (status) {
    case 'signed':
    case 'ready_for_signature':
      return 'bg-slate-100 text-slate-600';
    case 'archived':
      return 'bg-slate-200 text-slate-600';
    default:
      return 'bg-slate-100 text-slate-600';
  }
};
