import React from 'react';
import {
  executeArchiveMedicalIndicationTemplate,
  executeCreateMedicalIndicationTemplate,
  executeMarkMedicalIndicationTemplateUsed,
  executeUpdateMedicalIndicationTemplate,
} from '@/application/medical-indications/medicalIndicationsUseCases';
import { defaultMedicalIndicationTemplatePort } from '@/application/ports/medicalIndicationPort';
import type { MedicalIndicationTemplate } from '@/shared/contracts/medicalIndications';

export interface MedicalIndicationsLibraryActor {
  userId: string;
  auditLabel: string;
}

export const useMedicalIndicationsLibrary = (
  actor: MedicalIndicationsLibraryActor | null,
  isOpen: boolean
) => {
  const [templates, setTemplates] = React.useState<MedicalIndicationTemplate[]>([]);
  const [draftText, setDraftText] = React.useState('');
  const [editingTemplateId, setEditingTemplateId] = React.useState<string | null>(null);
  const [editingText, setEditingText] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  const reload = React.useCallback(async () => {
    if (!actor) {
      setTemplates([]);
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      const nextTemplates = await defaultMedicalIndicationTemplatePort.listActiveByUser(
        actor.userId
      );
      setTemplates(nextTemplates);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'No se pudo cargar la biblioteca personal.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [actor]);

  React.useEffect(() => {
    if (!isOpen) return;
    void reload();
  }, [isOpen, reload]);

  const createTemplate = async (text: string = draftText): Promise<void> => {
    if (!actor) {
      setError('Inicia sesión para guardar indicaciones personales.');
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      const template = await executeCreateMedicalIndicationTemplate({
        userId: actor.userId,
        userLabel: actor.auditLabel,
        text,
      });
      setTemplates(current => [template, ...current]);
      setDraftText('');
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'No se pudo guardar la indicación.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const updateTemplate = async (templateId: string, text: string): Promise<void> => {
    if (!actor) return;

    setIsSaving(true);
    setError('');
    try {
      await executeUpdateMedicalIndicationTemplate({
        templateId,
        userId: actor.userId,
        userLabel: actor.auditLabel,
        text,
      });
      setTemplates(current =>
        current.map(template =>
          template.id === templateId
            ? { ...template, text: text.trim(), updatedAt: new Date().toISOString() }
            : template
        )
      );
      setEditingTemplateId(null);
      setEditingText('');
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'No se pudo actualizar la indicación.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const archiveTemplate = async (templateId: string): Promise<void> => {
    if (!actor) return;

    setIsSaving(true);
    setError('');
    try {
      await executeArchiveMedicalIndicationTemplate({
        templateId,
        userId: actor.userId,
        userLabel: actor.auditLabel,
      });
      setTemplates(current => current.filter(template => template.id !== templateId));
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'No se pudo archivar la indicación.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const markTemplateUsed = async (template: MedicalIndicationTemplate): Promise<void> => {
    if (!actor) {
      setError('Inicia sesión para reutilizar indicaciones personales.');
      return;
    }

    setError('');
    await executeMarkMedicalIndicationTemplateUsed({
      template,
      userLabel: actor.auditLabel,
    });
    setTemplates(current =>
      current.map(item =>
        item.id === template.id
          ? { ...item, useCount: item.useCount + 1, lastUsedAt: new Date().toISOString() }
          : item
      )
    );
  };

  return {
    templates,
    draftText,
    setDraftText,
    editingTemplateId,
    setEditingTemplateId,
    editingText,
    setEditingText,
    isLoading,
    isSaving,
    error,
    setError,
    createTemplate,
    updateTemplate,
    archiveTemplate,
    markTemplateUsed,
  };
};
