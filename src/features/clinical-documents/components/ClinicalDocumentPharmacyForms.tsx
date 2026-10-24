import React, { Suspense, useRef, useState } from 'react';
import { Pill } from 'lucide-react';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import type { LibraryToolId } from '@/features/clinical-library/public';

const ClinicalLibraryDrawer = lazyWithRetry(() =>
  import('@/features/clinical-library/public').then(module => ({
    default: module.ClinicalLibraryDrawer,
  }))
);

const PHARMACY_FORMS = [
  { id: 'pharmacy-return', label: 'Acta de devolución de fármacos' },
  { id: 'pharmacy-disposal', label: 'Acta de entrega de fármacos eliminados' },
] as const satisfies ReadonlyArray<{ id: LibraryToolId; label: string }>;

export const ClinicalDocumentPharmacyForms: React.FC = () => {
  const [activeForm, setActiveForm] = useState<(typeof PHARMACY_FORMS)[number]['id'] | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  const close = (): void => {
    setActiveForm(null);
    openerRef.current?.focus();
  };

  return (
    <section aria-label="Actas de farmacia" className="border-t border-slate-200 p-2.5">
      <h3 className="mb-2 text-xs font-semibold text-slate-700">Actas de farmacia</h3>
      <div className="space-y-1.5">
        {PHARMACY_FORMS.map(form => (
          <button
            key={form.id}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={activeForm === form.id}
            onClick={event => {
              openerRef.current = event.currentTarget;
              setActiveForm(form.id);
            }}
            className="flex w-full items-start gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left text-xs text-slate-700 hover:border-medical-300 hover:bg-medical-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600"
          >
            <Pill size={14} className="mt-0.5 shrink-0 text-medical-700" aria-hidden="true" />
            {form.label}
          </button>
        ))}
      </div>
      {activeForm && (
        <Suspense fallback={<p role="status">Abriendo formulario…</p>}>
          <ClinicalLibraryDrawer initialToolId={activeForm} onClose={close} />
        </Suspense>
      )}
    </section>
  );
};
