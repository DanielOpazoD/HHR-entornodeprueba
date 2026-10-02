// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { getStorageListNotice, getStorageLookupNotice } from '@/services/backup/storageUiPolicy';

describe('storageUiPolicy', () => {
  it('returns restricted lookup warning', () => {
    expect(getStorageLookupNotice({ exists: false, status: 'restricted' }, 'censo')).toEqual({
      channel: 'info',
      title: 'Respaldo no verificable',
      message: 'No se pudo confirmar censo por permisos de Storage.',
      state: 'not_verified',
      actionRequired: false,
    });
  });

  it('silences passive timeout lookup notices', () => {
    expect(getStorageLookupNotice({ exists: false, status: 'timeout' }, 'PDF')).toBeNull();
  });

  it('returns list warning for timeout first', () => {
    expect(
      getStorageListNotice({
        skippedNotFound: 0,
        skippedRestricted: 2,
        skippedUnknown: 1,
        skippedUnparsed: 1,
        timedOut: true,
      })
    ).toEqual({
      channel: 'warning',
      title: 'Carga parcial de respaldos',
      message: 'La consulta a Storage tardó demasiado. La lista puede estar incompleta.',
      state: 'retrying',
      actionRequired: false,
    });
  });

  it('returns list info for restricted files when the listing itself succeeded', () => {
    expect(
      getStorageListNotice({
        skippedNotFound: 0,
        skippedRestricted: 2,
        skippedUnknown: 0,
        skippedUnparsed: 0,
        timedOut: false,
      })
    ).toEqual({
      channel: 'info',
      title: 'Carga parcial de respaldos',
      message: '2 archivo(s) no pudieron leerse por restricciones de acceso.',
      state: 'ok',
      actionRequired: false,
    });
  });

  it('returns list info for degraded metadata', () => {
    expect(
      getStorageListNotice({
        skippedNotFound: 0,
        skippedRestricted: 0,
        skippedUnknown: 1,
        skippedUnparsed: 1,
        timedOut: false,
      })
    ).toEqual({
      channel: 'warning',
      title: 'Carga parcial de respaldos',
      message: '2 archivo(s) fueron omitidos por datos o metadata incompatibles.',
      state: 'degraded',
      actionRequired: false,
    });
  });
});
