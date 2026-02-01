import { getSetting, saveSetting } from './storage/indexedDBService';

export const getAppSetting = async <T>(key: string, defaultValue: T): Promise<T> => {
    return getSetting<T>(key, defaultValue);
};

export const saveAppSetting = async <T>(key: string, value: T): Promise<void> => {
    return saveSetting(key, value);
};
