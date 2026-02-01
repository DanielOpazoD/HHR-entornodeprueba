/**
 * useScrollLock Hook
 * 
 * A reusable hook to manage body scroll locking across multiple overlays/modals.
 * Uses a global Set of active IDs to ensure scroll is only unlocked when ALL consumers
 * have released their lock. This prevents counter drift and race conditions.
 * 
 * @example
 * ```tsx
 * const SomeModal = ({ isOpen, onClose }) => {
 *     useScrollLock(isOpen);
 *     if (!isOpen) return null;
 *     return <div>Modal Content</div>;
 * };
 * ```
 */

import { useEffect, useState } from 'react';

// Shared state for all hook instances (Singleton)
const activeLocks = new Set<string>();

/**
 * Update the DOM based on the Set size.
 */
const updateBodyScroll = () => {
    if (activeLocks.size > 0) {
        document.body.style.overflow = 'hidden';
        // Optional: Add padding-right to prevent layout shift if scrollbar disappears
        // document.body.style.paddingRight = '15px'; // Adjust based on OS/Browser
    } else {
        document.body.style.overflow = '';
        // document.body.style.paddingRight = '';
    }
    // Debug helper
    // console.log(`[useScrollLock] Active locks: ${activeLocks.size}`, Array.from(activeLocks));
};

/**
 * Locks body scroll when active.
 * Generates a unique ID for each instance to safely track its claim.
 * 
 * @param isActive - Whether this component should lock scroll
 */
export const useScrollLock = (isActive: boolean): void => {
    // Generate a unique ID for this hook instance
    const [id] = useState(() => `lock-${Math.random().toString(36).substr(2, 9)}`);

    useEffect(() => {
        if (isActive) {
            activeLocks.add(id);
            updateBodyScroll();
        } else {
            // If isActive becomes false, remove immediately
            activeLocks.delete(id);
            updateBodyScroll();
        }

        return () => {
            // Cleanup on unmount
            activeLocks.delete(id);
            updateBodyScroll();
        };
    }, [isActive, id]);
};

export default useScrollLock;
