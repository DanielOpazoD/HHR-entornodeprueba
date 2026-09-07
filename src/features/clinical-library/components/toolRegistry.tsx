import React from 'react';
import { Calculator, ListChecks, Mail, Pill, Syringe } from 'lucide-react';
import type { LibraryToolId } from '../domain/libraryCatalogTypes';
import { CriticalMedicationsTool } from './tools/CriticalMedicationsTool';
import { DosingCalculatorTool } from './tools/DosingCalculatorTool';
import { InfusionCalculatorTool } from './tools/InfusionCalculatorTool';
import { ScoresTool } from './tools/ScoresTool';
import { TransferCoverTool } from './tools/TransferCoverTool';
import type { ToolComponentProps } from './tools/ToolFrame';

interface ToolRegistration {
  icon: React.ReactNode;
  Component: React.ComponentType<ToolComponentProps>;
}

/** Única tabla que conecta el id del catálogo con su icono y su componente. */
export const TOOL_REGISTRY: Readonly<Record<LibraryToolId, ToolRegistration>> = {
  'transfer-cover': { icon: <Mail size={16} aria-hidden="true" />, Component: TransferCoverTool },
  'critical-medications': {
    icon: <Pill size={16} aria-hidden="true" />,
    Component: CriticalMedicationsTool,
  },
  infusion: { icon: <Syringe size={16} aria-hidden="true" />, Component: InfusionCalculatorTool },
  dosing: { icon: <Calculator size={16} aria-hidden="true" />, Component: DosingCalculatorTool },
  scores: { icon: <ListChecks size={16} aria-hidden="true" />, Component: ScoresTool },
};
