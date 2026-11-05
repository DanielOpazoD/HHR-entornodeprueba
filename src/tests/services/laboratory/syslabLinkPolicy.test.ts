import { describe, expect, it } from 'vitest';
import {
  SYSLAB_LINK_LIFETIME_MS,
  SYSLAB_LIST_REUSE_MS,
  SYSLAB_LIST_RETENTION_MS,
} from '@/services/laboratory/syslabLinkPolicy';

describe('Syslab link policy', () => {
  it('renews a list before its links expire, with a margin for the report reads', () => {
    expect(SYSLAB_LIST_REUSE_MS).toBeLessThanOrEqual(SYSLAB_LINK_LIFETIME_MS - 60_000);
  });

  it('keeps a list at least as long as it may be reused', () => {
    expect(SYSLAB_LIST_RETENTION_MS).toBeGreaterThanOrEqual(SYSLAB_LIST_REUSE_MS);
  });
});
