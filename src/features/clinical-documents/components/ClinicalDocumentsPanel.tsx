import type { ClinicalDocumentsWorkspacePatientContract } from '@/features/clinical-documents/contracts/clinicalDocumentsPatientContract';

import React from 'react';
import { FileText } from 'lucide-react';

import { buildClinicalDocumentEpisodeContext } from '@/features/clinical-documents/controllers/clinicalDocumentEpisodeController';
import { ClinicalDocumentsWorkspace } from '@/features/clinical-documents/components/ClinicalDocumentsWorkspace';

interface ClinicalDocumentsPanelProps {
  patient: ClinicalDocumentsWorkspacePatientContract;
  currentDateString: string;
  bedId: string;
}

export const ClinicalDocumentsPanel: React.FC<ClinicalDocumentsPanelProps> = ({
  patient,
  currentDateString,
  bedId,
}) => {
  const headerActionsId = React.useId();
  const episode = buildClinicalDocumentEpisodeContext(patient, currentDateString, bedId);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <header className="border-b border-slate-200 bg-slate-50 px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-medical-50 text-medical-600">
              <FileText size={18} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Documentos Clínicos</h2>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                {patient.patientName || 'Paciente'} · {patient.rut || 'Sin RUT'} ·{' '}
                {episode.episodeKey}
              </p>
            </div>
          </div>
          <div id={headerActionsId} className="flex items-center gap-1" />
        </div>
      </header>

      <ClinicalDocumentsWorkspace
        patient={patient}
        currentDateString={currentDateString}
        bedId={bedId}
        isActive={true}
        headerActionsContainerId={headerActionsId}
      />
    </section>
  );
};
