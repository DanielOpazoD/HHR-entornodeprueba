import React from 'react';
import { X, Heart, MapPin, Activity, UploadCloud, CheckCircle, Clock } from 'lucide-react';
import type { MasterPatient, HospitalizationEvent } from '@/types/domain/patientMaster';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import clsx from 'clsx';
import { buttonClassName } from '@/components/ui/base/buttonStyles';
import {
  PANEL_HEADER_CLASS,
  PANEL_ICON_CLASS,
  PANEL_TITLE_CLASS,
} from '@/components/ui/base/panelStyles';

interface PatientDetailModalProps {
  patient: MasterPatient;
  onClose: () => void;
}

export const PatientDetailModal: React.FC<PatientDetailModalProps> = ({ patient, onClose }) => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        <div className={clsx(PANEL_HEADER_CLASS, 'items-start border-slate-100 px-4 sm:px-6')}>
          <span
            className={clsx(PANEL_ICON_CLASS, 'text-sm font-semibold text-blue-700')}
            aria-hidden="true"
          >
            {patient.fullName.charAt(0)}
          </span>
          <div className="min-w-0 flex-1 basis-40">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className={PANEL_TITLE_CLASS}>{patient.fullName}</h2>
              <div className="shrink-0 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                {patient.hospitalizations?.length || 0} Eventos
              </div>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
              <span className="font-mono text-slate-800">{patient.rut}</span>
              <span className="flex items-center gap-1">
                <Heart
                  size={14}
                  className={
                    patient.vitalStatus === 'Fallecido' ? 'text-slate-500' : 'text-emerald-600'
                  }
                />
                {patient.vitalStatus || 'Vivo'}
              </span>
              <span className="flex items-center gap-1">
                <MapPin size={12} className="text-blue-600" /> {patient.forecast || 'SIN PREVISIÓN'}
              </span>
              {patient.gender && (
                <span className="flex items-center gap-1">
                  <Activity size={12} className="text-indigo-600" /> {patient.gender}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className={buttonClassName('ghost', 'icon', 'ml-auto shrink-0')}
            aria-label="Cerrar"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
          <h3 className="text-xs font-semibold text-slate-600 mb-6 flex items-center gap-2">
            <Activity size={14} className="text-blue-500" /> Línea de Tiempo Clínica
          </h3>

          <div className="relative space-y-4">
            <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-slate-200/60" />

            {!patient.hospitalizations || patient.hospitalizations.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <Clock size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-xs font-semibold">Sin registros históricos</p>
              </div>
            ) : (
              patient.hospitalizations
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((ev: HospitalizationEvent, idx: number) => (
                  <div key={idx} className="relative pl-8">
                    <div
                      className={clsx(
                        'absolute left-0 top-1.5 w-6 h-6 rounded-lg flex items-center justify-center border-2 border-white shadow-sm z-10',
                        ev.type === 'Ingreso'
                          ? 'bg-blue-600 text-white'
                          : ev.type === 'Egreso'
                            ? 'bg-emerald-500 text-white'
                            : ev.type === 'Traslado'
                              ? 'bg-amber-500 text-white'
                              : 'bg-slate-800 text-white'
                      )}
                    >
                      {ev.type === 'Ingreso' && <UploadCloud size={12} className="rotate-180" />}
                      {ev.type === 'Egreso' && <CheckCircle size={12} />}
                      {ev.type === 'Traslado' && <Activity size={12} />}
                      {ev.type === 'Fallecimiento' && <Heart size={12} />}
                    </div>

                    <div className="bg-white p-3 rounded-xl border border-slate-200/60 shadow-sm transition-all hover:border-blue-200">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-xs font-semibold text-slate-800">{ev.type}</span>
                        <span className="text-xs font-semibold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100 flex items-center gap-1.5">
                          <Clock size={10} /> {formatDateDDMMYYYY(ev.date)}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-slate-600">Diagnóstico</div>
                          <div className="text-xs text-slate-700 font-semibold leading-snug line-clamp-2">
                            {ev.diagnosis}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-end justify-end gap-1.5">
                          {ev.bedName && (
                            <div className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-xs font-semibold border border-slate-200">
                              CAMA: {ev.bedName}
                            </div>
                          )}
                          {ev.receivingCenter && (
                            <div className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded text-xs font-semibold border border-amber-100">
                              DESTINO: {ev.receivingCenter}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>

        <div className="p-4 bg-white border-t border-slate-100 flex justify-end">
          <button onClick={onClose} className={buttonClassName('secondary')}>
            Cerrar Explorer
          </button>
        </div>
      </div>
    </div>
  );
};
