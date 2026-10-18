import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  getToolGroup: vi.fn(),
  destroyToolGroup: vi.fn(),
}));
vi.mock('@cornerstonejs/tools', () => ({ ToolGroupManager: state }));
import { destroyDicomToolGroup } from '@/services/radiology/dicomToolLifecycle';
it('disables tool observers before removing the group registry entry', () => {
  const calls: string[] = [];
  state.getToolGroup.mockReturnValue({
    getToolInstances: () => ({ TrackballRotate: {}, Crosshairs: {} }),
    setToolDisabled: (name: string) => calls.push(name),
  });
  state.destroyToolGroup.mockImplementation(() => calls.push('destroy'));
  destroyDicomToolGroup('synthetic-group');
  expect(calls).toEqual(['TrackballRotate', 'Crosshairs', 'destroy']);
});
it('allows repeated teardown after the group was removed', () => {
  state.getToolGroup.mockReturnValue(undefined);
  state.destroyToolGroup.mockClear();
  destroyDicomToolGroup('already-closed');
  expect(state.destroyToolGroup).not.toHaveBeenCalled();
});
