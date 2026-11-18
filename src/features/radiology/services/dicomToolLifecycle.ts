import { ToolGroupManager } from '@cornerstonejs/tools';

/** Cornerstone destroyToolGroup only removes the registry entry; disable tools first. */
export const destroyDicomToolGroup = (id: string) => {
  const group = ToolGroupManager.getToolGroup(id);
  if (!group) return;
  Object.keys(group.getToolInstances()).forEach(name => group.setToolDisabled(name));
  ToolGroupManager.destroyToolGroup(id);
};
