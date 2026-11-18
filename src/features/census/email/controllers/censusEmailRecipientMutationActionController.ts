import type { GlobalEmailRecipientList } from '@/services/email/emailRecipientListService';
import { resolveRecipientListForSelection } from '@/features/census/email/controllers/censusEmailRecipientMutationController';
import {
  resolveRecipientRuntimeAfterCreate,
  resolveRecipientRuntimeAfterDeleteOutcome,
  resolveRecipientRuntimeAfterRename,
} from '@/features/census/email/controllers/censusEmailRecipientMutationRuntimeController';
import type { RecipientRuntimeState } from '@/features/census/email/controllers/censusEmailRecipientRuntimeController';
import type {
  CensusRecipientListUseCasesModule,
  RecipientUseCaseResult,
} from '@/features/census/email/controllers/censusEmailRecipientUseCaseLoader';

interface RecipientListActor {
  uid?: string;
  email?: string | null;
}

export interface RecipientRuntimeMutationSpec<TData> {
  execute: (useCases: CensusRecipientListUseCasesModule) => Promise<RecipientUseCaseResult<TData>>;
  resolveRuntimeState: (data: NonNullable<TData>) => RecipientRuntimeState | null;
  fallbackMessage: string;
}

interface RecipientRuntimeMutationBaseInput {
  canManageGlobalRecipientLists: boolean;
  recipientLists: GlobalEmailRecipientList[];
  actor: RecipientListActor | null;
}

interface CreateRecipientListMutationInput extends RecipientRuntimeMutationBaseInput {
  name: string;
  recipients: string[];
}

export const buildCreateRecipientListMutationSpec = (
  input: CreateRecipientListMutationInput
): RecipientRuntimeMutationSpec<GlobalEmailRecipientList | null> => ({
  execute: ({ executeCreateCensusRecipientList }) =>
    executeCreateCensusRecipientList({
      canManageGlobalRecipientLists: input.canManageGlobalRecipientLists,
      name: input.name,
      recipients: input.recipients,
      recipientLists: input.recipientLists,
      actor: input.actor,
    }),
  resolveRuntimeState: result => resolveRecipientRuntimeAfterCreate(input.recipientLists, result),
  fallbackMessage: 'No se pudo crear la nueva lista global.',
});

interface RenameRecipientListMutationInput extends RecipientRuntimeMutationBaseInput {
  activeRecipientListId: string;
  name: string;
  recipients: string[];
}

export const buildRenameRecipientListMutationSpec = (
  input: RenameRecipientListMutationInput
): RecipientRuntimeMutationSpec<GlobalEmailRecipientList | null> => ({
  execute: ({ executeRenameCensusRecipientList }) =>
    executeRenameCensusRecipientList({
      canManageGlobalRecipientLists: input.canManageGlobalRecipientLists,
      activeList: resolveRecipientListForSelection(
        input.recipientLists,
        input.activeRecipientListId
      ),
      name: input.name,
      recipients: input.recipients,
      actor: input.actor,
    }),
  resolveRuntimeState: result => resolveRecipientRuntimeAfterRename(input.recipientLists, result),
  fallbackMessage: 'No se pudo actualizar el nombre de la lista global.',
});

interface DeleteRecipientListMutationInput {
  canManageGlobalRecipientLists: boolean;
  recipientLists: GlobalEmailRecipientList[];
  listId: string;
}

export const buildDeleteRecipientListMutationSpec = (
  input: DeleteRecipientListMutationInput
): RecipientRuntimeMutationSpec<{ fallbackList: GlobalEmailRecipientList | null }> => ({
  execute: ({ executeDeleteCensusRecipientList }) =>
    executeDeleteCensusRecipientList({
      canManageGlobalRecipientLists: input.canManageGlobalRecipientLists,
      recipientLists: input.recipientLists,
      listId: input.listId,
    }),
  resolveRuntimeState: result =>
    resolveRecipientRuntimeAfterDeleteOutcome({
      recipientLists: input.recipientLists,
      listId: input.listId,
      fallbackList: result.fallbackList,
    }),
  fallbackMessage: 'No se pudo eliminar la lista global seleccionada.',
});
