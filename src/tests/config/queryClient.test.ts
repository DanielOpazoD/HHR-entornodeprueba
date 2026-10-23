import { describe, expect, it } from 'vitest';
import { queryClient } from '@/config/queryClient';

describe('global query defaults', () => {
  it('refetches on tab return, mount and reconnect only when the data is stale', () => {
    const queries = queryClient.getDefaultOptions().queries;
    expect(queries?.refetchOnWindowFocus).toBe(true);
    expect(queries?.refetchOnReconnect).toBe(true);
    expect(queries?.refetchOnMount).toBe(true);
    expect(queries?.staleTime).toBe(5 * 60 * 1000);
  });
});
