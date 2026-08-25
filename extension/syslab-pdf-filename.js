/** Builds safe, human-readable filenames for individual and bundled Syslab PDFs. */
(function (root) {
  'use strict';

  const cleanPart = (value, fallback) => {
    const printable = [...String(value || '')]
      .filter(character => {
        const code = character.charCodeAt(0);
        return code > 31 && code !== 127;
      })
      .join('');
    return printable
      .normalize('NFC')
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s-]+|[.\s-]+$/g, '') || fallback;
  };

  const normalizeDate = value => {
    const text = String(value || '').trim();
    const dayFirst = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    const yearFirst = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
    const parts = dayFirst
      ? { day: dayFirst[1], month: dayFirst[2], year: dayFirst[3] }
      : yearFirst
        ? { day: yearFirst[3], month: yearFirst[2], year: yearFirst[1] }
        : null;
    if (!parts) return null;
    const day = parts.day.padStart(2, '0');
    const month = parts.month.padStart(2, '0');
    return { key: `${parts.year}-${month}-${day}`, label: `${day}-${month}-${parts.year}` };
  };

  const dateLabel = exams => {
    const dates = new Map();
    exams.forEach(exam => {
      const date = normalizeDate(exam && exam.date);
      if (date) dates.set(date.key, date.label);
    });
    const ordered = [...dates.entries()].sort(([left], [right]) => left.localeCompare(right));
    if (!ordered.length) return 'sin fecha';
    if (ordered.length === 1) return ordered[0][1];
    return `${ordered[0][1]} a ${ordered[ordered.length - 1][1]}`;
  };

  const build = ({ exams, rutDisplay }) => {
    const list = Array.isArray(exams) ? exams : [];
    const patientName = (list.find(exam => String(exam && exam.patientName || '').trim()) || {})
      .patientName;
    const base = [
      `Laboratorio HHR ${dateLabel(list)}`,
      cleanPart(patientName, 'Paciente'),
      cleanPart(rutDisplay, 'RUT no informado'),
    ].join(', ');
    return `${base.slice(0, 190).trim()}.pdf`;
  };

  root.HhrSyslabPdfFilename = Object.freeze({ build });
})(typeof self !== 'undefined' ? self : globalThis);
