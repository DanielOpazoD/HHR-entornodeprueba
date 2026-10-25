import {
  buildGlobalEmailRecipientListId,
  CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST,
  type GlobalEmailRecipientList,
} from '@/services/email/emailRecipientListSupport';

interface RecipientListActor {
  uid?: string | null;
  email?: string | null;
}

interface BuildRecipientListPayloadInput {
  listId: string;
  name: string;
  description: string;
  recipients: string[];
  actor: RecipientListActor | null;
}

export const resolveCreateRecipientListError = (
  canManageGlobalRecipientLists: boolean,
  name: string
): string | null => {
  if (!canManageGlobalRecipientLists) {
    return 'Tu usuario no tiene permisos para crear listas globales.';
  }

  if (!name.trim()) {
    return 'Debes ingresar un nombre para la nueva lista.';
  }

  return null;
};

export const resolveRenameRecipientListError = (
  canManageGlobalRecipientLists: boolean,
  activeList: GlobalEmailRecipientList | undefined,
  name: string
): string | null => {
  if (!canManageGlobalRecipientLists) {
    return 'Tu usuario no tiene permisos para editar listas globales.';
  }

  if (!activeList || !name.trim()) {
    return 'Debes ingresar un nombre valido para la lista.';
  }

  return null;
};

export const resolveDeleteRecipientListError = (
  canManageGlobalRecipientLists: boolean,
  recipientLists: GlobalEmailRecipientList[],
  listId: string
): string | null => {
  if (!canManageGlobalRecipientLists) {
    return 'Tu usuario no tiene permisos para eliminar listas globales.';
  }

  if (recipientLists.length <= 1) {
    return 'Debe existir al menos una lista global de correos.';
  }

  if (!recipientLists.some(list => list.id !== listId)) {
    return 'No se encontro una lista alternativa para mantener activa.';
  }

  return null;
};

export const buildCreatedRecipientList = (
  name: string,
  recipients: string[],
  existingIds: string[],
  actor: RecipientListActor | null
): GlobalEmailRecipientList => {
  const trimmedName = name.trim();
  const description = `Lista global creada desde el modulo de correo de censo: ${trimmedName}.`;

  return {
    id: buildGlobalEmailRecipientListId(trimmedName, existingIds),
    name: trimmedName,
    description,
    recipients,
    scope: 'global',
    updatedAt: new Date().toISOString(),
    updatedByUid: actor?.uid ?? null,
    updatedByEmail: actor?.email ?? null,
  };
};

export const buildRecipientListSavePayload = ({
  listId,
  name,
  description,
  recipients,
  actor,
}: BuildRecipientListPayloadInput) => ({
  listId,
  name,
  description,
  recipients,
  updatedByUid: actor?.uid ?? null,
  updatedByEmail: actor?.email ?? null,
});

export const resolveRenamedRecipientListName = (
  activeListId: string,
  requestedName: string
): string =>
  activeListId === CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.id
    ? CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.name
    : requestedName.trim();

export const resolveRecipientListFallback = (
  recipientLists: GlobalEmailRecipientList[],
  listId: string
): GlobalEmailRecipientList | null => recipientLists.find(list => list.id !== listId) ?? null;
