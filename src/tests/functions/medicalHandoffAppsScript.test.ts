import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

interface AppsScriptContext {
  acquireHhrScriptLock_: () => unknown;
  moveHhrSpreadsheetToHandoffFolder_: (spreadsheetId: string) => string;
  openExistingHhrSpreadsheet_: (spreadsheetId: string | null) => unknown;
  parseValidatedHhrRequest_: (event: unknown) => unknown;
}

const loadAppsScriptContext = (runtime: Record<string, unknown> = {}): AppsScriptContext => {
  const source = readFileSync(
    path.join(process.cwd(), 'integrations/google-apps-script/medical-handoff/Code.gs'),
    'utf8'
  );
  const context = vm.createContext({
    Utilities: {
      DigestAlgorithm: { SHA_384: 'SHA_384' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (_algorithm: string, value: string) =>
        Array.from(createHash('sha384').update(value, 'utf8').digest()).map(byte =>
          byte > 127 ? byte - 256 : byte
        ),
    },
    console,
    ...runtime,
  });
  vm.runInContext(source, context);
  return context as unknown as AppsScriptContext;
};

describe('medical handoff Apps Script', () => {
  it('classifies lock contention as a retryable busy operation', () => {
    const { acquireHhrScriptLock_ } = loadAppsScriptContext({
      LockService: {
        getScriptLock: () => ({
          waitLock: () => {
            throw new Error('Lock timeout');
          },
        }),
      },
    });

    expect(() => acquireHhrScriptLock_()).toThrow('operation_busy');
  });

  it('classifies malformed requests separately from spreadsheet failures', () => {
    const { parseValidatedHhrRequest_ } = loadAppsScriptContext();

    expect(() => parseValidatedHhrRequest_(null)).toThrow('request_rejected');
  });

  it('keeps an explicitly configured institutional folder authoritative', () => {
    const getProperty = vi.fn().mockReturnValue('configured-folder');
    const setProperty = vi.fn();
    const configuredFolder = {
      getId: vi.fn().mockReturnValue('configured-folder'),
      getName: vi.fn().mockReturnValue('Entrega institucional'),
      isTrashed: vi.fn().mockReturnValue(false),
    };
    const createFolder = vi.fn();
    const moveTo = vi.fn();
    const getFolderById = vi.fn().mockReturnValue(configuredFolder);
    const { moveHhrSpreadsheetToHandoffFolder_ } = loadAppsScriptContext({
      PropertiesService: {
        getScriptProperties: () => ({ getProperty, setProperty }),
      },
      DriveApp: {
        getFolderById,
        createFolder,
        getFileById: vi.fn().mockReturnValue({ moveTo }),
      },
    });

    moveHhrSpreadsheetToHandoffFolder_('spreadsheet-1');

    expect(getFolderById).toHaveBeenCalledWith('configured-folder');
    expect(createFolder).not.toHaveBeenCalled();
    expect(setProperty).not.toHaveBeenCalled();
    expect(moveTo).toHaveBeenCalledWith(configuredFolder);
  });

  it('preserves an inaccessible configured folder instead of guessing a replacement', () => {
    const getProperty = vi.fn().mockReturnValue('inaccessible-folder');
    const setProperty = vi.fn();
    const createFolder = vi.fn();
    const sleep = vi.fn();
    const getFolderById = vi.fn().mockImplementation(() => {
      throw new Error('Folder not found');
    });
    const { moveHhrSpreadsheetToHandoffFolder_ } = loadAppsScriptContext({
      PropertiesService: {
        getScriptProperties: () => ({ getProperty, setProperty }),
      },
      Utilities: {
        DigestAlgorithm: { SHA_384: 'SHA_384' },
        Charset: { UTF_8: 'UTF_8' },
        computeDigest: (_algorithm: string, value: string) =>
          Array.from(createHash('sha384').update(value, 'utf8').digest()).map(byte =>
            byte > 127 ? byte - 256 : byte
          ),
        sleep,
      },
      DriveApp: {
        getFolderById,
        createFolder,
        getFileById: vi.fn(),
      },
    });

    expect(() => moveHhrSpreadsheetToHandoffFolder_('spreadsheet-1')).toThrow('folder_unavailable');
    expect(getFolderById).toHaveBeenCalledTimes(4);
    expect(createFolder).not.toHaveBeenCalled();
    expect(setProperty).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('restores a configured folder from Drive trash with all historical sheets attached', () => {
    const getProperty = vi.fn().mockReturnValue('trashed-folder');
    const setProperty = vi.fn();
    const setTrashed = vi.fn();
    const trashedFolder = {
      getName: vi.fn().mockReturnValue('Entrega de turno médicos'),
      isTrashed: vi.fn().mockReturnValue(true),
      setTrashed,
    };
    const createFolder = vi.fn();
    const moveTo = vi.fn();
    const { moveHhrSpreadsheetToHandoffFolder_ } = loadAppsScriptContext({
      PropertiesService: {
        getScriptProperties: () => ({ getProperty, setProperty }),
      },
      Utilities: {
        DigestAlgorithm: { SHA_384: 'SHA_384' },
        Charset: { UTF_8: 'UTF_8' },
        computeDigest: (_algorithm: string, value: string) =>
          Array.from(createHash('sha384').update(value, 'utf8').digest()).map(byte =>
            byte > 127 ? byte - 256 : byte
          ),
        sleep: vi.fn(),
      },
      DriveApp: {
        getFolderById: vi.fn().mockReturnValue(trashedFolder),
        createFolder,
        getFileById: vi.fn().mockReturnValue({ moveTo }),
      },
    });

    expect(moveHhrSpreadsheetToHandoffFolder_('spreadsheet-1')).toBe('recovered');
    expect(setTrashed).toHaveBeenCalledWith(false);
    expect(createFolder).not.toHaveBeenCalled();
    expect(setProperty).not.toHaveBeenCalled();
    expect(moveTo).toHaveBeenCalledWith(trashedFolder);
  });

  it('reports recovery when untrash commits before an ambiguous Drive timeout', () => {
    const setTrashed = vi.fn().mockImplementationOnce(() => {
      throw new Error('Ambiguous timeout after commit');
    });
    const folder = {
      getName: vi.fn().mockReturnValue('Entrega de turno médicos'),
      isTrashed: vi.fn().mockReturnValueOnce(true).mockReturnValue(false),
      setTrashed,
    };
    const sleep = vi.fn();
    const moveTo = vi.fn();
    const { moveHhrSpreadsheetToHandoffFolder_ } = loadAppsScriptContext({
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: vi.fn().mockReturnValue('trashed-folder'),
          setProperty: vi.fn(),
        }),
      },
      Utilities: {
        DigestAlgorithm: { SHA_384: 'SHA_384' },
        Charset: { UTF_8: 'UTF_8' },
        computeDigest: (_algorithm: string, value: string) =>
          Array.from(createHash('sha384').update(value, 'utf8').digest()).map(byte =>
            byte > 127 ? byte - 256 : byte
          ),
        sleep,
      },
      DriveApp: {
        getFolderById: vi.fn().mockReturnValue(folder),
        createFolder: vi.fn(),
        getFileById: vi.fn().mockReturnValue({ moveTo }),
      },
    });

    expect(moveHhrSpreadsheetToHandoffFolder_('spreadsheet-1')).toBe('recovered');
    expect(setTrashed).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(moveTo).toHaveBeenCalledWith(folder);
  });

  it('preserves the configured folder after ambiguous transient Drive failures', () => {
    const setProperty = vi.fn();
    const createFolder = vi.fn();
    const sleep = vi.fn();
    const { moveHhrSpreadsheetToHandoffFolder_ } = loadAppsScriptContext({
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: vi.fn().mockReturnValue('configured-folder'),
          setProperty,
        }),
      },
      Utilities: {
        DigestAlgorithm: { SHA_384: 'SHA_384' },
        Charset: { UTF_8: 'UTF_8' },
        computeDigest: (_algorithm: string, value: string) =>
          Array.from(createHash('sha384').update(value, 'utf8').digest()).map(byte =>
            byte > 127 ? byte - 256 : byte
          ),
        sleep,
      },
      DriveApp: {
        getFolderById: vi.fn().mockImplementation(() => {
          throw new Error('Service invoked too many times');
        }),
        createFolder,
        getFileById: vi.fn(),
      },
    });

    expect(() => moveHhrSpreadsheetToHandoffFolder_('spreadsheet-1')).toThrow('folder_unavailable');
    expect(createFolder).not.toHaveBeenCalled();
    expect(setProperty).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('creates and remembers the default institutional folder when none is configured', () => {
    const getProperty = vi.fn().mockReturnValue(null);
    const setProperty = vi.fn();
    const folder = { getId: vi.fn().mockReturnValue('folder-1') };
    const moveTo = vi.fn();
    const createFolder = vi.fn().mockReturnValue(folder);
    const { moveHhrSpreadsheetToHandoffFolder_ } = loadAppsScriptContext({
      PropertiesService: {
        getScriptProperties: () => ({ getProperty, setProperty }),
      },
      DriveApp: {
        getFolderById: vi.fn(),
        createFolder,
        getFileById: vi.fn().mockReturnValue({ moveTo }),
      },
    });

    moveHhrSpreadsheetToHandoffFolder_('spreadsheet-1');

    expect(createFolder).toHaveBeenCalledWith('Entrega de turno médicos');
    expect(setProperty).toHaveBeenCalledWith('HHR_HANDOFF_FOLDER_ID', 'folder-1');
    expect(moveTo).toHaveBeenCalledWith(folder);
  });

  it('creates a folder only once and trashes it if its identifier cannot be remembered', () => {
    const setTrashed = vi.fn();
    const folder = {
      getId: vi.fn().mockReturnValue('untracked-folder'),
      setTrashed,
    };
    const createFolder = vi.fn().mockReturnValue(folder);
    const { moveHhrSpreadsheetToHandoffFolder_ } = loadAppsScriptContext({
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: vi.fn().mockReturnValue(null),
          setProperty: vi.fn().mockImplementation(() => {
            throw new Error('Properties unavailable');
          }),
        }),
      },
      DriveApp: {
        getFolderById: vi.fn(),
        createFolder,
        getFileById: vi.fn(),
      },
    });

    expect(() => moveHhrSpreadsheetToHandoffFolder_('spreadsheet-1')).toThrow('folder_unavailable');
    expect(createFolder).toHaveBeenCalledTimes(1);
    expect(setTrashed).toHaveBeenCalledWith(true);
  });

  it('retries Drive reconciliation while a newly created spreadsheet is being indexed', () => {
    const getProperty = vi.fn().mockReturnValue('configured-folder');
    const configuredFolder = {
      getId: vi.fn().mockReturnValue('configured-folder'),
      getName: vi.fn().mockReturnValue('Entrega institucional'),
      isTrashed: vi.fn().mockReturnValue(false),
    };
    const moveTo = vi.fn();
    const sleep = vi.fn();
    const getFileById = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Drive has not indexed the spreadsheet yet');
      })
      .mockReturnValue({ moveTo });
    const { moveHhrSpreadsheetToHandoffFolder_ } = loadAppsScriptContext({
      PropertiesService: {
        getScriptProperties: () => ({ getProperty, setProperty: vi.fn() }),
      },
      Utilities: {
        DigestAlgorithm: { SHA_384: 'SHA_384' },
        Charset: { UTF_8: 'UTF_8' },
        computeDigest: (_algorithm: string, value: string) =>
          Array.from(createHash('sha384').update(value, 'utf8').digest()).map(byte =>
            byte > 127 ? byte - 256 : byte
          ),
        sleep,
      },
      DriveApp: {
        getFolderById: vi.fn().mockReturnValue(configuredFolder),
        createFolder: vi.fn(),
        getFileById,
      },
    });

    moveHhrSpreadsheetToHandoffFolder_('spreadsheet-1');

    expect(getFileById).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(400);
    expect(moveTo).toHaveBeenCalledWith(configuredFolder);
  });

  it('keeps the configured destination when moving the sheet remains unavailable', () => {
    const configuredFolder = {
      getName: vi.fn().mockReturnValue('Entrega institucional'),
      isTrashed: vi.fn().mockReturnValue(false),
    };
    const setProperty = vi.fn();
    const createFolder = vi.fn();
    const sleep = vi.fn();
    const moveTo = vi.fn().mockImplementation(() => {
      throw new Error('Drive quota unavailable');
    });
    const { moveHhrSpreadsheetToHandoffFolder_ } = loadAppsScriptContext({
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: vi.fn().mockReturnValue('configured-folder'),
          setProperty,
        }),
      },
      Utilities: {
        DigestAlgorithm: { SHA_384: 'SHA_384' },
        Charset: { UTF_8: 'UTF_8' },
        computeDigest: (_algorithm: string, value: string) =>
          Array.from(createHash('sha384').update(value, 'utf8').digest()).map(byte =>
            byte > 127 ? byte - 256 : byte
          ),
        sleep,
      },
      DriveApp: {
        getFolderById: vi.fn().mockReturnValue(configuredFolder),
        createFolder,
        getFileById: vi.fn().mockReturnValue({ moveTo }),
      },
    });

    expect(() => moveHhrSpreadsheetToHandoffFolder_('spreadsheet-1')).toThrow('folder_unavailable');
    expect(moveTo).toHaveBeenCalledTimes(4);
    expect(createFolder).not.toHaveBeenCalled();
    expect(setProperty).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('retries a registered daily sheet without replacing it after a transient read failure', () => {
    const existingSpreadsheet = { getId: vi.fn().mockReturnValue('spreadsheet-1') };
    const openById = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Drive indexing delay');
      })
      .mockReturnValue(existingSpreadsheet);
    const sleep = vi.fn();
    const { openExistingHhrSpreadsheet_ } = loadAppsScriptContext({
      SpreadsheetApp: { openById },
      Utilities: {
        DigestAlgorithm: { SHA_384: 'SHA_384' },
        Charset: { UTF_8: 'UTF_8' },
        computeDigest: (_algorithm: string, value: string) =>
          Array.from(createHash('sha384').update(value, 'utf8').digest()).map(byte =>
            byte > 127 ? byte - 256 : byte
          ),
        sleep,
      },
    });

    expect(openExistingHhrSpreadsheet_('spreadsheet-1')).toBe(existingSpreadsheet);
    expect(openById).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(400);
  });

  it('fails closed instead of creating a duplicate when the registered sheet stays unavailable', () => {
    const sleep = vi.fn();
    const { openExistingHhrSpreadsheet_ } = loadAppsScriptContext({
      SpreadsheetApp: {
        openById: vi.fn().mockImplementation(() => {
          throw new Error('Sheet unavailable');
        }),
      },
      Utilities: {
        DigestAlgorithm: { SHA_384: 'SHA_384' },
        Charset: { UTF_8: 'UTF_8' },
        computeDigest: (_algorithm: string, value: string) =>
          Array.from(createHash('sha384').update(value, 'utf8').digest()).map(byte =>
            byte > 127 ? byte - 256 : byte
          ),
        sleep,
      },
    });

    expect(() => openExistingHhrSpreadsheet_('spreadsheet-1')).toThrowError('sheet_update_failed');
    expect(sleep).toHaveBeenCalledTimes(3);
  });
});
