export const CLINICAL_PANEL_WIDE_STORAGE_KEY = 'hhr_clinical_panel_wide';

export const readClinicalPanelWidePreference = (): boolean => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    return window.localStorage.getItem(CLINICAL_PANEL_WIDE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

export const writeClinicalPanelWidePreference = (isWide: boolean): void => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(CLINICAL_PANEL_WIDE_STORAGE_KEY, isWide ? 'true' : 'false');
  } catch {
    // Storage may be unavailable in restricted contexts; keep in-memory width only.
  }
};
