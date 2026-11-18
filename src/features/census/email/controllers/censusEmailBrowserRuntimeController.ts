export interface CensusEmailBrowserRuntime {
  getLegacyRecipients: () => string | null;
  clearLegacyRecipients: () => void;
  writeClipboard: (text: string) => Promise<void>;
}

export const defaultCensusEmailBrowserRuntime: CensusEmailBrowserRuntime = {
  getLegacyRecipients: () =>
    typeof localStorage !== 'undefined' ? localStorage.getItem('censusEmailRecipients') : null,
  clearLegacyRecipients: () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('censusEmailRecipients');
    }
  },
  writeClipboard: async (text: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      throw new Error('Clipboard API no disponible');
    }
    await navigator.clipboard.writeText(text);
  },
};
