import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Settings } from 'lucide-react';

import type {
  ClinicalDocumentIndicationCatalogItem,
  ClinicalDocumentIndicationCatalogTab,
  ClinicalDocumentIndicationsCatalog,
} from '@/features/clinical-documents/services/clinicalDocumentIndicationsCatalogService';
import { ClinicalDocumentIndicationsPanelHeader } from '@/features/clinical-documents/components/ClinicalDocumentIndicationsPanelHeader';
import { ClinicalDocumentIndicationsItems } from '@/features/clinical-documents/components/ClinicalDocumentIndicationsItems';
import { ClinicalDocumentIndicationsTabSettings } from '@/features/clinical-documents/components/ClinicalDocumentIndicationsTabSettings';

interface ClinicalDocumentIndicationsPanelProps {
  isOpen: boolean;
  canEdit: boolean;
  catalog: ClinicalDocumentIndicationsCatalog;
  isSavingCustomIndication: boolean;
  customIndicationError: string | null;
  onToggle: () => void;
  onInsertIndication: (text: string) => void;
  onCreateTab: (label: string) => Promise<boolean>;
  onRenameTab: (tabId: string, label: string) => Promise<boolean>;
  onDeleteTab: (tabId: string) => Promise<boolean>;
  onAddCustomIndication: (tabId: string, text: string) => Promise<boolean>;
  onUpdateIndication: (tabId: string, itemId: string, text: string) => Promise<boolean>;
  onDeleteIndication: (tabId: string, itemId: string) => Promise<boolean>;
  onImportCatalog: (catalog: unknown) => Promise<boolean>;
}

