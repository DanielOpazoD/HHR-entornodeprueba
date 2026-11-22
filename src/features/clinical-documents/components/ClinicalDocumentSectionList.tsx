import React, { lazy, Suspense } from 'react';
import {
  AlignJustify,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
} from 'lucide-react';

import { ClinicalDocumentIndicationsPanel } from '@/features/clinical-documents/components/ClinicalDocumentIndicationsPanel';

const ClinicalDocumentIeehPanel = lazy(() =>
  import('@/features/clinical-documents/components/ClinicalDocumentIeehPanel').then(m => ({
    default: m.ClinicalDocumentIeehPanel,
  }))
);
import { ClinicalUpdateDateTimeHeader } from '@/features/clinical-documents/components/ClinicalUpdateDateTimeHeader';
import { InlineEditableTitle } from '@/features/clinical-documents/components/InlineEditableTitle';
import { renderClinicalDocumentSectionContent } from '@/features/clinical-documents/components/clinicalDocumentSectionRendererRegistry';
import {
  appendClinicalDocumentPlanSubsectionText,
  appendClinicalDocumentUnifiedPlanText,
  buildStructuredClinicalDocumentPlanSectionContent,
  buildUnifiedClinicalDocumentPlanSectionContent,
  resolveClinicalDocumentPlanSectionLayout,
} from '@/features/clinical-documents/controllers/clinicalDocumentPlanSectionController';
import type {
  ClinicalDocumentSheetEditorState,
  ClinicalDocumentSheetIeehBinding,
  ClinicalDocumentSheetIndicationsBinding,
  ClinicalDocumentSheetSectionActions,
} from '@/features/clinical-documents/components/clinicalDocumentSheetShared';
import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';

interface ClinicalDocumentSectionListProps {
  document: ClinicalDocumentRecord;
  visibleSections: ClinicalDocumentRecord['sections'];
  canEdit: boolean;
  sectionActions: ClinicalDocumentSheetSectionActions;
  editorState: ClinicalDocumentSheetEditorState;
  indications: ClinicalDocumentSheetIndicationsBinding;
  ieeh: ClinicalDocumentSheetIeehBinding;
}

