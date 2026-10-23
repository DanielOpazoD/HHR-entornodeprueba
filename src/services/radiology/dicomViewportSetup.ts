import { Enums, type RenderingEngine, type Types } from '@cornerstonejs/core';
import { ToolGroupManager, StackScrollTool, Enums as ToolEnums } from '@cornerstonejs/tools';
import { dicomTools } from './dicomInitialization';
import type { DicomMode } from './dicomRuntimeTypes';
export const configureDicomViewports = (
  engine: RenderingEngine,
  elements: HTMLDivElement[],
  id: string,
  mode: DicomMode
) => {
  const axes = [
    Enums.OrientationAxis.AXIAL,
    Enums.OrientationAxis.CORONAL,
    Enums.OrientationAxis.SAGITTAL,
  ];
  const viewportIds = elements.map((_, i) => `${id}-${mode}-${i}`);
  engine.setViewports(
    elements.map((element, i) => ({
      viewportId: viewportIds[i],
      element,
      type:
        mode === 'original'
          ? Enums.ViewportType.STACK
          : mode === '3d'
            ? Enums.ViewportType.VOLUME_3D
            : Enums.ViewportType.ORTHOGRAPHIC,
      defaultOptions: { background: [0, 0, 0] as Types.Point3, orientation: axes[i] },
    }))
  );
  const group = ToolGroupManager.createToolGroup(id);
  if (!group) throw new Error('No se pudieron inicializar las herramientas del visor.');
  dicomTools.forEach(tool => group.addTool(tool.toolName));
  viewportIds.forEach(viewport => group.addViewport(viewport, id));
  if (mode === 'mpr')
    group.setToolActive(StackScrollTool.toolName, {
      bindings: [{ mouseButton: ToolEnums.MouseBindings.Wheel }],
    });
  return { viewportIds, group };
};
