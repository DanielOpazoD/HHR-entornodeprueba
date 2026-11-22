import { describe, expect, it } from 'vitest';
import type { Reminder, ReminderVisibilityContext } from '@/types/reminders';
import type { ReminderDraftInput } from '@/features/reminders/domain/reminderValidation';
import {
  validateReminderDraft,
  buildReminderFromDraft,
} from '@/features/reminders/domain/reminderValidation';
import {
  isReminderVisible,
  filterVisibleReminders,
  sortRemindersByPriority,
  getReminderUnreadCount,
  hasUrgentVisibleReminders,
} from '@/shared/reminders/reminderVisibility';
import {
  formatReminderDateRange,
  formatReminderPriorityLabel,
  formatReminderShiftLabel,
  formatReminderReceiptDate,
} from '@/shared/reminders/reminderPresentation';
import {
  buildReminderReadReceiptId,
  REMINDER_IMAGE_MAX_BYTES,
} from '@/services/reminders/reminderShared';
import {
  REMINDER_TYPE_LABELS,
  REMINDER_PRIORITY_LABELS,
  getReminderRoleLabel,
} from '@/shared/reminders/reminderUiOptions';

/* ------------------------------------------------------------------ */
/*  Test data builders                                                 */
/* ------------------------------------------------------------------ */

const buildReminder = (overrides?: Partial<Reminder>): Reminder => ({
  id: 'rem-1',
  title: 'Control de stock',
  message: 'Validar insumos del turno.',
  type: 'warning',
  targetRoles: ['nurse_hospital'],
  targetShifts: ['day'],
  startDate: '2026-03-01',
  endDate: '2026-03-31',
  priority: 2,
  isActive: true,
  createdBy: 'admin-1',
  createdByName: 'Jefatura',
  createdAt: '2026-03-10T08:00:00.000Z',
  updatedAt: '2026-03-10T08:00:00.000Z',
  ...overrides,
});

const buildContext = (
  overrides?: Partial<ReminderVisibilityContext>
): ReminderVisibilityContext => ({
  role: 'nurse_hospital',
  shift: 'day',
  currentDate: '2026-03-15',
  readReminderIds: [],
  ...overrides,
});

const buildDraft = (overrides?: Partial<ReminderDraftInput>): ReminderDraftInput => ({
  title: 'Test reminder',
  message: 'Test message',
  type: 'info',
  targetRoles: ['nurse_hospital'],
  targetShifts: ['day'],
  startDate: '2026-03-01',
  endDate: '2026-03-31',
  priority: 2,
  isActive: true,
  ...overrides,
});

/* ================================================================== */
/*  validateReminderDraft                                              */
/* ================================================================== */

describe('validateReminderDraft', () => {
  it('returns no issues for a valid draft', () => {
    const issues = validateReminderDraft(buildDraft());
    expect(issues).toHaveLength(0);
  });

  it('requires a non-empty title', () => {
    const issues = validateReminderDraft(buildDraft({ title: '   ' }));
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'title' })]));
  });

  it('requires a non-empty message', () => {
    const issues = validateReminderDraft(buildDraft({ message: '' }));
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'message' })]));
  });

  it('requires at least one target role', () => {
    const issues = validateReminderDraft(buildDraft({ targetRoles: [] }));
    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'targetRoles' })])
    );
  });

  it('requires at least one target shift', () => {
    const issues = validateReminderDraft(buildDraft({ targetShifts: [] }));
    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'targetShifts' })])
    );
  });

  it('rejects missing dates', () => {
    const issues = validateReminderDraft(buildDraft({ startDate: '', endDate: '' }));
    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'dateRange' })])
    );
  });

  it('rejects start date after end date', () => {
    const issues = validateReminderDraft(
      buildDraft({ startDate: '2026-04-01', endDate: '2026-03-01' })
    );
    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'dateRange' })])
    );
  });

  it('rejects priority out of range', () => {
    const issues = validateReminderDraft(buildDraft({ priority: 5 }));
    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'priority' })])
    );
  });

  it('rejects priority of 0', () => {
    const issues = validateReminderDraft(buildDraft({ priority: 0 }));
    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'priority' })])
    );
  });

  it('collects multiple issues at once', () => {
    const issues = validateReminderDraft(
      buildDraft({
        title: '',
        message: '',
        targetRoles: [],
        targetShifts: [],
        startDate: '',
        endDate: '',
        priority: 0,
      })
    );
    expect(issues.length).toBeGreaterThanOrEqual(5);
  });
});

