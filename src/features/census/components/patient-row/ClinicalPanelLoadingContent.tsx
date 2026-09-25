import React from 'react';

/** Static placeholders occupy the same reading area as the first clinical notes. */
export const ClinicalPanelLoadingContent: React.FC = () => (
  <div role="status" aria-busy="true" data-testid="clinical-panel-loading-content">
    <span className="sr-only">Consultando Ficha Médico…</span>
    <div aria-hidden="true" className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
      {[0, 1, 2].map(index => (
        <div key={index} className="min-h-28 space-y-3 px-3 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <span className="h-3 w-28 rounded bg-slate-100" />
            <span className="h-2.5 w-20 rounded bg-slate-100" />
          </div>
          <div className="space-y-2">
            <div className="h-2.5 w-full rounded bg-slate-100" />
            <div className="h-2.5 w-5/6 rounded bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  </div>
);
