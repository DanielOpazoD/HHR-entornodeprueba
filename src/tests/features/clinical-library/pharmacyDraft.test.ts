import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPharmacyDraft,
  createPharmacyLine,
  searchPharmacyArsenal,
  validatePharmacyDraft,
} from '@/features/clinical-library/domain/pharmacy/pharmacyDraft';
import type { PharmacyActDraft } from '@/features/clinical-library/domain/pharmacy/pharmacyTypes';
import arsenal from '@/features/clinical-library/domain/pharmacy/arsenalHhr2025.json';

const professional = {
  name: 'Profesional de prueba',
  rut: '11.111.111-1',
  role: 'Enfermería',
  unit: 'Hospitalizados',
};
const validDraft = (): PharmacyActDraft => {
  const draft = createPharmacyDraft('return', professional);
  draft.lines = [
    {
      ...createPharmacyLine(),
      medicationId: 'manual',
      name: 'Insumo de prueba',
      presentation: 'Unidad',
      quantity: '1',
      reason: 'Sobre stock',
    },
  ];
  return draft;
};

afterEach(() => vi.useRealTimers());

describe('pharmacy act drafts', () => {
  it('uses the hospital calendar at mainland midnight and keeps the explicit professional role', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T03:30:00Z'));
    const draft = createPharmacyDraft('return', { ...professional, role: 'Médico' });
    expect(draft.date).toBe('2026-10-22');
    expect(draft.paperSize).toBe('a4');
    expect(draft.professional.role).toBe('Médico');
    expect(draft.professional).not.toBe(professional);
    expect(draft.lines[0].medicationId).toBe('');
    expect(createPharmacyLine().id).not.toBe(createPharmacyLine().id);
  });

  it.each(['a4', 'letter'] as const)('accepts supported paper size %s', paperSize => {
    const draft = validDraft();
    draft.paperSize = paperSize;
    expect(validatePharmacyDraft(draft)).toEqual([]);
  });

  it.each([undefined, null, '', 'legal', 'A4'])(
    'rejects unsupported paper size from JavaScript: %s',
    paperSize => {
      const draft = validDraft();
      Object.assign(draft, { paperSize });
      expect(validatePharmacyDraft(draft).join(' ')).toContain(
        'tamaño de papel válido: A4 o Carta'
      );
    }
  );

  it.each(['1', '0,5', '2.25'])(
    'accepts a positive quantity %s and optional patient for overstock',
    quantity => {
      const draft = validDraft();
      draft.lines[0].quantity = quantity;
      expect(validatePharmacyDraft(draft)).toEqual([]);
    }
  );

  it.each(['', '0', '-1', 'NaN', 'Infinity', '1e3', '1,2.3', '3 comprimidos', '9'.repeat(400)])(
    'rejects unsafe quantity %s',
    quantity => {
      const draft = validDraft();
      draft.lines[0].quantity = quantity;
      expect(validatePharmacyDraft(draft).join(' ')).toContain('Registro 1: la cantidad');
    }
  );

  it('requires professional and selected or explicit manual medication values', () => {
    const draft = validDraft();
    draft.professional = { name: '', rut: '11.111.111-2', role: '', unit: '' };
    draft.lines[0].medicationId = '';
    draft.lines[0].reason = '';
    const errors = validatePharmacyDraft(draft).join(' ');
    expect(errors).toContain('nombre del profesional');
    expect(errors).toContain('cargo');
    expect(errors).toContain('unidad');
    expect(errors).toContain('dígito verificador');
    expect(errors).toContain('modo manual');
    expect(errors).toContain('fundamento');
    draft.professional = { ...professional, rut: '' };
    expect(validatePharmacyDraft(draft).join(' ')).not.toContain('RUT');
  });

  it('checks that a catalog selection retains its actual medication and presentation', () => {
    const draft = validDraft();
    const item = arsenal.items[0];
    draft.lines[0] = {
      ...draft.lines[0],
      medicationId: item.id,
      name: item.name,
      presentation: item.presentation,
    };
    expect(validatePharmacyDraft(draft)).toEqual([]);
    draft.lines[0].presentation = 'Una presentación distinta';
    expect(validatePharmacyDraft(draft).join(' ')).toContain('no coincide con el arsenal');
    draft.lines[0].medicationId = 'manual';
    expect(validatePharmacyDraft(draft)).toEqual([]);
  });

  it('rejects calendar rollover and missing expired-product dates', () => {
    const draft = validDraft();
    draft.kind = 'disposal';
    draft.date = '2026-02-30';
    draft.lines[0].disposalCause = 'expired';
    let errors = validatePharmacyDraft(draft).join(' ');
    expect(errors).toContain('fecha válida');
    expect(errors).toContain('número y año');
    expect(errors).toContain('producto expirado');
    draft.date = '2026-10-22';
    draft.number = '1/2026';
    draft.lines[0].expiry = '2025-02-29';
    expect(validatePharmacyDraft(draft).join(' ')).toContain('fecha de vencimiento no es válida');
    draft.lines[0].expiry = '2026-01-31';
    expect(validatePharmacyDraft(draft)).toEqual([]);
    draft.lines[0].disposalCause = '';
    errors = validatePharmacyDraft(draft).join(' ');
    expect(errors).toContain('causa de eliminación');
  });

  it('rejects future expiry for expired disposal, accepts the same day and permits future return dates', () => {
    const draft = validDraft();
    draft.kind = 'disposal';
    draft.number = '1/2026';
    draft.date = '2026-10-22';
    draft.lines[0].disposalCause = 'expired';
    draft.lines[0].expiry = '2026-10-23';
    expect(validatePharmacyDraft(draft).join(' ')).toContain('no puede ser posterior');
    draft.lines[0].expiry = draft.date;
    expect(validatePharmacyDraft(draft)).toEqual([]);
    draft.lines[0].expiry = '2027-01-31';
    draft.kind = 'return';
    expect(validatePharmacyDraft(draft)).toEqual([]);
    draft.kind = 'disposal';
    draft.lines[0].disposalCause = 'damaged';
    expect(validatePharmacyDraft(draft)).toEqual([]);
  });

  it.each([undefined, null, 'other'])('rejects unsupported act kind from JavaScript: %s', kind => {
    const draft = validDraft();
    Object.assign(draft, { kind });
    expect(validatePharmacyDraft(draft).join(' ')).toContain('tipo de acta válido');
  });

  it.each([undefined, null, '', 'other'])(
    'rejects unsupported disposal cause from JavaScript: %s',
    disposalCause => {
      const draft = validDraft();
      draft.kind = 'disposal';
      draft.number = '1/2026';
      Object.assign(draft.lines[0], { disposalCause });
      expect(validatePharmacyDraft(draft).join(' ')).toContain(
        'selecciona la causa de eliminación'
      );
    }
  );

  it('rejects empty records and duplicate row identities', () => {
    const draft = validDraft();
    draft.lines.push({ ...draft.lines[0] });
    expect(validatePharmacyDraft(draft).join(' ')).toContain(
      'Registro 2: el registro está duplicado'
    );
    draft.lines = [];
    expect(validatePharmacyDraft(draft).join(' ')).toContain('al menos un');
  });

  it('searches accents, concentration, presentation and observations without altering source values', () => {
    const item = {
      id: 'one',
      name: 'Ácido de prueba 10 mg',
      presentation: 'Solución oral',
      observations: 'Uso restringido',
    };
    const items = [
      item,
      { ...item, id: 'two', name: 'Ácido de prueba 20 mg', presentation: 'Comprimido' },
    ];
    expect(searchPharmacyArsenal(items, 'acido 10 solucion')).toEqual([item]);
    expect(searchPharmacyArsenal(items, 'restringido')).toEqual(items);
    expect(searchPharmacyArsenal(items, '')).toEqual(items);
    expect(item.name).toBe('Ácido de prueba 10 mg');
  });
});
