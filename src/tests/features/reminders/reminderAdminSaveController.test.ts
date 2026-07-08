import { describe, expect, it, vi } from 'vitest';
import {
  executeReminderAdminSave,
  type ReminderAdminSaveContext,
  type ReminderAdminSaveSubmission,
} from '@/features/reminders/controllers/reminderAdminSaveController';
import type { Reminder } from '@/types/reminders';

const NOW = '2026-05-03T12:00:00.000Z';

const validDraft: ReminderAdminSaveSubmission['draft'] = {
  title: 'Capacitación obligatoria',
  message: 'Cumplir antes del viernes.',
  type: 'info',
  targetRoles: ['nurse_hospital'],
  targetShifts: ['day'],
  startDate: '2026-05-03',
  endDate: '2026-05-10',
  priority: 2,
  isActive: true,
};

const successOutcome = <T>(data: T) => ({
  status: 'success' as const,
  data,
  issues: [] as never[],
});

const successVoid = () => successOutcome(null);

const failedOutcome = (userSafeMessage: string, kind: 'permission' | 'unknown' = 'unknown') => ({
  status: 'failed' as const,
  data: null,
  issues: [{ kind, message: userSafeMessage }],
  userSafeMessage,
});

const buildContext = (
  overrides: Partial<ReminderAdminSaveContext> = {}
): ReminderAdminSaveContext => ({
  reminderId: 'reminder-1',
  formReminder: null,
  currentUser: { uid: 'uid-1', displayName: 'Jefa de Servicio', email: 'jefatura@hospital.cl' },
  useCases: {
    createReminder: vi.fn(async () => successVoid()),
    deleteReminderImage: vi.fn(async () => successVoid()),
    uploadReminderImage: vi.fn(async () =>
      successOutcome({ imageUrl: 'https://cdn/img.png', imagePath: 'reminders/reminder-1.png' })
    ),
    updateReminder: vi.fn(async () => successVoid()),
  },
  now: NOW,
  ...overrides,
});

const buildSubmission = (
  overrides: Partial<ReminderAdminSaveSubmission> = {}
): ReminderAdminSaveSubmission => ({
  draft: validDraft,
  imageFile: null,
  removeImage: false,
  ...overrides,
});

const fakeImageFile = () => new File(['data'], 'img.png', { type: 'image/png' });