/* ================================================================== */
/*  buildReminderFromDraft                                             */
/* ================================================================== */

describe('buildReminderFromDraft', () => {
  const metadata = {
    createdBy: 'user-1',
    createdByName: 'Admin',
    createdAt: '2026-03-10T10:00:00.000Z',
    updatedAt: '2026-03-10T10:00:00.000Z',
  };

  it('creates a new reminder from draft', () => {
    const draft = buildDraft({ title: '  Aviso  ', message: '  Mensaje  ' });
    const result = buildReminderFromDraft('rem-new', draft, metadata);

    expect(result.id).toBe('rem-new');
    expect(result.title).toBe('Aviso');
    expect(result.message).toBe('Mensaje');
    expect(result.createdBy).toBe('user-1');
  });

  it('preserves createdBy from previous reminder on edit', () => {
    const previous = buildReminder({ createdBy: 'original-user', createdByName: 'Original' });
    const draft = buildDraft();
    const result = buildReminderFromDraft('rem-1', draft, metadata, previous);

    expect(result.createdBy).toBe('original-user');
    expect(result.createdByName).toBe('Original');
  });

  it('uses metadata createdBy when no previous exists', () => {
    const draft = buildDraft();
    const result = buildReminderFromDraft('rem-new', draft, metadata, null);

    expect(result.createdBy).toBe('user-1');
  });
});

/* ================================================================== */
/*  Reminder visibility                                                */
/* ================================================================== */

describe('isReminderVisible', () => {
  it('shows active reminder matching role, shift and date range', () => {
    expect(isReminderVisible(buildReminder(), buildContext())).toBe(true);
  });

  it('hides inactive reminders', () => {
    expect(isReminderVisible(buildReminder({ isActive: false }), buildContext())).toBe(false);
  });

  it('hides reminders outside date range (before start)', () => {
    expect(isReminderVisible(buildReminder(), buildContext({ currentDate: '2026-02-28' }))).toBe(
      false
    );
  });

  it('hides reminders outside date range (after end)', () => {
    expect(isReminderVisible(buildReminder(), buildContext({ currentDate: '2026-04-01' }))).toBe(
      false
    );
  });

  it('hides reminders that do not target the user role', () => {
    expect(isReminderVisible(buildReminder(), buildContext({ role: 'admin' }))).toBe(false);
  });

  it('hides reminders that do not target the current shift', () => {
    expect(isReminderVisible(buildReminder(), buildContext({ shift: 'night' }))).toBe(false);
  });

  it('hides already-read reminders', () => {
    expect(isReminderVisible(buildReminder(), buildContext({ readReminderIds: ['rem-1'] }))).toBe(
      false
    );
  });

  it('returns false when no role in context', () => {
    expect(isReminderVisible(buildReminder(), buildContext({ role: undefined }))).toBe(false);
  });
});

describe('filterVisibleReminders', () => {
  it('filters out non-visible reminders', () => {
    const reminders = [
      buildReminder({ id: 'r1' }),
      buildReminder({ id: 'r2', isActive: false }),
      buildReminder({ id: 'r3', targetShifts: ['night'] }),
    ];
    const result = filterVisibleReminders(reminders, buildContext());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r1');
  });
});

describe('sortRemindersByPriority', () => {
  it('sorts by descending priority then by descending createdAt', () => {
    const reminders = [
      buildReminder({ id: 'r1', priority: 1, createdAt: '2026-03-01T00:00:00.000Z' }),
      buildReminder({ id: 'r2', priority: 3, createdAt: '2026-03-02T00:00:00.000Z' }),
      buildReminder({ id: 'r3', priority: 2, createdAt: '2026-03-03T00:00:00.000Z' }),
      buildReminder({ id: 'r4', priority: 3, createdAt: '2026-03-04T00:00:00.000Z' }),
    ];
    const sorted = sortRemindersByPriority(reminders);
    expect(sorted.map(r => r.id)).toEqual(['r4', 'r2', 'r3', 'r1']);
  });

  it('does not mutate the original array', () => {
    const reminders = [
      buildReminder({ id: 'r1', priority: 1 }),
      buildReminder({ id: 'r2', priority: 3 }),
    ];
    const sorted = sortRemindersByPriority(reminders);
    expect(sorted).not.toBe(reminders);
    expect(reminders[0].id).toBe('r1');
  });
});

