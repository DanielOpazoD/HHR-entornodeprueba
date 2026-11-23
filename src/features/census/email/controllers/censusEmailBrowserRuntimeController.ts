export interface CensusEmailBrowserRuntime {
  getLegacyRecipients: () => string | null;
  clearLegacyRecipients: () => void;
  writeClipboard: (text: string) => Promise<void>;
}

export const defaultCensusEmailBrowserRuntime: CensusEmailBrowserRuntime = {
  getLegacyRecipients: () => {
    try {
      return typeof localStorage !== 'undefined'
        ? localStorage.getItem('censusEmailRecipients')
        : null;
    } catch {
      return null;
    }
  },
  clearLegacyRecipients: () => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('censusEmailRecipients');
      }
    } catch {
      // Storage may be unavailable in restricted browser contexts.
    }
  },
  writeClipboard: async (text: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      throw new Error('Clipboard API no disponible');
    }
    await navigator.clipboard.writeText(text);
  },
};
