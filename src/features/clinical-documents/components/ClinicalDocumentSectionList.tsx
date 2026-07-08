import React, { lazy, Suspense } from 'react';
import type { DragEvent } from 'react';
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
import type { ClinicalDocumentIeehDraft } from '@/features/clinical-documents/domain/entities';

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
  ClinicalDocumentSheetEditorApi,
  ClinicalDocumentSheetProps,
} from '@/features/clinical-documents/components/clinicalDocumentSheetShared';
import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';
import type { ClinicalDocumentPlanSubsectionId } from '@/features/clinical-documents/controllers/clinicalDocumentPlanSectionController';
import type { ClinicalDocumentIndicationSpecialtyId } from '@/features/clinical-documents/controllers/clinicalDocumentIndicationsController';

interface ClinicalDocumentSectionListProps {
  document: ClinicalDocumentRecord;
  visibleSections: ClinicalDocumentRecord['sections'];
  canEdit: boolean;
  activeTitleTarget: string | null;
  activeEditorSectionId: string | null;
  draggedSectionId: string | null;
  dragOverSectionId: string | null;
  activePlanSubsectionId: ClinicalDocumentPlanSubsectionId;
  activeIndicationsSpecialtyId: ClinicalDocumentIndicationSpecialtyId;
  isIndicationsPanelOpen: boolean;
  indicationsCatalog: ClinicalDocumentSheetProps['indicationsCatalog'];
  isSavingCustomIndication: boolean;
  customIndicationError: string | null;
  onSetActiveTitleTarget: React.Dispatch<React.SetStateAction<string | null>>;
  onPatchSectionTitle: (sectionId: string, title: string) => void;
  onPatchSection: (sectionId: string, content: string) => void;
  onSetSectionLayout: ClinicalDocumentSheetProps['setSectionLayout'];
  onSetSectionVisibility: (sectionId: string, visible: boolean) => void;
  onMoveSection: (sectionId: string, direction: 'up' | 'down') => void;
  onReorderSection: (sourceSectionId: string, targetSectionId: string) => void;
  onAddSection: (referenceSectionId: string, position: 'above' | 'below') => void;
  onEditorActivate: (activeSectionId: string, editorApi: ClinicalDocumentSheetEditorApi) => void;
  onEditorDeactivate: (sectionId: string) => void;
  onUploadPastedImage: ClinicalDocumentSheetProps['onUploadPastedImage'];
  onImagePasteRejected: (message: string) => void;
  onPatchIeehDraft: (draft: ClinicalDocumentIeehDraft) => void;
  onClearIeehDraft: () => void;
  /** Workspace patient data (provides birthDate for IEEH printing). */
  workspacePatient?: { birthDate?: string };
  onSetActivePlanSubsectionId: (subsectionId: ClinicalDocumentPlanSubsectionId) => void;
  onSetActiveIndicationsSpecialtyId: (specialtyId: ClinicalDocumentIndicationSpecialtyId) => void;
  onToggleIndicationsPanel: () => void;
  onCreateIndicationsTab: ClinicalDocumentSheetProps['createIndicationsTab'];
  onRenameIndicationsTab: ClinicalDocumentSheetProps['renameIndicationsTab'];
  onDeleteIndicationsTab: ClinicalDocumentSheetProps['deleteIndicationsTab'];
  onReorderIndicationsTab: ClinicalDocumentSheetProps['reorderIndicationsTab'];
  onAddCustomIndication: ClinicalDocumentSheetProps['addCustomIndication'];
  onUpdateIndication: ClinicalDocumentSheetProps['updateIndication'];
  onDeleteIndication: ClinicalDocumentSheetProps['deleteIndication'];
  onImportIndicationsCatalog: ClinicalDocumentSheetProps['importIndicationsCatalog'];
  onPatchUpdateDate?: (sectionId: string, date: string) => void;
  onPatchUpdateTime?: (sectionId: string, time: string) => void;
  dragHandlers: {
    onDragStart: (event: DragEvent<HTMLButtonElement>, sectionId: string) => void;
    onDragOver: (event: DragEvent<HTMLElement>, sectionId: string, canInteract: boolean) => void;
    onDragLeave: (sectionId: string) => void;
    onDragEnd: () => void;
  };
}

