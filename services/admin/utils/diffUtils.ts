/**
 * Diff Utilities
 * Provides word-level comparison between two strings.
 */

export interface DiffPart {
    value: string;
    added?: boolean;
    removed?: boolean;
}

/**
 * Computes a word-level diff between two strings.
 * This is a simple implementation that highlights additions and deletions.
 */
export const computeWordDiff = (oldStr: string, newStr: string): DiffPart[] => {
    if (!oldStr) return [{ value: newStr, added: true }];
    if (!newStr) return [{ value: oldStr, removed: true }];

    const oldWords = oldStr.split(/(\s+)/);
    const newWords = newStr.split(/(\s+)/);

    // Simple LCS-based or simplified word match
    // For clinical notes, we usually care about what changed in place.
    // We'll use a basic word-by-word comparison for now.

    // Note: A full Myers diff would be better, but for a 1-7 app, 
    // a clean word comparison is often enough.

    const result: DiffPart[] = [];
    let i = 0;
    let j = 0;

    while (i < oldWords.length || j < newWords.length) {
        if (i < oldWords.length && j < newWords.length && oldWords[i] === newWords[j]) {
            result.push({ value: oldWords[i] });
            i++;
            j++;
        } else {
            // Found a difference. Look ahead to see if we can resync.
            let foundMatch = false;

            // Try to find oldWords[i] in a small window of newWords
            for (let k = j + 1; k < Math.min(j + 5, newWords.length); k++) {
                if (newWords[k] === oldWords[i]) {
                    // Everything from j to k-1 is added
                    for (let x = j; x < k; x++) {
                        result.push({ value: newWords[x], added: true });
                    }
                    j = k;
                    foundMatch = true;
                    break;
                }
            }

            if (!foundMatch) {
                // Try to find newWords[j] in a small window of oldWords
                for (let k = i + 1; k < Math.min(i + 5, oldWords.length); k++) {
                    if (oldWords[k] === newWords[j]) {
                        // Everything from i to k-1 is removed
                        for (let x = i; x < k; x++) {
                            result.push({ value: oldWords[x], removed: true });
                        }
                        i = k;
                        foundMatch = true;
                        break;
                    }
                }
            }

            if (!foundMatch) {
                // If no sync found, treat as one removal and one addition (replacement)
                if (i < oldWords.length) {
                    result.push({ value: oldWords[i], removed: true });
                    i++;
                }
                if (j < newWords.length) {
                    result.push({ value: newWords[j], added: true });
                    j++;
                }
            }
        }
    }

    return result;
};
