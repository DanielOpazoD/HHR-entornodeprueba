import React from 'react';
import { Calculator, ListChecks, Syringe } from 'lucide-react';
import type { LibraryToolId } from '../domain/libraryCatalogTypes';
import { DosingCalculatorTool } from './tools/DosingCalculatorTool';
import { InfusionCalculatorTool } from './tools/InfusionCalculatorTool';
import { ScoresTool } from './tools/ScoresTool';
import type { ToolComponentProps } from './tools/ToolFrame';

interface ToolRegistration {
  icon: React.ReactNode;
  Component: React.ComponentType<ToolComponentProps>;
}

/** Única tabla que conecta el id del catálogo con su icono y su componente. */
export const TOOL_REGISTRY: Readonly<Record<LibraryToolId, ToolRegistration>> = {
  infusion: { icon: <Syringe size={16} aria-hidden="true" />, Component: InfusionCalculatorTool },
  dosing: { icon: <Calculator size={16} aria-hidden="true" />, Component: DosingCalculatorTool },
  scores: { icon: <ListChecks size={16} aria-hidden="true" />, Component: ScoresTool },
};
