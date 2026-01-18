/**
 * Patch Utilities
 * Utilities for applying partial updates with dot-notation paths.
 */

import { DailyRecordPatch } from '../types';

/**
 * Applies dot-notation updates to an object.
 * Useful for mirroring Firestore updateDoc behavior locally in optimistic updates.
 * 
 * Flow:
 * 1. Deep clones the object to ensure React state immutability.
 * 2. Parses dot-paths (e.g., "beds.bed-1.name") and traverses the object.
 * 3. Applies the new value at the leaf node.
 * 
 * @param obj - The base object to patch
 * @param patches - A flat object where keys are dot-paths and values are the new data
 * @returns A new object with the patches applied
 */
export const applyPatches = <T>(obj: T, patches: DailyRecordPatch): T => {
    if (!obj) return obj;

    // Deep clone state to avoid mutation side-effects
    const newObj = JSON.parse(JSON.stringify(obj));

    Object.entries(patches).forEach(([path, value]) => {
        const parts = path.split('.');
        let current: Record<string, unknown> = newObj as Record<string, unknown>;

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            // Create structure if missing (auto-vivification)
            if (current[part] === undefined || current[part] === null) {
                current[part] = {};
            }
            current = current[part] as Record<string, unknown>;
        }

        const lastPart = parts[parts.length - 1];
        current[lastPart] = value;
    });

    return newObj;
};
