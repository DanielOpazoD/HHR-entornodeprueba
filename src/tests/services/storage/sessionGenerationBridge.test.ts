import { afterEach, expect, it, vi } from 'vitest';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';

afterEach(() => {
  setSessionGeneration(null);
  vi.restoreAllMocks();
});

it('silently notifies the existing page bridge on admission, replacement and logout only', () => {
  const post = vi.spyOn(window, 'postMessage');
  setSessionGeneration('synthetic-a');
  setSessionGeneration('synthetic-a');
  setSessionGeneration('synthetic-b');
  setSessionGeneration(null);
  expect(post.mock.calls).toEqual(
    Array.from({ length: 3 }, () => [{ type: 'HHR_RAYEN_SESSION_CHANGED' }, window.location.origin])
  );
});
