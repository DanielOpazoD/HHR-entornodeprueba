// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST,
  type GlobalEmailRecipientList,
} from '@/services/email/emailRecipientListService';
import {
  buildCreateRecipientListMutationSpec,
  buildDeleteRecipientListMutationSpec,
  buildRenameRecipientListMutationSpec,
} from '@/features/census/email/controllers/censusEmailRecipientMutationActionController';

describe('censusEmailRecipientMutationActionController', () => {
  const actor = { uid: 'user-1', email: 'nurse@example.com' };
  const recipients = ['uno@example.com'];
  const buildList = (
    partial: Partial<GlobalEmailRecipientList> & Pick<GlobalEmailRecipientList, 'id' | 'name'>
  ): GlobalEmailRecipientList => ({
    description: '',
    recipients: [],
    scope: 'global',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedByUid: actor.uid,
    updatedByEmail: actor.email,
    ...partial,
  });

  const recipientLists: GlobalEmailRecipientList[] = [
    buildList({
      ...CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST,
      recipients: [],
    }),
    buildList({
      id: 'custom-list',
      name: 'Personalizada',
      recipients: ['dos@example.com'],
    }),
  ];

  it('builds create mutation spec with expected fallback and runtime state', async () => {
    const executeCreateCensusRecipientList = vi.fn().mockResolvedValue({
      status: 'success',
      data: {
        id: 'new-list',
        name: 'Nueva lista',
        description: '',
        recipients,
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        createdByUid: actor.uid,
        createdByEmail: actor.email,
        updatedByUid: actor.uid,
        updatedByEmail: actor.email,
      },
    });

    const spec = buildCreateRecipientListMutationSpec({
      canManageGlobalRecipientLists: true,
      name: 'Nueva lista',
      recipients,
      recipientLists,
      actor,
    });

    const result = await spec.execute({
      executeCreateCensusRecipientList,
    } as never);

    expect(spec.fallbackMessage).toBe('No se pudo crear la nueva lista global.');
    expect(executeCreateCensusRecipientList).toHaveBeenCalledWith({
      canManageGlobalRecipientLists: true,
      name: 'Nueva lista',
      recipients,
      recipientLists,
      actor,
    });
    expect(result.data?.id).toBe('new-list');

    const runtimeState = spec.resolveRuntimeState(result.data!);
    expect(runtimeState?.activeRecipientListId).toBe('new-list');
    expect(runtimeState?.recipients).toEqual(recipients);
  });

  it('builds rename mutation spec using the current active list', async () => {
    const executeRenameCensusRecipientList = vi.fn().mockResolvedValue({
      status: 'success',
      data: {
        ...recipientLists[1],
        name: 'Renombrada',
        recipients,
      },
    });

    const spec = buildRenameRecipientListMutationSpec({
      canManageGlobalRecipientLists: true,
      activeRecipientListId: 'custom-list',
      name: 'Renombrada',
      recipients,
      recipientLists,
      actor,
    });

    const result = await spec.execute({
      executeRenameCensusRecipientList,
    } as never);

    expect(spec.fallbackMessage).toBe('No se pudo actualizar el nombre de la lista global.');
    expect(executeRenameCensusRecipientList).toHaveBeenCalledWith({
      canManageGlobalRecipientLists: true,
      activeList: recipientLists[1],
      name: 'Renombrada',
      recipients,
      actor,
    });
    expect(spec.resolveRuntimeState(result.data!)?.activeRecipientListId).toBe('custom-list');
  });

  it('builds delete mutation spec with fallback runtime state', async () => {
    const executeDeleteCensusRecipientList = vi.fn().mockResolvedValue({
      status: 'success',
      data: { fallbackList: CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST },
    });

    const spec = buildDeleteRecipientListMutationSpec({
      canManageGlobalRecipientLists: true,
      recipientLists,
      listId: 'custom-list',
    });

    const result = await spec.execute({
      executeDeleteCensusRecipientList,
    } as never);

    expect(spec.fallbackMessage).toBe('No se pudo eliminar la lista global seleccionada.');
    expect(executeDeleteCensusRecipientList).toHaveBeenCalledWith({
      canManageGlobalRecipientLists: true,
      recipientLists,
      listId: 'custom-list',
    });
    expect(spec.resolveRuntimeState(result.data!)?.activeRecipientListId).toBe(
      CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.id
    );
  });
});
