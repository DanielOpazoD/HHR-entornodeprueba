/**
 * Presentational config and helpers for {@link ClinicalDocumentFormattingToolbar}.
 *
 * Extracted to keep the toolbar component within the module size budget; these
 * are pure constants, action descriptors, and small render helpers with no
 * component state.
 */

import React from 'react';
import {
  Bold,
  Eraser,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  Underline,
} from 'lucide-react';

import type { ClinicalDocumentFormattingCommand } from '@/features/clinical-documents/components/clinicalDocumentSheetShared';

// ---------------------------------------------------------------------------
// Sizes / placement constants
// ---------------------------------------------------------------------------

/** Icon size (px) for main toolbar buttons. */
export const TOOLBAR_ICON_SIZE = 15;

/** Icon size (px) for the expanded formatting sub-panel. */
export const FORMATTING_ICON_SIZE = 14;

/** Gap (px) between the Format button and the floating panel below it. */
export const FORMATTING_PANEL_OFFSET_PX = 8;

/** Minimum margin (px) the floating panel keeps from the viewport edges. */
export const FORMATTING_PANEL_VIEWPORT_MARGIN_PX = 8;

/**
 * Stacking order for the floating formatting panel. Must sit above the
 * BaseModal overlay (`z-[100]`) so the panel is reachable when the editor is
 * opened from inside the clinical documents modal.
 */
export const FORMATTING_PANEL_Z_INDEX = 120;

// ---------------------------------------------------------------------------
// Shared button styles
// ---------------------------------------------------------------------------

export const iconBtn =
  'inline-flex h-7 w-7 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300';

export const defaultIconBtn = `${iconBtn} border-slate-200 text-slate-600 hover:bg-slate-50`;

// ---------------------------------------------------------------------------
// Formatting sub-panel actions
// ---------------------------------------------------------------------------

type ToolbarAction = {
  command: ClinicalDocumentFormattingCommand;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
};

export const textFormattingActions: ToolbarAction[] = [
  { command: 'bold', label: 'Negrita', icon: Bold },
  { command: 'italic', label: 'Cursiva', icon: Italic },
  { command: 'underline', label: 'Subrayado', icon: Underline },
  { command: 'removeFormat', label: 'Quitar formato', icon: Eraser },
];

export const listFormattingActions: ToolbarAction[] = [
  { command: 'insertUnorderedList', label: 'Viñetas', icon: List },
  { command: 'insertOrderedList', label: 'Lista numerada', icon: ListOrdered },
  { command: 'indent', label: 'Aumentar sangría', icon: IndentIncrease },
  { command: 'outdent', label: 'Disminuir sangría', icon: IndentDecrease },
];

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

export const ToolbarCluster: React.FC<{
  label: string;
  children: React.ReactNode;
}> = ({ label, children }) => (
  <div className="clinical-document-toolbar-cluster" role="group" aria-label={label}>
    <span className="clinical-document-toolbar-cluster-label">{label}</span>
    <div className="flex items-center gap-1">{children}</div>
  </div>
);

export const renderToolbarButtons = (
  actions: ToolbarAction[],
  onApplyFormatting: (command: ClinicalDocumentFormattingCommand) => void,
  formattingDisabled: boolean
) =>
  actions.map(action => {
    const Icon = action.icon;
    return (
      <button
        key={action.command}
        type="button"
        className="clinical-document-toolbar-button"
        onMouseDown={event => event.preventDefault()}
        onClick={() => onApplyFormatting(action.command)}
        disabled={formattingDisabled}
        aria-label={action.label}
        title={action.label}
      >
        <Icon size={FORMATTING_ICON_SIZE} />
      </button>
    );
  });
