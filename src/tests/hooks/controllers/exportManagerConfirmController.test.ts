import { describe, expect, it } from 'vitest';
import {
  buildBackupHandoffConfirmDescriptor,
  formatBackupExportDate,
} from '@/hooks/controllers/exportManagerConfirmController';

describe('formatBackupExportDate', () => {
  it('reverses YYYY-MM-DD into DD-MM-YYYY', () => {
    expect(formatBackupExportDate('2026-05-03')).toBe('03-05-2026');
  });
});

describe('buildBackupHandoffConfirmDescriptor', () => {
  it('builds the "Guardar" prompt for the first archive', () => {
    const descriptor = buildBackupHandoffConfirmDescriptor({
      recordDate: '2026-05-03',
      selectedShift: 'day',
      isArchived: false,
    });

    expect(descriptor.title).toBe('💾 Guardar Respaldo PDF');
    expect(descriptor.confirmText).toBe('Guardar');
    expect(descriptor.variant).toBe('info');
    expect(descriptor.message).toContain('03-05-2026');
    expect(descriptor.message).toMatch(/Turno/i);
  });

  it('builds the "Actualizar" prompt with overwrite warning when an archive already exists', () => {
    const descriptor = buildBackupHandoffConfirmDescriptor({
      recordDate: '2026-05-03',
      selectedShift: 'night',
      isArchived: true,
    });

    expect(descriptor.title).toBe('💾 Actualizar Respaldo PDF');
    expect(descriptor.confirmText).toBe('Actualizar');
    expect(descriptor.variant).toBe('warning');
    expect(descriptor.message).toMatch(/sobrescribir/i);
    expect(descriptor.message).toContain('03-05-2026');
    expect(descriptor.message).toMatch(/Turno/i);
  });
});
