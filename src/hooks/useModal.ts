/**
 * useModal Hook
 * 
 * A generic hook for managing modal state with optional data payload.
 * Provides a consistent pattern for opening/closing modals across the application.
 * 
 * @template T - Type of data to pass when opening the modal
 * 
 * @example
 * ```tsx
 * // Simple modal (no data)
 * const settingsModal = useModal();
 * <SettingsModal isOpen={settingsModal.isOpen} onClose={settingsModal.close} />
 * 
 * // Modal with data
 * const dischargeModal = useModal<PatientData>();
 * dischargeModal.open(patient);
 * <DischargeModal 
 *   isOpen={dischargeModal.isOpen} 
 *   patient={dischargeModal.data}
 *   onClose={dischargeModal.close} 
 * />
 * ```
 */

import { useState, useCallback } from 'react';

export interface UseModalReturn<T = void> {
    /** Whether the modal is currently open */
    isOpen: boolean;
    /** Data passed when opening the modal (null when closed) */
    data: T | null;
    /** Open the modal, optionally with initial data */
    open: (initialData?: T) => void;
    /** Close the modal and clear data */
    close: () => void;
    /** Toggle modal state */
    toggle: () => void;
}

/**
 * Generic hook for modal state management
 * 
 * @template T - Type of data to pass to the modal
 * @returns Modal state and control functions
 */
export function useModal<T = void>(): UseModalReturn<T> {
    const [isOpen, setIsOpen] = useState(false);
    const [data, setData] = useState<T | null>(null);

    const open = useCallback((initialData?: T) => {
        setData(initialData ?? null);
        setIsOpen(true);
    }, []);

    const close = useCallback(() => {
        setIsOpen(false);
        // Delay clearing data to allow exit animations
        setTimeout(() => setData(null), 300);
    }, []);

    const toggle = useCallback(() => {
        if (isOpen) {
            close();
        } else {
            open();
        }
    }, [isOpen, open, close]);

    return {
        isOpen,
        data,
        open,
        close,
        toggle
    };
}

export default useModal;
