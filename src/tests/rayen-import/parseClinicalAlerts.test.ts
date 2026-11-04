import { describe, expect, it } from 'vitest';
import { parseClinicalAlerts } from '@/features/rayen-import/mapping/parseClinicalAlerts';

const active = (overrides: Record<string, unknown> = {}) => ({
  guid: 'g-1',
  id: 11,
  observation: 'Nota sintética',
  startDateTime: '2026-09-30T12:16:00.0-05:00',
  endDateTime: null,
  archived: false,
  deleted: false,
  deletedDateTime: null,
  isSigned: true,
  visitor: false,
  authorHealthCarePractitionerName: 'Profesional Sintético',
  authorHealthCarePractitionerRoleName: 'Enfermera(o)',
  ...overrides,
});

describe('parseClinicalAlerts', () => {
  it('keeps the active notes Eloísa shows, newest first, on the Rapa Nui clock', () => {
    expect(
      parseClinicalAlerts([
        active(),
        // A mainland-offset instant is converted, not read off its own clock (TIME-02).
        active({ guid: 'g-2', startDateTime: '2026-10-02T09:05:00-03:00', visitor: true }),
      ])
    ).toEqual([
      {
        id: 'g-2',
        text: 'Nota sintética',
        recordedAt: '2026-10-02T07:05',
        author: 'Profesional Sintético',
        role: 'Enfermera(o)',
        visitor: true,
      },
      {
        id: 'g-1',
        text: 'Nota sintética',
        recordedAt: '2026-09-30T12:16',
        author: 'Profesional Sintético',
        role: 'Enfermera(o)',
      },
    ]);
  });

  it.each([
    ['archived', { archived: true }],
    ['deleted', { deleted: true }],
    ['deleted with a date', { deletedDateTime: '2026-10-01T10:00:00-05:00' }],
    ['ended', { endDateTime: '2026-10-01T10:00:00-05:00' }],
    ['an unsigned draft', { isSigned: false }],
    ['without text', { observation: '   ' }],
    ['without an offset on its time', { startDateTime: '2026-09-30T12:16:00' }],
  ])('leaves out a note that is %s', (_case, overrides) => {
    expect(parseClinicalAlerts([active(overrides)])).toEqual([]);
  });

  it('keeps one copy of a repeated note and falls back to the numeric id', () => {
    const parsed = parseClinicalAlerts([active({ guid: '' }), active({ guid: '' }), null, 'x']);
    expect(parsed.map(alert => alert.id)).toEqual(['11']);
  });
});
