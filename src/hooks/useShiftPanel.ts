import { useState, useEffect, useCallback } from 'react';
import { subscribeToCurrentShift, saveManualShift, fetchShiftsFromGroup } from '@/services/integrations/whatsapp/whatsappService';
import type { WeeklyShift } from '@/types';

export const useShiftPanel = () => {
    const [shift, setShift] = useState<WeeklyShift | null>(null);
    const [loading, setLoading] = useState(true);
    const [showOriginal, setShowOriginal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [importMessage, setImportMessage] = useState('');
    const [importing, setImporting] = useState(false);
    const [importError, setImportError] = useState('');

    // State for fetching from WhatsApp group
    const [fetching, setFetching] = useState(false);
    const [fetchResult, setFetchResult] = useState<{ success?: boolean; message?: string; error?: string } | null>(null);

    useEffect(() => {
        const unsubscribe = subscribeToCurrentShift((data) => {
            setShift(data);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const handleImport = useCallback(async () => {
        if (!importMessage.trim()) {
            setImportError('Por favor, pega el mensaje de turno');
            return;
        }

        setImporting(true);
        setImportError('');

        const result = await saveManualShift(importMessage);

        if (result.success) {
            setShowImportModal(false);
            setImportMessage('');
        } else {
            setImportError(result.error || 'Error al importar el mensaje');
        }

        setImporting(false);
    }, [importMessage]);

    const handleFetchFromGroup = useCallback(async () => {
        setFetching(true);
        setFetchResult(null);

        const result = await fetchShiftsFromGroup();
        setFetchResult(result);
        setFetching(false);
    }, []);

    const toggleViewMode = useCallback((mode: 'parsed' | 'original') => {
        setShowOriginal(mode === 'original');
    }, []);

    return {
        shift,
        loading,
        showOriginal,
        showImportModal,
        setShowImportModal,
        importMessage,
        setImportMessage,
        importing,
        importError,
        fetching,
        fetchResult,
        handleImport,
        handleFetchFromGroup,
        toggleViewMode
    };
};
