import type { jsPDF } from 'jspdf';

export interface AntecedentPrescriptionCopy {
  patientName: string;
  professional: string;
  facility: string;
  encounterDate: string;
  id: string;
  date: string;
  status: string;
  type: string;
  items: string[];
}

/** Full source text, paginated without interpreting doses or creating a new order. */
export const renderAntecedentPrescriptionCopy = (
  doc: jsPDF,
  copy: AntecedentPrescriptionCopy
): void => {
  const margin = 18;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  const bottom = doc.internal.pageSize.getHeight() - 22;
  let y = margin;
  const paragraph = (text: string, bold = false): void => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    for (const line of doc.splitTextToSize(text, width) as string[]) {
      if (y > bottom) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += 5;
    }
    y += 3;
  };
  doc.setFontSize(11);
  paragraph('Copia de receta registrada · Antecedentes Eloísa', true);
  paragraph(`Paciente: ${copy.patientName}`, true);
  paragraph(`Atención: ${copy.encounterDate} · ${copy.facility}`);
  paragraph(`Profesional: ${copy.professional}`);
  paragraph(`Receta N° ${copy.id}${copy.date ? ` · ${copy.date}` : ''}`, true);
  if (copy.type || copy.status) paragraph([copy.type, copy.status].filter(Boolean).join(' · '));
  copy.items.forEach((item, index) => paragraph(`${index + 1}. ${item}`));
  paragraph(
    'Copia informativa de las prescripciones registradas en la fuente. No es una nueva indicación.'
  );
  const pages = doc.getNumberOfPages();
  doc.setFontSize(9);
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.text(`${page} / ${pages}`, margin, doc.internal.pageSize.getHeight() - 12);
  }
};

export const downloadAntecedentPrescriptionCopy = async (
  copy: AntecedentPrescriptionCopy,
  signal?: AbortSignal
): Promise<void> => {
  if (signal?.aborted) return;
  if (!copy.patientName.trim() || !copy.id.trim() || !copy.items.length)
    throw new Error('La receta no tiene identificación suficiente para preparar la copia.');
  const { default: JsPDF } = await import('jspdf');
  if (signal?.aborted) return;
  const doc = new JsPDF({ format: 'a4', compress: true });
  renderAntecedentPrescriptionCopy(doc, copy);
  if (!signal?.aborted) doc.save(`receta-antecedente-${copy.id.replace(/[^\w-]/g, '_')}.pdf`);
};