export const ClinicalDocumentSectionList: React.FC<ClinicalDocumentSectionListProps> = ({
  document,
  visibleSections,
  canEdit,
  sectionActions,
  editorState,
  indications,
  ieeh,
}) => {
  const [insertMenuSectionId, setInsertMenuSectionId] = React.useState<string | null>(null);

  return (
    <div className="space-y-3">
      {visibleSections.map(section => {
        const planLayout = resolveClinicalDocumentPlanSectionLayout(section);

        return (
          <div
            key={section.id}
            data-clinical-section-id={section.id}
            className={`block clinical-document-section-block${
              editorState.dragOverSectionId === section.id ? ' is-drag-over' : ''
            }${editorState.activeTitleTarget === `section:${section.id}` ? ' is-title-active' : ''}${
              editorState.activeEditorSectionId === section.id ? ' is-editor-active' : ''
            }`}
            onDragOver={event =>
              editorState.dragHandlers.onDragOver(event, section.id, canEdit && !document.isLocked)
            }
            onDragLeave={() => editorState.dragHandlers.onDragLeave(section.id)}
            onDrop={event => {
              if (!canEdit || document.isLocked) return;
              event.preventDefault();
              const sourceSectionId =
                event.dataTransfer.getData('text/plain') || editorState.draggedSectionId;
              if (sourceSectionId && sourceSectionId !== section.id) {
                sectionActions.reorderSection(sourceSectionId, section.id);
              }
              editorState.dragHandlers.onDragEnd();
            }}
          >
            {/* Drag handle removed — sections are reordered via arrow buttons */}
            <div className="clinical-document-section-layout">
              <div className="clinical-document-section-main">
                <div className="clinical-document-field-label-row clinical-document-section-header-row relative">
                  <InlineEditableTitle
                    value={section.title}
                    onChange={title => sectionActions.patchSectionTitle(section.id, title)}
                    onActivate={() => editorState.onSetActiveTitleTarget(`section:${section.id}`)}
                    onDeactivate={() =>
                      editorState.onSetActiveTitleTarget(current =>
                        current === `section:${section.id}` ? null : current
                      )
                    }
                    disabled={!canEdit || document.isLocked}
                    className="clinical-document-section-title"
                  />
                  {/* Date/time for clinical update sections */}
                  {section.kind === 'clinical-update' && (
                    <ClinicalUpdateDateTimeHeader
                      sectionId={section.id}
                      date={section.updateDate}
                      time={section.updateTime}
                      canEdit={canEdit && !document.isLocked}
                      onPatchDate={sectionActions.patchUpdateDate}
                      onPatchTime={sectionActions.patchUpdateTime}
                    />
                  )}
                  {document.documentType === 'epicrisis' &&
                    section.id === 'plan' &&
                    canEdit &&
                    !document.isLocked && (
                      <button
                        type="button"
                        className="clinical-document-inline-action"
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => {
                          const nextLayout = planLayout === 'unified' ? 'structured' : 'unified';
                          sectionActions.setSectionLayout(section.id, nextLayout);
                          sectionActions.patchSection(
                            section.id,
                            nextLayout === 'unified'
                              ? buildUnifiedClinicalDocumentPlanSectionContent(section.content)
                              : buildStructuredClinicalDocumentPlanSectionContent(section.content)
                          );
                        }}
                        aria-label={
                          planLayout === 'unified'
                            ? 'Volver a indicaciones al alta estructuradas'
                            : 'Simplificar indicaciones al alta'
                        }
                        title={
                          planLayout === 'unified'
                            ? 'Volver a indicaciones estructuradas'
                            : 'Simplificar indicaciones'
                        }
                      >
                        <AlignJustify size={12} />
                      </button>
                    )}
                  {document.documentType === 'epicrisis' &&
                    section.id === 'plan' &&
                    !document.isLocked && (
                      <ClinicalDocumentIndicationsPanel
                        isOpen={indications.isPanelOpen}
                        canEdit={canEdit && !document.isLocked}
                        catalog={indications.catalog}
                        isSavingCustomIndication={indications.isSavingCustomIndication}
                        customIndicationError={indications.customIndicationError}
                        onToggle={indications.onTogglePanel}
                        onInsertIndication={text =>
                          sectionActions.patchSection(
                            section.id,
                            planLayout === 'unified'
                              ? appendClinicalDocumentUnifiedPlanText(section.content, text)
                              : appendClinicalDocumentPlanSubsectionText(
                                  section.content,
                                  editorState.activePlanSubsectionId,
                                  text
                                )
                          )
                        }
                        onCreateTab={indications.onCreateTab}
                        onRenameTab={indications.onRenameTab}
                        onDeleteTab={indications.onDeleteTab}
                        onAddCustomIndication={indications.onAddCustomIndication}
                        onUpdateIndication={indications.onUpdateIndication}
                        onDeleteIndication={indications.onDeleteIndication}
                        onImportCatalog={indications.onImportCatalog}
                      />
                    )}
                  {canEdit &&
                    !document.isLocked &&
                    editorState.activeTitleTarget === `section:${section.id}` && (
                      <>
                        <button
                          type="button"
                          className="clinical-document-inline-action"
                          onMouseDown={event => event.preventDefault()}
                          onClick={() =>
                            setInsertMenuSectionId(
                              insertMenuSectionId === section.id ? null : section.id
                            )
                          }
                          aria-label="Insertar sección"
                          title="Insertar sección"
                        >
                          <Plus size={12} />
                        </button>
                        {insertMenuSectionId === section.id && (
                          <div
                            className="absolute top-full left-0 mt-1 z-50 bg-white rounded-lg shadow-xl border border-slate-200 ring-1 ring-black/[0.04] py-1 min-w-[160px]"
                            onMouseDown={event => event.preventDefault()}
                          >
                            <button
                              type="button"
                              className="w-full px-3 py-1.5 text-left text-[11px] font-medium text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                              onClick={() => {
                                sectionActions.addSection(section.id, 'above');
                                setInsertMenuSectionId(null);
                              }}
                            >
                              <ChevronUp size={12} /> Insertar arriba
                            </button>
                            <button
                              type="button"
                              className="w-full px-3 py-1.5 text-left text-[11px] font-medium text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                              onClick={() => {
                                sectionActions.addSection(section.id, 'below');
                                setInsertMenuSectionId(null);
                              }}
                            >
                              <ChevronDown size={12} /> Insertar abajo
                            </button>
                          </div>
                        )}
                        <button
                          type="button"
                          className="clinical-document-inline-action"
                          onMouseDown={event => event.preventDefault()}
                          onClick={() => {
                            sectionActions.moveSection(section.id, 'up');
                            // Keep title active after move so buttons remain visible
                            editorState.onSetActiveTitleTarget(`section:${section.id}`);
                          }}
                          aria-label={`Subir sección ${section.title}`}
                          title="Subir sección"
                          disabled={visibleSections[0]?.id === section.id}
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          type="button"
                          className="clinical-document-inline-action"
                          onMouseDown={event => event.preventDefault()}
                          onClick={() => {
                            sectionActions.moveSection(section.id, 'down');
                            // Keep title active after move so buttons remain visible
                            editorState.onSetActiveTitleTarget(`section:${section.id}`);
                          }}
                          aria-label={`Bajar sección ${section.title}`}
                          title="Bajar sección"
                          disabled={visibleSections[visibleSections.length - 1]?.id === section.id}
                        >
                          <ArrowDown size={12} />
                        </button>
                        <button
                          type="button"
                          className="clinical-document-inline-action clinical-document-inline-action--danger"
                          onMouseDown={event => event.preventDefault()}
                          onClick={() => sectionActions.setSectionVisibility(section.id, false)}
                          aria-label={`Eliminar sección ${section.title}`}
                          title="Eliminar sección"
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                </div>
                {renderClinicalDocumentSectionContent({
                  document,
                  section,
                  canEdit,
                  setActivePlanSubsectionId: editorState.onSetActivePlanSubsectionId,
                  onPatchSection: sectionActions.patchSection,
                  onEditorActivate: editorState.onEditorActivate,
                  onEditorDeactivate: editorState.onEditorDeactivate,
                  onUploadPastedImage: editorState.onUploadPastedImage,
                  onImagePasteRejected: editorState.onImagePasteRejected,
                })}

                {/* IEEH panel: only for epicrisis, below "diagnósticos" section */}
                {section.id === 'diagnosticos' && document.documentType === 'epicrisis' && (
                  <Suspense fallback={null}>
                    <ClinicalDocumentIeehPanel
                      document={document}
                      workspacePatient={ieeh.workspacePatient}
                      draft={document.ieehDraft}
                      canEdit={canEdit && !document.isLocked}
                      onPatchDraft={ieeh.onPatchDraft}
                      onClearDraft={ieeh.onClearDraft}
                    />
                  </Suspense>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
