import { describe, expect, it } from 'vitest';
import {
  formatTransferDate,
  formatTransferDateTime,
  formatTransferVerboseDateTime,
  getTransferStatusLabel,
  getTransferStatusPresentation,
  getTransferStatusShortLabel,
} from '@/shared/transfers/transferPresentation';

describe('transferPresentation', () => {
  it('formatea fecha y fecha-hora de traslado en locale chileno', () => {
    expect(formatTransferDate('2026-03-15T10:30:00.000Z')).toMatch(/15-03-2026|15\/03\/2026/);
    expect(formatTransferDateTime('2026-03-15T10:30:00.000Z')).toContain('15');
    expect(formatTransferVerboseDateTime('2026-03-15T10:30:00.000Z')).toContain('2026');
  });

  it('mantiene la fecha de solicitud clinica sin retroceder por zona horaria', () => {
    expect(formatTransferDate('2026-06-05')).toMatch(/05-06-2026|05\/06\/2026/);
  });

  it('centraliza label y tonos de estado', () => {
    expect(getTransferStatusLabel('REJECTED')).toBe('Rechazado');
    expect(getTransferStatusPresentation('SIGNED' as never).label).toBe('Desconocido');
  });

  it('returns full label for accepted sub-states', () => {
    expect(getTransferStatusLabel('ACCEPTED_WITH_CAPACITY')).toBe('Aceptado · Cupo confirmado');
    expect(getTransferStatusLabel('ACCEPTED_WAITING_CAPACITY')).toBe('Aceptado · En espera cupo');
  });

  it('returns short label for dropdown display', () => {
    expect(getTransferStatusShortLabel('ACCEPTED_WITH_CAPACITY')).toBe('Cupo confirmado');
    expect(getTransferStatusShortLabel('ACCEPTED_WAITING_CAPACITY')).toBe('En espera cupo');
    expect(getTransferStatusShortLabel('REQUESTED')).toBe('Solicitado');
  });
});
