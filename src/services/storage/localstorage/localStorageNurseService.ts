import {
  DEFAULT_NURSES,
  NURSES_STORAGE_KEY,
  readLocalStorageJson,
  writeLocalStorageJson,
} from './localStorageCore';

export const getStoredNurses = (): string[] =>
  readLocalStorageJson<string[]>(NURSES_STORAGE_KEY, DEFAULT_NURSES);

export const saveStoredNurses = (nurses: string[]): void => {
  writeLocalStorageJson(NURSES_STORAGE_KEY, nurses);
};
