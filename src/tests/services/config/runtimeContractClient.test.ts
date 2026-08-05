import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assessRemoteRuntimeContract,
  fetchRemoteRuntimeContract,
} from '@/services/config/runtimeContractClient';
import {
  BACKEND_RUNTIME_CONTRACT_VERSION,
  CLIENT_RUNTIME_CONTRACT_VERSION,
  MIN_SUPPORTED_BACKEND_RUNTIME_CONTRACT_VERSION,
} from '@/constants/runtimeContracts';
import { CURRENT_SCHEMA_VERSION, LEGACY_SCHEMA_VERSION } from '@/constants/version';

describe('runtimeContractClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts a compatible runtime contract', () => {
    expect(
      assessRemoteRuntimeContract({
        backendRuntimeContractVersion: BACKEND_RUNTIME_CONTRACT_VERSION,
        minSupportedClientRuntimeContractVersion: CLIENT_RUNTIME_CONTRACT_VERSION,
        supportedSchemaVersion: CURRENT_SCHEMA_VERSION,
        legacySchemaFloorVersion: LEGACY_SCHEMA_VERSION,
      })
    ).toEqual({
      ok: true,
      disposition: 'compatible',
    });
  });

  it('flags schema_ahead_of_client when the remote schema is newer', () => {
    expect(
      assessRemoteRuntimeContract({
        backendRuntimeContractVersion: BACKEND_RUNTIME_CONTRACT_VERSION,
        minSupportedClientRuntimeContractVersion: CLIENT_RUNTIME_CONTRACT_VERSION,
        supportedSchemaVersion: CURRENT_SCHEMA_VERSION + 1,
        legacySchemaFloorVersion: LEGACY_SCHEMA_VERSION,
      })
    ).toEqual({
      ok: false,
      disposition: 'schema_ahead_of_client',
    });
  });

  it('flags runtime_contract_mismatch when backend support falls below the client floor', () => {
    expect(
      assessRemoteRuntimeContract({
        backendRuntimeContractVersion: MIN_SUPPORTED_BACKEND_RUNTIME_CONTRACT_VERSION - 1,
        minSupportedClientRuntimeContractVersion: CLIENT_RUNTIME_CONTRACT_VERSION,
        supportedSchemaVersion: CURRENT_SCHEMA_VERSION,
        legacySchemaFloorVersion: LEGACY_SCHEMA_VERSION,
      })
    ).toEqual({
      ok: false,
      disposition: 'runtime_contract_mismatch',
    });
  });

  it('rejects a client older than the minimum published runtime', () => {
    expect(
      assessRemoteRuntimeContract({
        backendRuntimeContractVersion: BACKEND_RUNTIME_CONTRACT_VERSION,
        minSupportedClientRuntimeContractVersion: CLIENT_RUNTIME_CONTRACT_VERSION + 1,
        supportedSchemaVersion: CURRENT_SCHEMA_VERSION,
        legacySchemaFloorVersion: LEGACY_SCHEMA_VERSION,
      })
    ).toEqual({
      ok: false,
      disposition: 'runtime_contract_mismatch',
    });
  });

  it('fetches and validates the remote runtime contract payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: vi.fn().mockReturnValue('application/json; charset=utf-8'),
      },
      json: async () => ({
        backendRuntimeContractVersion: BACKEND_RUNTIME_CONTRACT_VERSION,
        minSupportedClientRuntimeContractVersion: CLIENT_RUNTIME_CONTRACT_VERSION,
        supportedSchemaVersion: CURRENT_SCHEMA_VERSION,
        legacySchemaFloorVersion: LEGACY_SCHEMA_VERSION,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchRemoteRuntimeContract()).resolves.toEqual({
      backendRuntimeContractVersion: BACKEND_RUNTIME_CONTRACT_VERSION,
      minSupportedClientRuntimeContractVersion: CLIENT_RUNTIME_CONTRACT_VERSION,
      supportedSchemaVersion: CURRENT_SCHEMA_VERSION,
      legacySchemaFloorVersion: LEGACY_SCHEMA_VERSION,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/.netlify/functions/runtime-contract?t=');
  });

  it('rejects an incomplete remote runtime contract payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: vi.fn().mockReturnValue('application/json'),
        },
        json: async () => ({
          backendRuntimeContractVersion: BACKEND_RUNTIME_CONTRACT_VERSION,
        }),
      })
    );

    await expect(fetchRemoteRuntimeContract()).rejects.toThrow(
      'Runtime contract response is incomplete'
    );
  });

  it('returns null when the runtime contract endpoint responds with HTML', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: vi.fn().mockReturnValue('text/html; charset=utf-8'),
        },
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      })
    );

    await expect(fetchRemoteRuntimeContract()).resolves.toBeNull();
  });

  it('returns null when the runtime contract endpoint is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      })
    );

    await expect(fetchRemoteRuntimeContract()).resolves.toBeNull();
  });
});