describe('getReminderUnreadCount', () => {
  it('counts only visible reminders', () => {
    const reminders = [buildReminder({ id: 'r1' }), buildReminder({ id: 'r2', isActive: false })];
    expect(getReminderUnreadCount(reminders, buildContext())).toBe(1);
  });

  it('returns 0 for empty array', () => {
    expect(getReminderUnreadCount([], buildContext())).toBe(0);
  });
});

describe('hasUrgentVisibleReminders', () => {
  it('returns true when there is a visible urgent reminder', () => {
    const reminders = [buildReminder({ type: 'urgent' })];
    expect(hasUrgentVisibleReminders(reminders, buildContext())).toBe(true);
  });

  it('returns false when no urgent reminders are visible', () => {
    const reminders = [buildReminder({ type: 'info' })];
    expect(hasUrgentVisibleReminders(reminders, buildContext())).toBe(false);
  });

  it('returns false when urgent reminder is inactive', () => {
    const reminders = [buildReminder({ type: 'urgent', isActive: false })];
    expect(hasUrgentVisibleReminders(reminders, buildContext())).toBe(false);
  });
});

/* ================================================================== */
/*  Presentation helpers                                               */
/* ================================================================== */

describe('reminderPresentation', () => {
  it('formats dates in dd-mm-yyyy', () => {
    expect(formatReminderReceiptDate({ dateKey: '2026-01-05' })).toBe('05-01-2026');
  });

  it('returns raw value for malformed date', () => {
    expect(formatReminderDateRange('bad', '2026-01-05')).toBe('bad a 05-01-2026');
  });

  it('formats date range', () => {
    expect(formatReminderDateRange('2026-03-01', '2026-03-31')).toBe('01-03-2026 a 31-03-2026');
  });

  it('formats shift labels', () => {
    expect(formatReminderShiftLabel('day')).toBe('Dia');
    expect(formatReminderShiftLabel('night')).toBe('Noche');
  });

  it('formats priority labels from constants', () => {
    expect(formatReminderPriorityLabel(1)).toBe('Prioridad Normal');
    expect(formatReminderPriorityLabel(2)).toBe('Prioridad Alta');
    expect(formatReminderPriorityLabel(3)).toBe('Prioridad Crítica');
  });

  it('formats receipt date or Legacy fallback', () => {
    expect(formatReminderReceiptDate({ dateKey: '2026-03-15' })).toBe('15-03-2026');
    expect(formatReminderReceiptDate({ dateKey: undefined as unknown as string })).toBe('Legacy');
  });
});

/* ================================================================== */
/*  reminderShared utilities                                           */
/* ================================================================== */

describe('reminderShared', () => {
  it('builds composite receipt IDs', () => {
    expect(buildReminderReadReceiptId('user-1', 'day', '2026-03-15')).toBe(
      'user-1__2026-03-15__day'
    );
    expect(buildReminderReadReceiptId('user-2', 'night', '2026-03-16')).toBe(
      'user-2__2026-03-16__night'
    );
  });

  it('defines max image size constant at 2 MB', () => {
    expect(REMINDER_IMAGE_MAX_BYTES).toBe(2 * 1024 * 1024);
  });
});

/* ================================================================== */
/*  UI options constants                                               */
/* ================================================================== */

describe('reminderUiOptions', () => {
  it('provides type labels', () => {
    expect(REMINDER_TYPE_LABELS.info).toBe('Informativo');
    expect(REMINDER_TYPE_LABELS.warning).toBe('Importante');
    expect(REMINDER_TYPE_LABELS.urgent).toBe('Urgente');
  });

  it('provides priority labels', () => {
    expect(REMINDER_PRIORITY_LABELS[1]).toBe('Normal');
    expect(REMINDER_PRIORITY_LABELS[2]).toBe('Alta');
    expect(REMINDER_PRIORITY_LABELS[3]).toBe('Crítica');
  });

  it('resolves role labels or falls back to raw role', () => {
    expect(getReminderRoleLabel('admin')).toContain('Administrador');
    expect(getReminderRoleLabel('nurse_hospital')).toContain('Hospitalizados');
    expect(getReminderRoleLabel('unknown_role' as never)).toBe('unknown_role');
  });
});
