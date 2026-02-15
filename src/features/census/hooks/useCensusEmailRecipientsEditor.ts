import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  resolveAddRecipient,
  resolveBulkRecipients,
  resolveRemoveRecipient,
  resolveSafeRecipients,
  resolveUpdateRecipient,
  resolveVisibleRecipients,
} from '@/features/census/controllers/censusEmailRecipientsController';

const MAX_VISIBLE_RECIPIENTS = 9;

interface UseCensusEmailRecipientsEditorParams {
  isOpen: boolean;
  recipients: string[];
  onRecipientsChange: (recipients: string[]) => void;
}

interface UseCensusEmailRecipientsEditorResult {
  safeRecipients: string[];
  visibleRecipients: string[];
  hiddenRecipientsCount: number;
  maxVisibleRecipients: number;
  newRecipient: string;
  error: string | null;
  showBulkEditor: boolean;
  bulkRecipients: string;
  editingIndex: number | null;
  editingValue: string;
  showAllRecipients: boolean;
  setNewRecipient: (nextValue: string) => void;
  setBulkRecipients: (nextValue: string) => void;
  setEditingValue: (nextValue: string) => void;
  addRecipient: () => void;
  toggleBulkEditor: () => void;
  saveBulkRecipients: () => void;
  cancelBulkEdit: () => void;
  startEditRecipient: (index: number) => void;
  saveEditedRecipient: () => void;
  cancelEditRecipient: () => void;
  removeRecipient: (index: number) => void;
  toggleShowAllRecipients: () => void;
  clearError: () => void;
}

export const useCensusEmailRecipientsEditor = ({
  isOpen,
  recipients,
  onRecipientsChange,
}: UseCensusEmailRecipientsEditorParams): UseCensusEmailRecipientsEditorResult => {
  const safeRecipients = useMemo(() => resolveSafeRecipients(recipients), [recipients]);
  const [newRecipient, setNewRecipient] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showBulkEditor, setShowBulkEditor] = useState(false);
  const [bulkRecipients, setBulkRecipients] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [showAllRecipients, setShowAllRecipients] = useState(false);
  const wasOpenRef = useRef(isOpen);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;

    if (isOpen && !wasOpen) {
      setError(null);
      setNewRecipient('');
      setShowBulkEditor(false);
      setBulkRecipients(safeRecipients.join('\n'));
      setEditingIndex(null);
      setEditingValue('');
      setShowAllRecipients(false);
    }

    wasOpenRef.current = isOpen;
  }, [isOpen, safeRecipients]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const addRecipient = useCallback(() => {
    const resolution = resolveAddRecipient({
      recipients: safeRecipients,
      input: newRecipient,
    });

    if (!resolution.ok) {
      setError(resolution.error.message);
      return;
    }

    onRecipientsChange(resolution.value.recipients);
    setNewRecipient('');
    setError(null);
  }, [newRecipient, onRecipientsChange, safeRecipients]);

  const toggleBulkEditor = useCallback(() => {
    setShowBulkEditor(previous => !previous);
    setBulkRecipients(safeRecipients.join('\n'));
    setError(null);
  }, [safeRecipients]);

  const saveBulkRecipients = useCallback(() => {
    const resolution = resolveBulkRecipients({
      rawInput: bulkRecipients,
    });

    if (!resolution.ok) {
      setError(resolution.error.message);
      return;
    }

    onRecipientsChange(resolution.value.recipients);
    setShowBulkEditor(false);
    setError(null);
  }, [bulkRecipients, onRecipientsChange]);

  const cancelBulkEdit = useCallback(() => {
    setBulkRecipients(safeRecipients.join('\n'));
    setShowBulkEditor(false);
    setError(null);
  }, [safeRecipients]);

  const startEditRecipient = useCallback(
    (index: number) => {
      if (index < 0 || index >= safeRecipients.length) {
        return;
      }

      setEditingIndex(index);
      setEditingValue(safeRecipients[index]);
      setError(null);
    },
    [safeRecipients]
  );

  const saveEditedRecipient = useCallback(() => {
    if (editingIndex === null) {
      return;
    }

    const resolution = resolveUpdateRecipient({
      recipients: safeRecipients,
      index: editingIndex,
      input: editingValue,
    });

    if (!resolution.ok) {
      setError(resolution.error.message);
      return;
    }

    onRecipientsChange(resolution.value.recipients);
    setEditingIndex(null);
    setEditingValue('');
    setError(null);
  }, [editingIndex, editingValue, onRecipientsChange, safeRecipients]);

  const cancelEditRecipient = useCallback(() => {
    setEditingIndex(null);
    setEditingValue('');
  }, []);

  const removeRecipient = useCallback(
    (index: number) => {
      const resolution = resolveRemoveRecipient({
        recipients: safeRecipients,
        index,
      });

      if (!resolution.ok) {
        setError(resolution.error.message);
        return;
      }

      onRecipientsChange(resolution.value.recipients);
    },
    [onRecipientsChange, safeRecipients]
  );

  const toggleShowAllRecipients = useCallback(() => {
    setShowAllRecipients(previous => !previous);
  }, []);

  const { visibleRecipients, hiddenCount } = useMemo(
    () =>
      resolveVisibleRecipients({
        recipients: safeRecipients,
        showAll: showAllRecipients,
        maxVisible: MAX_VISIBLE_RECIPIENTS,
      }),
    [safeRecipients, showAllRecipients]
  );

  return {
    safeRecipients,
    visibleRecipients,
    hiddenRecipientsCount: hiddenCount,
    maxVisibleRecipients: MAX_VISIBLE_RECIPIENTS,
    newRecipient,
    error,
    showBulkEditor,
    bulkRecipients,
    editingIndex,
    editingValue,
    showAllRecipients,
    setNewRecipient,
    setBulkRecipients,
    setEditingValue,
    addRecipient,
    toggleBulkEditor,
    saveBulkRecipients,
    cancelBulkEdit,
    startEditRecipient,
    saveEditedRecipient,
    cancelEditRecipient,
    removeRecipient,
    toggleShowAllRecipients,
    clearError,
  };
};
