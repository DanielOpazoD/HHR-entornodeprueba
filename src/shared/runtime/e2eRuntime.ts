const hasWindow = (): boolean => typeof window !== 'undefined';

const isLocalRuntime = (): boolean =>
  hasWindow() &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

export const isE2ERuntimeEnabled = (): boolean =>
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_E2E_MODE === 'true') ||
  isLocalRuntime();

const readLocalStorageFlag = (key: string): boolean =>
  hasWindow() && window.localStorage?.getItem(key) === 'true';

export const isE2EEditableRecordOverrideEnabled = (): boolean =>
  isE2ERuntimeEnabled() && readLocalStorageFlag('hhr_e2e_force_editable_record');

export const isE2ELocalOnlySyncForced = (): boolean =>
  isE2ERuntimeEnabled() && readLocalStorageFlag('hhr_e2e_force_local_only_sync');

export const isE2EDailyRecordAuthorityCallableForced = (): boolean =>
  isE2ERuntimeEnabled() && readLocalStorageFlag('hhr_e2e_force_authority_callable');

export const recordE2EClipboardText = (text: string): void => {
  if (!isE2ERuntimeEnabled() || !hasWindow()) {
    return;
  }

  (window as Window & { __HHR_LAST_CLIPBOARD__?: string }).__HHR_LAST_CLIPBOARD__ = text;
  window.localStorage?.setItem('hhr_e2e_last_clipboard', text);
};

export interface E2EDownloadArtifactMeta {
  filename: string;
  blobSize: number;
  blobType: string;
}

export const recordE2EDownloadArtifact = (meta: E2EDownloadArtifactMeta): void => {
  if (!isE2ERuntimeEnabled() || !hasWindow()) {
    return;
  }

  const runtimeWindow = window as Window & {
    __HHR_DOWNLOAD_CAPTURE__?: E2EDownloadArtifactMeta;
  };
  runtimeWindow.__HHR_DOWNLOAD_CAPTURE__ = meta;
  window.localStorage?.setItem('hhr_e2e_last_download', JSON.stringify(meta));
};