export const ClinicalDocumentIndicationsPanel: React.FC<ClinicalDocumentIndicationsPanelProps> = ({
  isOpen,
  canEdit,
  catalog,
  isSavingCustomIndication,
  customIndicationError,
  onToggle,
  onInsertIndication,
  onCreateTab,
  onRenameTab,
  onDeleteTab,
  onAddCustomIndication,
  onUpdateIndication,
  onDeleteIndication,
  onImportCatalog,
}) => {
  const [customText, setCustomText] = useState('');
  const [newTabLabel, setNewTabLabel] = useState('');
  const [isAddingIndication, setIsAddingIndication] = useState(false);
  const [isTabSettingsOpen, setIsTabSettingsOpen] = useState(false);
  const [activeTabId, setActiveTabId] = useState(catalog.activeTabId);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabLabel, setEditingTabLabel] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [isTransferMenuOpen, setIsTransferMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeTab =
    catalog.tabs.find(tab => tab.id === activeTabId) ||
    catalog.tabs.find(tab => tab.id === catalog.activeTabId) ||
    catalog.tabs[0];
  const resolvedActiveTabId = activeTab?.id || 'general';

  useEffect(() => {
    setActiveTabId(catalog.activeTabId);
  }, [catalog.activeTabId]);

  const handleAddCustomIndication = async () => {
    const wasSaved = await onAddCustomIndication(resolvedActiveTabId, customText);
    if (wasSaved) {
      setCustomText('');
      setIsAddingIndication(false);
    }
  };

  const handleCreateTab = async () => {
    const wasSaved = await onCreateTab(newTabLabel);
    if (wasSaved) {
      setNewTabLabel('');
    }
  };

  const handleStartEditingTab = (tab: ClinicalDocumentIndicationCatalogTab) => {
    setEditingTabId(tab.id);
    setEditingTabLabel(tab.label);
  };

  const handleSaveTab = async (tabId: string) => {
    const wasSaved = await onRenameTab(tabId, editingTabLabel);
    if (wasSaved) {
      setEditingTabId(null);
      setEditingTabLabel('');
    }
  };

  const handleStartEditing = (item: ClinicalDocumentIndicationCatalogItem) => {
    setEditingItemId(item.id);
    setEditingText(item.text);
  };

  const handleSaveEdit = async (itemId: string) => {
    const wasSaved = await onUpdateIndication(resolvedActiveTabId, itemId, editingText);
    if (wasSaved) {
      setEditingItemId(null);
      setEditingText('');
    }
  };

  const handleExportCatalog = () => {
    const blob = new Blob([JSON.stringify(catalog, null, 2)], { type: 'application/json' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = 'mis-indicaciones-predeterminadas-clinicas.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
    setIsTransferMenuOpen(false);
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const content = await file.text();
      const parsed = JSON.parse(content);
      await onImportCatalog(parsed);
    } catch {
      // The hook surfaces the error as panel feedback.
    } finally {
      event.target.value = '';
      setIsTransferMenuOpen(false);
    }
  };

  const panel = isOpen ? (
    <div className="clinical-document-indications-portal-layer" aria-hidden={false}>
      <div className="clinical-document-indications-backdrop" onClick={onToggle} />
      <aside className="clinical-document-indications-panel" aria-label="Panel de indicaciones">
        <ClinicalDocumentIndicationsPanelHeader
          canEdit={canEdit}
          isSavingCustomIndication={isSavingCustomIndication}
          isTransferMenuOpen={isTransferMenuOpen}
          fileInputRef={fileInputRef}
          onToggleTransferMenu={() => setIsTransferMenuOpen(current => !current)}
          onExportCatalog={handleExportCatalog}
          onImportFile={handleImportFile}
          onClose={onToggle}
        />

        <div className="clinical-document-indications-personal-tabs">
          <div
            className="clinical-document-indications-specialties"
            role="tablist"
            aria-label="Pestañas personales de indicaciones"
          >
            {catalog.tabs.map(tab => {
              const isActive = tab.id === resolvedActiveTabId;

              return (
                <div key={tab.id} className="clinical-document-indications-tab-shell">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`clinical-document-indications-specialty-tab${
                      isActive ? ' is-active' : ''
                    }`}
                    onClick={() => {
                      setActiveTabId(tab.id);
                      setEditingItemId(null);
                      setEditingText('');
                    }}
                  >
                    <span>{tab.label}</span>
                    <span className="clinical-document-indications-specialty-count">
                      {tab.items.length}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          <div className="clinical-document-indications-panel-actions">
            <button
              type="button"
              className="clinical-document-indications-secondary-button"
              onClick={() => {
                setIsAddingIndication(current => !current);
                setIsTabSettingsOpen(false);
              }}
              disabled={!canEdit || isSavingCustomIndication}
              aria-label="Agregar nueva indicación"
            >
              <Plus size={12} />
              Nueva indicación
            </button>
            <button
              type="button"
              className="clinical-document-indications-secondary-button clinical-document-indications-secondary-button--icon"
              onClick={() => {
                setIsTabSettingsOpen(current => !current);
                setIsAddingIndication(false);
              }}
              disabled={!canEdit || isSavingCustomIndication}
              aria-label="Configurar pestañas"
              title="Configurar pestañas"
            >
              <Settings size={12} />
            </button>
          </div>

          {isTabSettingsOpen && (
            <ClinicalDocumentIndicationsTabSettings
              tabs={catalog.tabs}
              canEdit={canEdit}
              isSavingCustomIndication={isSavingCustomIndication}
              newTabLabel={newTabLabel}
              editingTabId={editingTabId}
              editingTabLabel={editingTabLabel}
              onChangeNewTabLabel={setNewTabLabel}
              onCreateTab={() => void handleCreateTab()}
              onStartEditingTab={handleStartEditingTab}
              onChangeEditingTabLabel={setEditingTabLabel}
              onSaveTab={tabId => void handleSaveTab(tabId)}
              onCancelEditingTab={() => {
                setEditingTabId(null);
                setEditingTabLabel('');
              }}
              onDeleteTab={tabId => void onDeleteTab(tabId)}
            />
          )}

          {isAddingIndication && (
            <div className="clinical-document-indications-form">
              <label
                className="clinical-document-indications-form-label"
                htmlFor="clinical-document-custom-indication"
              >
                Agregar propia
              </label>
              <textarea
                id="clinical-document-custom-indication"
                value={customText}
                onChange={event => setCustomText(event.target.value)}
                rows={3}
                placeholder="Nueva indicación para mi lista"
                className="clinical-document-indications-input"
                disabled={!canEdit || isSavingCustomIndication}
              />
              <button
                type="button"
                className="clinical-document-indications-add-button"
                onClick={() => void handleAddCustomIndication()}
                disabled={!canEdit || isSavingCustomIndication || !customText.trim()}
              >
                <Plus size={14} />
                Agregar+
              </button>
              {customIndicationError && (
                <p className="clinical-document-indications-error">{customIndicationError}</p>
              )}
            </div>
          )}
        </div>

        <ClinicalDocumentIndicationsItems
          items={activeTab?.items || []}
          canEdit={canEdit}
          isSavingCustomIndication={isSavingCustomIndication}
          editingItemId={editingItemId}
          editingText={editingText}
          onChangeEditingText={setEditingText}
          onInsertIndication={onInsertIndication}
          onStartEditing={handleStartEditing}
          onSaveEdit={itemId => void handleSaveEdit(itemId)}
          onCancelEdit={() => {
            setEditingItemId(null);
            setEditingText('');
          }}
          onDeleteIndication={itemId => void onDeleteIndication(resolvedActiveTabId, itemId)}
        />
      </aside>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        className={`clinical-document-inline-action clinical-document-inline-action--panel-toggle clinical-document-inline-action--panel-emoji${
          isOpen ? ' is-open' : ''
        }`}
        onMouseDown={event => event.preventDefault()}
        onClick={onToggle}
        aria-label={
          isOpen
            ? 'Cerrar panel de indicaciones predeterminadas'
            : 'Abrir panel de indicaciones predeterminadas'
        }
        title="Indicaciones predeterminadas"
      >
        <span aria-hidden="true">📋</span>
      </button>

      {panel && typeof document !== 'undefined' ? createPortal(panel, document.body) : panel}
    </>
  );
};
