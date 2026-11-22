import { useCallback, useEffect, useState } from 'react';
import {
  createDefaultClinicalAIProviderRoutingDocument,
  type ClinicalAIProviderRoutingDocument,
} from '@/features/admin/domain/clinicalAIProviderRouting';
import {
  saveClinicalAIProviderRouting,
  subscribeToClinicalAIProviderRouting,
} from '@/features/admin/services/clinicalAIProviderRoutingService';

export const useClinicalAIProviderRouting = (updatedByEmail?: string | null) => {
  const [routing, setRouting] = useState<ClinicalAIProviderRoutingDocument>(() =>
    createDefaultClinicalAIProviderRoutingDocument()
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mounted once: loading already starts true.
  useEffect(() => {
    const unsubscribe = subscribeToClinicalAIProviderRouting(nextRouting => {
      setRouting(nextRouting);
      setLoading(false);
      setError(null);
    });

    return unsubscribe;
  }, []);

  const save = useCallback(
    async (nextRouting: ClinicalAIProviderRoutingDocument) => {
      setSaving(true);
      setError(null);
      try {
        await saveClinicalAIProviderRouting({ routing: nextRouting, updatedByEmail });
        setRouting(nextRouting);
      } catch (saveError) {
        const message =
          saveError instanceof Error
            ? saveError.message
            : 'No se pudo guardar la configuración IA.';
        setError(message);
        throw saveError;
      } finally {
        setSaving(false);
      }
    },
    [updatedByEmail]
  );

  return {
    routing,
    setRouting,
    loading,
    saving,
    error,
    save,
  };
};