export const ClinicalDocumentSectionList: React.FC<ClinicalDocumentSectionListProps> = ({
  document,
  visibleSections,
  canEdit,
  activeTitleTarget,
  activeEditorSectionId,
  draggedSectionId,
  dragOverSectionId,
  activePlanSubsectionId,
  activeIndicationsSpecialtyId,
  isIndicationsPanelOpen,
  indicationsCatalog,
  isSavingCustomIndication,
  customIndicationError,
  onSetActiveTitleTarget,
  onPatchSectionTitle,
  onPatchSection,
  onSetSectionLayout,
  onSetSectionVisibility,
  onMoveSection,
  onReorderSection,
  onAddSection,
  onEditorActivate,
  onEditorDeactivate,
  onUploadPastedImage,
  onImagePasteRejected,
  onPatchIeehDraft,
  onClearIeehDraft,
  workspacePatient,
  onSetActivePlanSubsectionId,
  onSetActiveIndicationsSpecialtyId,
  onToggleIndicationsPanel,
  onCreateIndicationsTab,
  onRenameIndicationsTab,
  onDeleteIndicationsTab,
  onReorderIndicationsTab,
  onAddCustomIndication,
  onUpdateIndication,
  onDeleteIndication,
  onImportIndicationsCatalog,
  onPatchUpdateDate,
  onPatchUpdateTime,
  dragHandlers,
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
              dragOverSectionId === section.id ? ' is-drag-over' : ''
            }${activeTitleTarget === `section:${section.id}` ? ' is-title-active' : ''}${
              activeEditorSectionId === section.id ? ' is-editor-active' : ''
            }`}
            onDragOver={event =>
              dragHandlers.onDragOver(event, section.id, canEdit && !document.isLocked)
            }
            onDragLeave={() => dragHandlers.onDragLeave(section.id)}
            onDrop={event => {
              if (!canEdit || document.isLocked) return;
              event.preventDefault();
              const sourceSectionId = event.dataTransfer.getData('text/plain') || draggedSectionId;
              if (sourceSectionId && sourceSectionId !== section.id) {
                onReorderSection(sourceSectionId, section.id);
              }
              dragHandlers.onDragEnd();
            }}
          >
            {/* Drag handle removed — sections are reordered via arrow buttons */}
            <div className="clinical-document-section-layout">
              <div className="clinical-document-section-main">
                <div className="clinical-document-field-label-row clinical-document-section-header-row relative">
                  <InlineEditableTitle
                    value={section.title}
                    onChange={title => onPatchSectionTitle(section.id, title)}
                    onActivate={() => onSetActiveTitleTarget(`section:${section.id}`)}
                    onDeactivate={() =>
                      onSetActiveTitleTarget(current =>
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
                      onPatchDate={onPatchUpdateDate}
                      onPatchTime={onPatchUpdateTime}
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
                          onSetSectionLayout(section.id, nextLayout);
                          onPatchSection(
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
                        isOpen={isIndicationsPanelOpen}
                        canEdit={canEdit && !document.isLocked}
                        catalog={indicationsCatalog}
                        isSavingCustomIndication={isSavingCustomIndication}
                        customIndicationError={customIndicationError}
                        onToggle={onToggleIndicationsPanel}
                        onInsertIndication={text =>
                          onPatchSection(
                            section.id,
                            planLayout === 'unified'
                              ? appendClinicalDocumentUnifiedPlanText(section.content, text)
                              : appendClinicalDocumentPlanSubsectionText(
                                  section.content,
                                  activePlanSubsectionId,
                                  text
                                )
                          )
                        }
                        onCreateTab={onCreateIndicationsTab}
                        onRenameTab={onRenameIndicationsTab}
                        onDeleteTab={onDeleteIndicationsTab}
                        onAddCustomIndication={onAddCustomIndication}
                        onUpdateIndication={onUpdateIndication}
                        onDeleteIndication={onDeleteIndication}
                        onImportCatalog={onImportIndicationsCatalog}
                      />
                    )}
                  {canEdit &&
                    !document.isLocked &&
                    activeTitleTarget === `section:${section.id}` && (
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
                                onAddSection(section.id, 'above');
                                setInsertMenuSectionId(null);
                              }}
                            >
                              <ChevronUp size={12} /> Insertar arriba
                            </button>
                            <button
                              type="button"
                              className="w-full px-3 py-1.5 text-left text-[11px] font-medium text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                              onClick={() => {
                                onAddSection(section.id, 'below');
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
                            onMoveSection(section.id, 'up');
                            // Keep title active after move so buttons remain visible
                            onSetActiveTitleTarget(`section:${section.id}`);
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
                            onMoveSection(section.id, 'down');
                            // Keep title active after move so buttons remain visible
                            onSetActiveTitleTarget(`section:${section.id}`);
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
                          onClick={() => onSetSectionVisibility(section.id, false)}
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
                  activePlanSubsectionId,
                  setActivePlanSubsectionId: onSetActivePlanSubsectionId,
                  onPatchSection,
                  onEditorActivate,
                  onEditorDeactivate,
                  onUploadPastedImage,
                  onImagePasteRejected,
                  indicationsCatalog,
                  isSavingCustomIndication,
                  customIndicationError,
                  activeIndicationsSpecialtyId,
                  setActiveIndicationsSpecialtyId: onSetActiveIndicationsSpecialtyId,
                  isIndicationsPanelOpen,
                  onToggleIndicationsPanel,
                  createIndicationsTab: onCreateIndicationsTab,
                  renameIndicationsTab: onRenameIndicationsTab,
                  deleteIndicationsTab: onDeleteIndicationsTab,
                  reorderIndicationsTab: onReorderIndicationsTab,
                  addCustomIndication: onAddCustomIndication,
                  updateIndication: onUpdateIndication,
                  deleteIndication: onDeleteIndication,
                  importIndicationsCatalog: onImportIndicationsCatalog,
                })}

                {/* IEEH panel: only for epicrisis, below "diagnósticos" section */}
                {section.id === 'diagnosticos' && document.documentType === 'epicrisis' && (
                  <Suspense fallback={null}>
                    <ClinicalDocumentIeehPanel
                      document={document}
                      workspacePatient={workspacePatient}
                      draft={document.ieehDraft}
                      canEdit={canEdit && !document.isLocked}
                      onPatchDraft={onPatchIeehDraft}
                      onClearDraft={onClearIeehDraft}
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
