import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLogoutAuditPreload } from '@/hooks/useAuthStateSessionSupport';

const portModule = vi.hoisted(() => ({ loads: 0 }));

vi.mock('@/application/ports/auditPort', () => {
  portModule.loads += 1;
  return { defaultAuditPort: { logUserLogout: vi.fn() } };
});

describe('useLogoutAuditPreload', () => {
  it('fetches the logout audit module once someone signs in, not before', async () => {
    const { rerender } = renderHook(({ uid }) => useLogoutAuditPreload(uid), {
      initialProps: { uid: undefined as string | undefined },
    });
    await vi.dynamicImportSettled();
    expect(portModule.loads).toBe(0);

    rerender({ uid: 'u1' });
    await vi.dynamicImportSettled();
    expect(portModule.loads).toBe(1);
  });
});
