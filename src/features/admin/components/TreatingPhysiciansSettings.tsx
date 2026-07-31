import React, { useMemo } from 'react';
import { AlertCircle, CheckCircle2, Cloud, Stethoscope } from 'lucide-react';
import { SPECIALTY_OPTIONS } from '@/constants/clinicalSpecialtyConstants';
import { useProfessionalsQuery, useSaveProfessionalsMutation } from '@/hooks/useStaffQuery';
import {
  assignProfessionalSpecialty,
  professionalCatalogKey,
} from '@/services/staff/treatingPhysicianCatalog';

export const TreatingPhysiciansSettings: React.FC = () => {
  const { data: professionals = [], isLoading } = useProfessionalsQuery();
  const saveProfessionals = useSaveProfessionalsMutation();
  const orderedProfessionals = useMemo(
    () =>
      professionals.toSorted((left, right) =>
        left.name.localeCompare(right.name, 'es-CL', { sensitivity: 'base' })
      ),
    [professionals]
  );
  const pendingCount = professionals.filter(item => !item.specialty?.trim()).length;

  const handleSpecialtyChange = (catalogKey: string, specialty: string) => {
    saveProfessionals.mutate(
      assignProfessionalSpecialty(professionals, catalogKey, specialty || undefined)
    );
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-sky-50 p-2.5 text-sky-600">
            <Stethoscope size={20} />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-800">Médicos tratantes</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              Eloísa incorpora cada médico mediante su identificador estable. Configure aquí la
              especialidad que HHR asignará automáticamente al seleccionarlo en el censo.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">
            {professionals.length} médicos
          </span>
          {pendingCount > 0 && (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-700">
              {pendingCount} sin especialidad
            </span>
          )}
        </div>
      </header>

      {saveProfessionals.isError && (
        <div
          role="alert"
          className="mx-5 mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
        >
          <AlertCircle size={15} />
          No se pudo sincronizar el cambio. Se conservó la configuración anterior.
        </div>
      )}

      {isLoading ? (
        <div className="p-10 text-center text-sm text-slate-500">Cargando médicos…</div>
      ) : orderedProfessionals.length === 0 ? (
        <div className="p-10 text-center">
          <Stethoscope size={28} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-semibold text-slate-600">Aún no hay médicos identificados</p>
          <p className="mt-1 text-xs text-slate-400">
            Realice una sincronización con Eloísa para incorporar el catálogo inicial.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {orderedProfessionals.map(professional => {
            const catalogKey = professionalCatalogKey(professional);
            const specialtyIsCustom = Boolean(
              professional.specialty &&
              !SPECIALTY_OPTIONS.includes(
                professional.specialty as (typeof SPECIALTY_OPTIONS)[number]
              )
            );

            return (
              <div
                key={catalogKey}
                className="grid gap-3 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(220px,320px)] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-700">
                    {professional.name}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {professional.rayenPractitionerId
                      ? `ID Eloísa ${professional.rayenPractitionerId}`
                      : 'Registro local sin ID Eloísa'}
                  </p>
                </div>

                <label className="grid gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Especialidad
                  <select
                    aria-label={`Especialidad de ${professional.name}`}
                    value={professional.specialty ?? ''}
                    onChange={event => handleSpecialtyChange(catalogKey, event.target.value)}
                    disabled={saveProfessionals.isPending}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 disabled:cursor-wait disabled:opacity-60"
                  >
                    <option value="">Sin especialidad</option>
                    {specialtyIsCustom && (
                      <option value={professional.specialty}>{professional.specialty}</option>
                    )}
                    {SPECIALTY_OPTIONS.map(specialty => (
                      <option key={specialty} value={specialty}>
                        {specialty}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            );
          })}
        </div>
      )}

      <footer className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-3 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <Cloud size={13} /> Guardado en el catálogo compartido de HHR
        </span>
        {saveProfessionals.isPending ? (
          <span className="animate-pulse font-semibold text-sky-600">Guardando…</span>
        ) : (
          <span className="flex items-center gap-1 font-semibold text-emerald-600">
            <CheckCircle2 size={13} /> Actualizado
          </span>
        )}
      </footer>
    </section>
  );
};