describe('executeReminderAdminSave', () => {
  it('rejects with kind=invalid when the draft fails domain validation', async () => {
    const context = buildContext();
    const outcome = await executeReminderAdminSave(
      buildSubmission({ draft: { ...validDraft, title: '' } }),
      context
    );

    expect(outcome).toMatchObject({ kind: 'invalid' });
    expect(context.useCases.createReminder).not.toHaveBeenCalled();
  });

  it('returns saved_without_image on the happy path with no image', async () => {
    const context = buildContext();
    const outcome = await executeReminderAdminSave(buildSubmission(), context);

    expect(outcome).toEqual({ kind: 'saved', imageOutcome: 'saved_without_image', warnings: [] });
    expect(context.useCases.createReminder).toHaveBeenCalledTimes(1);
    expect(context.useCases.uploadReminderImage).not.toHaveBeenCalled();
  });

  it('returns failed_with_message when createReminder rejects, never touching image use cases', async () => {
    const context = buildContext({
      useCases: {
        createReminder: vi.fn(async () => failedOutcome('Sin permisos para crear avisos.')),
        deleteReminderImage: vi.fn(async () => successVoid()),
        uploadReminderImage: vi.fn(async () => successOutcome({ imageUrl: '', imagePath: '' })),
        updateReminder: vi.fn(async () => successVoid()),
      },
    });

    const outcome = await executeReminderAdminSave(
      buildSubmission({ imageFile: fakeImageFile() }),
      context
    );

    expect(outcome).toEqual({
      kind: 'failed_with_message',
      message: 'Sin permisos para crear avisos.',
    });
    expect(context.useCases.deleteReminderImage).not.toHaveBeenCalled();
    expect(context.useCases.uploadReminderImage).not.toHaveBeenCalled();
    expect(context.useCases.updateReminder).not.toHaveBeenCalled();
  });

  it('uploads the new image and updates the reminder with the resolved imageUrl/imagePath', async () => {
    const context = buildContext();
    const outcome = await executeReminderAdminSave(
      buildSubmission({ imageFile: fakeImageFile() }),
      context
    );

    expect(outcome).toEqual({ kind: 'saved', imageOutcome: 'saved_with_image', warnings: [] });
    expect(context.useCases.uploadReminderImage).toHaveBeenCalledWith({
      reminderId: 'reminder-1',
      file: expect.any(File),
    });
    expect(context.useCases.updateReminder).toHaveBeenCalledWith(
      'reminder-1',
      expect.objectContaining({
        imageUrl: 'https://cdn/img.png',
        imagePath: 'reminders/reminder-1.png',
      })
    );
  });

  it('returns permission_denied_image_upload with a warning when uploadReminderImage fails', async () => {
    const context = buildContext({
      useCases: {
        createReminder: vi.fn(async () => successVoid()),
        deleteReminderImage: vi.fn(async () => successVoid()),
        uploadReminderImage: vi.fn(async () => failedOutcome('Sin permiso para subir imágenes.')),
        updateReminder: vi.fn(async () => successVoid()),
      },
    });

    const outcome = await executeReminderAdminSave(
      buildSubmission({ imageFile: fakeImageFile() }),
      context
    );

    expect(outcome).toEqual({
      kind: 'saved',
      imageOutcome: 'permission_denied_image_upload',
      warnings: ['Sin permiso para subir imágenes.'],
    });
    expect(context.useCases.updateReminder).not.toHaveBeenCalled();
  });

  it('deletes the previous image when removeImage is true and an image existed', async () => {
    const previous: Reminder = {
      id: 'reminder-1',
      title: 'Previo',
      message: 'previo',
      type: 'info',
      targetRoles: ['nurse_hospital'],
      targetShifts: ['day'],
      startDate: '2026-05-01',
      endDate: '2026-05-10',
      priority: 1,
      isActive: true,
      createdBy: 'uid-1',
      createdByName: 'Jefatura',
      createdAt: NOW,
      updatedAt: NOW,
      imageUrl: 'https://cdn/old.png',
      imagePath: 'reminders/old.png',
    };

    const context = buildContext({ formReminder: previous });
    const outcome = await executeReminderAdminSave(buildSubmission({ removeImage: true }), context);

    expect(outcome).toEqual({ kind: 'saved', imageOutcome: 'saved_without_image', warnings: [] });
    expect(context.useCases.deleteReminderImage).toHaveBeenCalledWith('reminders/old.png');
  });

  it('collects a warning (does not fail) when previous image deletion is rejected', async () => {
    const previous: Reminder = {
      id: 'reminder-1',
      title: 'Previo',
      message: 'previo',
      type: 'info',
      targetRoles: ['nurse_hospital'],
      targetShifts: ['day'],
      startDate: '2026-05-01',
      endDate: '2026-05-10',
      priority: 1,
      isActive: true,
      createdBy: 'uid-1',
      createdByName: 'Jefatura',
      createdAt: NOW,
      updatedAt: NOW,
      imageUrl: 'https://cdn/old.png',
      imagePath: 'reminders/old.png',
    };

    const context = buildContext({
      formReminder: previous,
      useCases: {
        createReminder: vi.fn(async () => successVoid()),
        deleteReminderImage: vi.fn(async () =>
          failedOutcome('Sin permiso para borrar la imagen antigua.', 'permission')
        ),
        uploadReminderImage: vi.fn(async () =>
          successOutcome({ imageUrl: 'https://cdn/new.png', imagePath: 'reminders/new.png' })
        ),
        updateReminder: vi.fn(async () => successVoid()),
      },
    });

    const outcome = await executeReminderAdminSave(
      buildSubmission({ removeImage: true, imageFile: fakeImageFile() }),
      context
    );

    expect(outcome.kind).toBe('saved');
    if (outcome.kind === 'saved') {
      expect(outcome.imageOutcome).toBe('saved_with_image');
      expect(outcome.warnings).toContain('Sin permiso para borrar la imagen antigua.');
    }
  });

  it('returns failed_with_message when updateReminder rejects after a successful upload', async () => {
    const context = buildContext({
      useCases: {
        createReminder: vi.fn(async () => successVoid()),
        deleteReminderImage: vi.fn(async () => successVoid()),
        uploadReminderImage: vi.fn(async () =>
          successOutcome({ imageUrl: 'https://cdn/new.png', imagePath: 'reminders/new.png' })
        ),
        updateReminder: vi.fn(async () => failedOutcome('Update rechazado')),
      },
    });

    const outcome = await executeReminderAdminSave(
      buildSubmission({ imageFile: fakeImageFile() }),
      context
    );

    expect(outcome).toEqual({
      kind: 'failed_with_message',
      message: 'Update rechazado',
    });
  });

  it('falls back to "system" / "Jefatura" for the createdBy identity when no current user is available', async () => {
    const createReminder = vi.fn(async (_input: Reminder) => successVoid());
    const context = buildContext({
      currentUser: null,
      useCases: {
        createReminder,
        deleteReminderImage: vi.fn(async () => successVoid()),
        uploadReminderImage: vi.fn(async () => successOutcome({ imageUrl: '', imagePath: '' })),
        updateReminder: vi.fn(async () => successVoid()),
      },
    });

    await executeReminderAdminSave(buildSubmission(), context);

    expect(createReminder).toHaveBeenCalledTimes(1);
    const persisted = createReminder.mock.calls[0][0];
    expect(persisted.createdBy).toBe('system');
    expect(persisted.createdByName).toBe('Jefatura');
  });
});
