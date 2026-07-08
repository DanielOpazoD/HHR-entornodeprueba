import React from 'react';
import { EllipsisVertical, FileDown, FileUp, X } from 'lucide-react';

interface ClinicalDocumentIndicationsPanelHeaderProps {
  canEdit: boolean;
  isSavingCustomIndication: boolean;
  isTransferMenuOpen: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onToggleTransferMenu: () => void;
  onExportCatalog: () => void;
  onImportFile: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onClose: () => void;
}

export const ClinicalDocumentIndicationsPanelHeader: React.FC<
  ClinicalDocumentIndicationsPanelHeaderProps
> = ({
  canEdit,
  isSavingCustomIndication,
  isTransferMenuOpen,
  fileInputRef,
  onToggleTransferMenu,
  onExportCatalog,
  onImportFile,
  onClose,
}) => (
  <div className="clinical-document-indications-panel-header">
    <div>
      <p className="clinical-document-indications-panel-eyebrow">
        Lista personal sincronizada con Firebase
      </p>
      <h3 className="clinical-document-indications-panel-title">Mis indicaciones</h3>
    </div>
    <div className="clinical-document-indications-panel-header-actions">
      <div className="clinical-document-indications-transfer-menu-wrap">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="clinical-document-indications-hidden-input"
          onChange={event => void onImportFile(event)}
        />
        <button
          type="button"
          className="clinical-document-inline-action"
          onMouseDown={event => event.preventDefault()}
          onClick={onToggleTransferMenu}
          aria-label="Importar o exportar mis indicaciones"
          title="Importar o exportar"
        >
          <EllipsisVertical size={12} />
        </button>
        {isTransferMenuOpen && (
          <div className="clinical-document-indications-transfer-menu">
            <button
              type="button"
              className="clinical-document-indications-transfer-option"
              onClick={onExportCatalog}
            >
              <FileDown size={12} />
              Exportar archivo
            </button>
            <button
              type="button"
              className="clinical-document-indications-transfer-option"
              onClick={() => fileInputRef.current?.click()}
              disabled={!canEdit || isSavingCustomIndication}
            >
              <FileUp size={12} />
              Importar archivo
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        className="clinical-document-inline-action"
        onMouseDown={event => event.preventDefault()}
        onClick={onClose}
        aria-label="Cerrar panel de indicaciones"
        title="Cerrar panel"
      >
        <X size={12} />
      </button>
    </div>
  </div>
);
