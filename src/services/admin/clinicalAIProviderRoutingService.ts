import { getSettingsPath } from '@/constants/firestorePaths';
import { firestoreDb, type IDatabaseProvider } from '@/services/storage/firestore';
import {
  createDefaultClinicalAIProviderRoutingDocument,
  normalizeClinicalAIProviderRoutingDocument,
  type ClinicalAIProviderRoutingDocument,
} from '@/shared/ai/clinicalAIProviderRouting';

export const CLINICAL_AI_PROVIDER_ROUTING_DOC_ID = 'aiProviderRouting';

type ClinicalAIProviderRoutingRepository = Pick<
  IDatabaseProvider,
  'getDoc' | 'setDoc' | 'subscribeDoc'
>;

const getRoutingCollectionPath = (): string => getSettingsPath();

export const getClinicalAIProviderRouting = async (
  repository: ClinicalAIProviderRoutingRepository = firestoreDb
): Promise<ClinicalAIProviderRoutingDocument> => {
  const raw = await repository.getDoc<Partial<ClinicalAIProviderRoutingDocument>>(
    getRoutingCollectionPath(),
    CLINICAL_AI_PROVIDER_ROUTING_DOC_ID
  );

  if (!raw) {
    return createDefaultClinicalAIProviderRoutingDocument();
  }

  return normalizeClinicalAIProviderRoutingDocument(raw);
};

export const saveClinicalAIProviderRouting = async ({
  routing,
  updatedByEmail,
  repository = firestoreDb,
}: {
  routing: ClinicalAIProviderRoutingDocument;
  updatedByEmail?: string | null;
  repository?: ClinicalAIProviderRoutingRepository;
}): Promise<void> => {
  await repository.setDoc<ClinicalAIProviderRoutingDocument>(
    getRoutingCollectionPath(),
    CLINICAL_AI_PROVIDER_ROUTING_DOC_ID,
    {
      ...normalizeClinicalAIProviderRoutingDocument(routing),
      updatedAt: new Date().toISOString(),
      updatedByEmail: updatedByEmail?.trim() || null,
    }
  );
};

export const subscribeToClinicalAIProviderRouting = (
  onUpdate: (routing: ClinicalAIProviderRoutingDocument) => void,
  repository: ClinicalAIProviderRoutingRepository = firestoreDb
): (() => void) =>
  repository.subscribeDoc<Partial<ClinicalAIProviderRoutingDocument>>(
    getRoutingCollectionPath(),
    CLINICAL_AI_PROVIDER_ROUTING_DOC_ID,
    raw =>
      onUpdate(
        raw
          ? normalizeClinicalAIProviderRoutingDocument(raw)
          : createDefaultClinicalAIProviderRoutingDocument()
      )
  );
