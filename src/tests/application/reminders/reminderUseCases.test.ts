import { afterEach, describe, expect, it, vi } from 'vitest';

describe('reminderUseCases module boundaries', () => {
  afterEach(() => {
    vi.doUnmock('@/services/reminders/ReminderImageService');
    vi.resetModules();
  });

  it('does not load Firebase Storage image support when importing non-image reminder use cases', async () => {
    let imageServiceLoaded = false;

    vi.doMock('@/services/reminders/ReminderImageService', () => {
      imageServiceLoaded = true;
      return {
        ReminderImageService: {
          uploadImage: vi.fn(),
          deleteImage: vi.fn(),
        },
      };
    });

    const { createReminderUseCases } = await import('@/application/reminders/reminderUseCases');

    type ReminderUseCasesOptions = NonNullable<Parameters<typeof createReminderUseCases>[0]>;

    createReminderUseCases({
      reminderRepository: {
        subscribe: vi.fn(),
        listWithResult: vi.fn(),
        createWithResult: vi.fn(),
        updateWithResult: vi.fn(),
        removeWithResult: vi.fn(),
      } as unknown as ReminderUseCasesOptions['reminderRepository'],
      reminderReadService: {
        getUserShiftReadState: vi.fn(),
        markAsReadWithResult: vi.fn(),
        buildReceipt: vi.fn(),
        getReadReceiptsWithResult: vi.fn(),
      } as unknown as ReminderUseCasesOptions['reminderReadService'],
    });

    expect(imageServiceLoaded).toBe(false);
  });
});
