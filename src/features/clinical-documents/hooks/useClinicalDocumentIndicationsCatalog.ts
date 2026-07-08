import { useEffect, useMemo, useState } from 'react';

import {
  addClinicalDocumentIndicationCatalogItem,
  createClinicalDocumentIndicationsCatalogTab,
  deleteClinicalDocumentIndicationCatalogItem,
  deleteClinicalDocumentIndicationsCatalogTab,
  getDefaultClinicalDocumentIndicationsCatalog,
  renameClinicalDocumentIndicationsCatalogTab,
  reorderClinicalDocumentIndicationsCatalogTab,
  replaceClinicalDocumentIndicationsCatalog,
  subscribeToClinicalDocumentIndicationsCatalog,
  type ClinicalDocumentIndicationsCatalog,
  updateClinicalDocumentIndicationCatalogItem,
} from '@/features/clinical-documents/services/clinicalDocumentIndicationsCatalogService';
import { createScopedLogger } from '@/services/utils/loggerScope';

interface UseClinicalDocumentIndicationsCatalogParams {
  user: {
    uid?: string;
    email?: string | null;
  } | null;
  isActive: boolean;
  canEdit: boolean;
}

interface UseClinicalDocumentIndicationsCatalogState {
  indicationsCatalog: ClinicalDocumentIndicationsCatalog;
  isSavingCustomIndication: boolean;
  customIndicationError: string | null;
  createTab: (label: string) => Promise<boolean>;
  renameTab: (tabId: string, label: string) => Promise<boolean>;
  deleteTab: (tabId: string) => Promise<boolean>;
  reorderTab: (tabId: string, direction: 'left' | 'right') => Promise<boolean>;
  addCustomIndication: (tabId: string, text: string) => Promise<boolean>;
  updateIndication: (tabId: string, itemId: string, text: string) => Promise<boolean>;
  deleteIndication: (tabId: string, itemId: string) => Promise<boolean>;
  importCatalog: (catalog: unknown) => Promise<boolean>;
}

const clinicalDocumentIndicationsCatalogLogger = createScopedLogger(
  'ClinicalDocumentIndicationsCatalogHook'
);

export const useClinicalDocumentIndicationsCatalog = ({
  user,
  isActive,
  canEdit: _canEdit,
}: UseClinicalDocumentIndicationsCatalogParams): UseClinicalDocumentIndicationsCatalogState => {
  const owner = useMemo(
    () => ({
      uid: String(user?.uid || '').trim(),
      email: String(user?.email || '').trim(),
    }),
    [user?.email, user?.uid]
  );
  const [indicationsCatalog, setIndicationsCatalog] = useState<ClinicalDocumentIndicationsCatalog>(
    () => getDefaultClinicalDocumentIndicationsCatalog(undefined, owner)
  );
  const [isSavingCustomIndication, setIsSavingCustomIndication] = useState(false);
  const [customIndicationError, setCustomIndicationError] = useState<string | null>(null);

  const runCatalogMutation = async (
    action: () => Promise<ClinicalDocumentIndicationsCatalog>,
    errorMessage: string
  ): Promise<boolean> => {
    try {
      setIsSavingCustomIndication(true);
      setCustomIndicationError(null);
      const nextCatalog = await action();
      setIndicationsCatalog(nextCatalog);
      return true;
    } catch (error) {
      clinicalDocumentIndicationsCatalogLogger.error(errorMessage, error);
      setCustomIndicationError('No se pudo guardar la indicación en Firebase.');
      return false;
    } finally {
      setIsSavingCustomIndication(false);
    }
  };

  useEffect(() => {
    if (!isActive || !owner.uid) {
      setIndicationsCatalog(getDefaultClinicalDocumentIndicationsCatalog(undefined, owner));
      return;
    }

    const unsubscribe = subscribeToClinicalDocumentIndicationsCatalog(setIndicationsCatalog, owner);

    return () => {
      unsubscribe();
    };
  }, [isActive, owner]);

  const createTab = async (label: string): Promise<boolean> =>
    runCatalogMutation(
      () =>
        createClinicalDocumentIndicationsCatalogTab({
          ...owner,
          label,
        }),
      'Error creating clinical indication tab:'
    );

  const renameTab = async (tabId: string, label: string): Promise<boolean> =>
    runCatalogMutation(
      () =>
        renameClinicalDocumentIndicationsCatalogTab({
          ...owner,
          tabId,
          label,
        }),
      'Error renaming clinical indication tab:'
    );

  const deleteTab = async (tabId: string): Promise<boolean> =>
    runCatalogMutation(
      () =>
        deleteClinicalDocumentIndicationsCatalogTab({
          ...owner,
          tabId,
        }),
      'Error deleting clinical indication tab:'
    );

  const reorderTab = async (tabId: string, direction: 'left' | 'right'): Promise<boolean> =>
    runCatalogMutation(
      () =>
        reorderClinicalDocumentIndicationsCatalogTab({
          ...owner,
          tabId,
          direction,
        }),
      'Error reordering clinical indication tab:'
    );

  const addCustomIndication = async (tabId: string, text: string): Promise<boolean> =>
    runCatalogMutation(
      () =>
        addClinicalDocumentIndicationCatalogItem({
          ...owner,
          tabId,
          text,
        }),
      'Error saving custom clinical indication:'
    );

  const updateIndication = async (tabId: string, itemId: string, text: string): Promise<boolean> =>
    runCatalogMutation(
      () =>
        updateClinicalDocumentIndicationCatalogItem({
          ...owner,
          tabId,
          itemId,
          text,
        }),
      'Error updating clinical indication:'
    );

  const deleteIndication = async (tabId: string, itemId: string): Promise<boolean> =>
    runCatalogMutation(
      () =>
        deleteClinicalDocumentIndicationCatalogItem({
          ...owner,
          tabId,
          itemId,
        }),
      'Error deleting clinical indication:'
    );

  const importCatalog = async (catalog: unknown): Promise<boolean> =>
    runCatalogMutation(
      () =>
        replaceClinicalDocumentIndicationsCatalog({
          ...owner,
          catalog: catalog as Parameters<
            typeof replaceClinicalDocumentIndicationsCatalog
          >[0]['catalog'],
        }),
      'Error importing clinical indications catalog:'
    );

  return {
    indicationsCatalog,
    isSavingCustomIndication,
    customIndicationError,
    createTab,
    renameTab,
    deleteTab,
    reorderTab,
    addCustomIndication,
    updateIndication,
    deleteIndication,
    importCatalog,
  };
};
