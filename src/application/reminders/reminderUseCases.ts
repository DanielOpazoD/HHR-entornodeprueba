import {
  createApplicationDegraded,
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type {
  ApplicationIssue,
  ApplicationOutcome,
} from '@/shared/contracts/applicationOutcomeTypes';

import {
  ReminderReadService,
  type ReminderReadReceiptsResult,
} from '@/services/reminders/ReminderReadService';
import {
  ReminderRepository,
  type ReminderRepositoryListResult,
  type ReminderRepositoryMutationResult,
} from '@/services/reminders/ReminderRepository';
import {
  resolveReminderAdminErrorMessage,
  type ReminderOperationErrorKind,
} from '@/services/reminders/reminderErrorPolicy';
import type { Reminder, ReminderReadReceipt, ReminderShift } from '@/types/reminders';

interface ReminderUseCasesDependencies {
  reminderRepository?: typeof ReminderRepository;
  reminderReadService?: typeof ReminderReadService;
  reminderImageService?: ReminderImageServicePort;
  reminderImageServiceLoader?: () => Promise<ReminderImageServicePort>;
}

interface ReminderImageServicePort {
  uploadImage(reminderId: string, file: File): Promise<{ imageUrl: string; imagePath: string }>;
  deleteImage(imagePath?: string): Promise<void>;
}

interface SubscribeRemindersOptions {
  onOutcome: (outcome: ApplicationOutcome<Reminder[]>) => void;
}

interface ResolveReadStatesInput {
  reminders: Reminder[];
  userId: string;
  shift: ReminderShift;
  dateKey: string;
}

interface MarkReminderAsReadInput {
  reminderId: string;
  receipt: ReminderReadReceipt;
}

interface UploadReminderImageInput {
  reminderId: string;
  file: File;
}

const mapReminderErrorKindToIssueKind = (
  kind: ReminderOperationErrorKind
): ApplicationIssue['kind'] => {
  switch (kind) {
    case 'permission_denied':
      return 'permission';
    default:
      return 'unknown';
  }
};

const buildReminderIssue = (
  kind: ReminderOperationErrorKind,
  error: unknown,
  fallbackMessage: string
): ApplicationIssue => ({
  kind: mapReminderErrorKindToIssueKind(kind),
  message:
    resolveReminderAdminErrorMessage(error, { operation: 'firestore_read' }) || fallbackMessage,
  userSafeMessage: fallbackMessage,
  technicalContext: error instanceof Error ? { name: error.name } : undefined,
});

const mapReminderListOutcome = (
  result: ReminderRepositoryListResult
): ApplicationOutcome<Reminder[]> => {
  if (result.status === 'success') {
    return createApplicationSuccess(result.reminders);
  }

  const issue = buildReminderIssue(
    result.status,
    result.error,
    'No fue posible cargar los avisos.'
  );
  return createApplicationDegraded(result.reminders, [issue], {
    reason: result.status,
    userSafeMessage: issue.userSafeMessage,
  });
};

const mapReminderMutationOutcome = (
  result: ReminderRepositoryMutationResult,
  fallbackMessage: string
): ApplicationOutcome<null> => {
  if (result.status === 'success') {
    return createApplicationSuccess(null);
  }

  const issue = buildReminderIssue(result.status, result.error, fallbackMessage);
  return createApplicationFailed(null, [issue], {
    reason: result.status,
    userSafeMessage: issue.userSafeMessage,
  });
};

const mapReminderReadReceiptsOutcome = (
  result: ReminderReadReceiptsResult
): ApplicationOutcome<ReminderReadReceipt[]> => {
  if (result.status === 'success') {
    return createApplicationSuccess(result.receipts);
  }

  const issue = buildReminderIssue(
    result.status,
    result.error,
    'No fue posible cargar el detalle de lecturas del aviso.'
  );
  return createApplicationDegraded(result.receipts, [issue], {
    reason: result.status,
    userSafeMessage: issue.userSafeMessage,
  });
};

const loadDefaultReminderImageService = async (): Promise<ReminderImageServicePort> => {
  const module = await import('@/services/reminders/ReminderImageService');
  return module.ReminderImageService;
};

export const createReminderUseCases = ({
  reminderRepository = ReminderRepository,
  reminderReadService = ReminderReadService,
  reminderImageService,
  reminderImageServiceLoader = loadDefaultReminderImageService,
}: ReminderUseCasesDependencies = {}) => ({
  subscribeToReminderFeed({ onOutcome }: SubscribeRemindersOptions): () => void {
    return reminderRepository.subscribe(
      reminders => {
        onOutcome(createApplicationSuccess(reminders));
      },
      {
        onError: (error, kind) => {
          const issue = buildReminderIssue(kind, error, 'No fue posible suscribirse a los avisos.');
          onOutcome(
            createApplicationDegraded([], [issue], {
              reason: kind,
              userSafeMessage: issue.userSafeMessage,
            })
          );
        },
      }
    );
  },

  async listReminders(): Promise<ApplicationOutcome<Reminder[]>> {
    return mapReminderListOutcome(await reminderRepository.listWithResult());
  },

  async resolveReminderReadStates({
    reminders,
    userId,
    shift,
    dateKey,
  }: ResolveReadStatesInput): Promise<ApplicationOutcome<string[]>> {
    const results = await Promise.all(
      reminders.map(async reminder => ({
        reminderId: reminder.id,
        state: await reminderReadService.getUserShiftReadState(reminder.id, userId, shift, dateKey),
      }))
    );

    const readReminderIds = results
      .filter(result => result.state.status === 'read')
      .map(result => result.reminderId);
    const unavailableCount = results.filter(result => result.state.status === 'unavailable').length;

    if (unavailableCount > 0) {
      return createApplicationDegraded(readReminderIds, [
        {
          kind: 'unknown',
          message: 'No fue posible verificar la lectura de todos los avisos.',
          userSafeMessage: 'No fue posible verificar la lectura de todos los avisos.',
          technicalContext: { unavailableCount },
        },
      ]);
    }

    return createApplicationSuccess(readReminderIds);
  },

  async markReminderAsRead({
    reminderId,
    receipt,
  }: MarkReminderAsReadInput): Promise<ApplicationOutcome<null>> {
    const result = await reminderReadService.markAsReadWithResult(reminderId, receipt);
    if (result.status === 'success') {
      return createApplicationSuccess(null);
    }

    const issue = buildReminderIssue(
      result.status,
      result.error,
      'No fue posible registrar la lectura del aviso.'
    );
    return createApplicationFailed(null, [issue], {
      reason: result.status,
      userSafeMessage: issue.userSafeMessage,
    });
  },

  buildReadReceipt(input: {
    userId: string;
    userName: string;
    shift: ReminderShift;
    dateKey: string;
  }): ReminderReadReceipt {
    return reminderReadService.buildReceipt(input);
  },

  async createReminder(reminder: Reminder): Promise<ApplicationOutcome<null>> {
    return mapReminderMutationOutcome(
      await reminderRepository.createWithResult(reminder),
      'No fue posible crear el aviso.'
    );
  },

  async updateReminder(
    reminderId: string,
    patch: Partial<Reminder>
  ): Promise<ApplicationOutcome<null>> {
    return mapReminderMutationOutcome(
      await reminderRepository.updateWithResult(reminderId, patch),
      'No fue posible actualizar el aviso.'
    );
  },

  async deleteReminder(reminderId: string): Promise<ApplicationOutcome<null>> {
    return mapReminderMutationOutcome(
      await reminderRepository.removeWithResult(reminderId),
      'No fue posible eliminar el aviso.'
    );
  },

  async uploadReminderImage({
    reminderId,
    file,
  }: UploadReminderImageInput): Promise<
    ApplicationOutcome<{ imageUrl: string; imagePath: string } | null>
  > {
    try {
      const imageService = reminderImageService ?? (await reminderImageServiceLoader());
      const uploadedImage = await imageService.uploadImage(reminderId, file);
      return createApplicationSuccess(uploadedImage);
    } catch (error) {
      return createApplicationFailed(
        null,
        [
          {
            kind: 'remote_blocked',
            message: resolveReminderAdminErrorMessage(error, { operation: 'image_upload' }),
            userSafeMessage: 'No fue posible subir la imagen del aviso.',
          },
        ],
        {
          userSafeMessage: 'No fue posible subir la imagen del aviso.',
        }
      );
    }
  },

  async deleteReminderImage(imagePath?: string): Promise<ApplicationOutcome<null>> {
    try {
      const imageService = reminderImageService ?? (await reminderImageServiceLoader());
      await imageService.deleteImage(imagePath);
      return createApplicationSuccess(null);
    } catch (error) {
      return createApplicationFailed(
        null,
        [
          {
            kind: 'remote_blocked',
            message: resolveReminderAdminErrorMessage(error, { operation: 'image_delete' }),
            userSafeMessage: 'No fue posible eliminar la imagen del aviso.',
          },
        ],
        {
          userSafeMessage: 'No fue posible eliminar la imagen del aviso.',
        }
      );
    }
  },

  async getReminderReadReceipts(
    reminderId: string
  ): Promise<ApplicationOutcome<ReminderReadReceipt[]>> {
    return mapReminderReadReceiptsOutcome(
      await reminderReadService.getReadReceiptsWithResult(reminderId)
    );
  },
});

export type ReminderUseCases = ReturnType<typeof createReminderUseCases>;
