// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { parseBackupDateParts } from '@/services/backup/storageContracts';

describe('storageContracts', () => {
  it('parses valid YYYY-MM-DD date parts', () => {
    expect(parseBackupDateParts('2026-02-19', 'Test')).toEqual({
      year: '2026',
      month: '02',
      day: '19',
    });
  });

  it('throws for malformed date format', () => {
    expect(() => parseBackupDateParts('19-02-2026', 'Test')).toThrow(
      'Formato de fecha inválido. Use YYYY-MM-DD.'
    );
  });

  it('throws for impossible calendar dates', () => {
    expect(() => parseBackupDateParts('2026-02-30', 'Backup')).toThrow(
      '[Backup] Fecha inválida: 2026-02-30'
    );
  });
});
