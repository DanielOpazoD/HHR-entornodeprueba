import { describe, expect, it } from 'vitest';

import {
  emptyTransferCover,
  formatCoverDate,
  isTransferCoverPrintable,
  normalizeCoverDateInput,
} from '@/features/clinical-library/domain/transferCover';
import { buildTransferCoverDocument } from '@/features/clinical-library/controllers/transferCoverPrint';

describe('transfer cover', () => {
  it('needs a name and a RUT before printing', () => {
    const cover = emptyTransferCover();
    expect(cover.admissionDate).toBe('');
    expect(isTransferCoverPrintable(cover)).toBe(false);
    expect(isTransferCoverPrintable({ ...cover, patientName: 'Ana Pakarati', rut: ' ' })).toBe(
      false
    );
    expect(
      isTransferCoverPrintable({ ...cover, patientName: 'Ana Pakarati', rut: '12.345.678-9' })
    ).toBe(true);
    expect(formatCoverDate('2026-09-06')).toBe('06-09-2026');
    expect(formatCoverDate('06-09-2026')).toBe('06-09-2026');
    expect(normalizeCoverDateInput('06-09-2026')).toBe('2026-09-06');
    expect(normalizeCoverDateInput(undefined)).toBe('');
    expect(normalizeCoverDateInput(null)).toBe('');
  });

  it('renders a landscape legal page by default and letter on demand, escaping the data', () => {
    const cover = {
      ...emptyTransferCover(),
      patientName: 'Ana <Pakarati>',
      rut: '12.345.678-9',
      age: '71',
      bedId: 'H2C1',
      admissionDate: '2026-09-06',
    };
    const legal = buildTransferCoverDocument(cover);
    expect(legal.title).toBe('Traslado · Ana <Pakarati>');
    expect(legal.styles).toContain('size: legal landscape');
    expect(legal.body).toContain('Ana &lt;Pakarati&gt;');
    expect(legal.body).toContain('RUT 12.345.678-9');
    expect(legal.body).toContain('71 años · Cama H2C1');
    expect(legal.body).toContain('06-09-2026');
    expect(legal.body).toContain('Fecha de ingreso a Hospital Hanga Roa');
    expect(legal.body).not.toContain('>Fecha<');
    expect(legal.body).toContain('Hospital del Salvador');
    expect(legal.body).toContain('/images/logos/logo_HHR.png');
    expect(legal.body.match(/class="box"/g)).toHaveLength(7);

    const letter = buildTransferCoverDocument({ ...cover, paper: 'carta', age: '', bedId: '' });
    expect(letter.styles).toContain('size: letter landscape');
    expect(letter.body).not.toContain('class="meta"');
  });
});
