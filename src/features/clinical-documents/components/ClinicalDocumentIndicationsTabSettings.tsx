import React from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';

import type { ClinicalDocumentIndicationCatalogTab } from '@/features/clinical-documents/services/clinicalDocumentIndicationsCatalogService';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntime';

interface ClinicalDocumentIndicationsTabSettingsProps {
  tabs: ClinicalDocumentIndicationCatalogTab[];
  canEdit: boolean;
  isSavingCustomIndication: boolean;
  newTabLabel: string;
  editingTabId: string | null;
  editingTabLabel: string;
  onChangeNewTabLabel: (value: string) => void;
  onCreateTab: () => void;
  onStartEditingTab: (tab: ClinicalDocumentIndicationCatalogTab) => void;
  onChangeEditingTabLabel: (value: string) => void;
  onSaveTab: (tabId: string) => void;
  onCancelEditingTab: () => void;
  onDeleteTab: (tabId: string) => void;
}

export const ClinicalDocumentIndicationsTabSettings: React.FC<
  ClinicalDocumentIndicationsTabSettingsProps
> = ({
  tabs,
  canEdit,
  isSavingCustomIndication,
  newTabLabel,
  editingTabId,
  editingTabLabel,
  onChangeNewTabLabel,
  onCreateTab,
  onStartEditingTab,
  onChangeEditingTabLabel,
  onSaveTab,
  onCancelEditingTab,
  onDeleteTab,
}) => {
  const handleDeleteTab = (tab: ClinicalDocumentIndicationCatalogTab) => {
    const confirmed = defaultBrowserWindowRuntime.confirm(
      `¿Eliminar la pestaña "${tab.label}" y sus indicaciones guardadas? Esta acción no se puede deshacer.`
    );
    if (!confirmed) {
      return;
    }

    onDeleteTab(tab.id);
  };

  return (
    <div className="clinical-document-indications-tab-settings">
      <div className="clinical-document-indications-tab-form">
        <label
          className="clinical-document-indications-form-label"
          htmlFor="clinical-document-new-indication-tab"
        >
          Nueva pestaña de indicaciones
        </label>
        <div className="clinical-document-indications-tab-form-row">
          <input
            id="clinical-document-new-indication-tab"
            value={newTabLabel}
            onChange={event => onChangeNewTabLabel(event.target.value)}
            className="clinical-document-indications-tab-input"
            disabled={!canEdit || isSavingCustomIndication}
          />
          <button
            type="button"
            className="clinical-document-inline-action"
            onClick={onCreateTab}
            disabled={!canEdit || isSavingCustomIndication || !newTabLabel.trim()}
            aria-label="Crear pestaña de indicaciones"
            title="Crear pestaña"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>
      <div className="clinical-document-indications-tab-settings-list">
        {tabs.map(tab => {
          const isEditingTab = editingTabId === tab.id;
          return (
            <div key={tab.id} className="clinical-document-indications-tab-settings-row">
              {isEditingTab ? (
                <input
                  value={editingTabLabel}
                  onChange={event => onChangeEditingTabLabel(event.target.value)}
                  className="clinical-document-indications-tab-input"
                  disabled={!canEdit || isSavingCustomIndication}
                />
              ) : (
                <span className="clinical-document-indications-tab-settings-name">{tab.label}</span>
              )}
              <div className="clinical-document-indications-tab-actions">
                {isEditingTab ? (
                  <>
                    <button
                      type="button"
                      className="clinical-document-inline-action clinical-document-inline-action--compact"
                      onClick={() => onSaveTab(tab.id)}
                      disabled={!canEdit || isSavingCustomIndication || !editingTabLabel.trim()}
                      aria-label={`Guardar nombre de pestaña ${tab.label}`}
                      title="Guardar"
                    >
                      <Check size={10} />
                    </button>
                    <button
                      type="button"
                      className="clinical-document-inline-action clinical-document-inline-action--compact"
                      onClick={onCancelEditingTab}
                      aria-label={`Cancelar edición de pestaña ${tab.label}`}
                      title="Cancelar"
                    >
                      <X size={10} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="clinical-document-inline-action clinical-document-inline-action--compact"
                      onClick={() => onStartEditingTab(tab)}
                      disabled={!canEdit || isSavingCustomIndication}
                      aria-label={`Renombrar pestaña ${tab.label}`}
                      title="Renombrar"
                    >
                      <Pencil size={10} />
                    </button>
                    <button
                      type="button"
                      className="clinical-document-inline-action clinical-document-inline-action--compact clinical-document-inline-action--danger"
                      onClick={() => handleDeleteTab(tab)}
                      disabled={!canEdit || isSavingCustomIndication || tabs.length <= 1}
                      aria-label={`Eliminar pestaña ${tab.label}`}
                      title="Eliminar pestaña"
                    >
                      <Trash2 size={10} />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
