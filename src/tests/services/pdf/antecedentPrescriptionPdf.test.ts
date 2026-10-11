// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { jsPDF } from 'jspdf';
import {
  downloadAntecedentPrescriptionCopy,
  renderAntecedentPrescriptionCopy,
  type AntecedentPrescriptionCopy,
} from '@/services/pdf/antecedentPrescriptionPdf';

const copy: AntecedentPrescriptionCopy = {
  id: '123',
  patientName: 'Paciente sintético',
  professional: 'Profesional de prueba',
  facility: 'Centro de prueba',
  encounterDate: '29-09-2026 10:30',
  date: '29-09-2026',
  status: 'Registrada',
  type: 'General',
  items: ['Medicación de prueba: 1 comprimido cada 24 horas por 30 días.'],
};
describe('read-only antecedent prescription PDF', () => {
  it('pagina sin perder contenido ni cambiar dosis y conserva la procedencia', () => {
    const doc = new jsPDF();
    const text = vi.spyOn(doc, 'text');
    const items = Array.from(
      { length: 80 },
      (_, index) => `${index}: ${copy.items[0]} ${'Descripción extensa. '.repeat(6)}`
    );
    renderAntecedentPrescriptionCopy(doc, { ...copy, items });
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    const written = text.mock.calls.map(([line]) => line).join(' ');
    expect(written).toContain('Copia de receta registrada');
    expect(written).toContain('Paciente sintético');
    expect(written).toContain('Receta N° 123');
    expect(written).toContain('79:');
    expect(written).toContain('1 comprimido cada 24 horas por 30 días.');
    expect(written).toContain('No es una nueva indicación.');
    for (const [, , y] of text.mock.calls)
      expect(y).toBeLessThanOrEqual(doc.internal.pageSize.getHeight() - 12);
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(1000);
  });
  it('no inicia una descarga cancelada y rechaza una copia sin paciente', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      downloadAntecedentPrescriptionCopy(copy, controller.signal)
    ).resolves.toBeUndefined();
    await expect(downloadAntecedentPrescriptionCopy({ ...copy, patientName: '' })).rejects.toThrow(
      'identificación'
    );
  });
});
