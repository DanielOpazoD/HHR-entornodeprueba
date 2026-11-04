import React from 'react';
import { Bandage } from 'lucide-react';
import { useTableConfig } from '@/context/TableConfigContext';
import { saveTableConfig } from '@/services/storage/tableConfigService';
import { useNotification } from '@/context/UIContext';

/**
 * Global census choice, saved in the table configuration that every user already reads; each
 * census receives it through its own subscription.
 */
export const CensusNursingScalesSetting: React.FC = () => {
  const { config } = useTableConfig();
  const { notify } = useNotification();
  const visible = config.nursingScalesVisible !== false;
  const setVisible = (nursingScalesVisible: boolean) =>
    saveTableConfig({ ...config, nursingScalesVisible }).catch(() =>
      notify({
        type: 'error',
        title: 'No se guardó el cambio',
        message: 'Revisa la conexión y vuelve a intentarlo.',
      })
    );
  return (
    <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex min-w-0 items-center gap-3">
        <div className="rounded-lg bg-violet-50 p-2 text-violet-600">
          <Bandage size={18} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-700">Braden y Downton en el censo diario</p>
          <p className="text-[11px] text-slate-500">
            Para todos los usuarios. Apagado oculta ambas escalas y el botón de escalas por
            reaplicar; CUDYR sigue visible.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void setVisible(!visible)}
        className={`relative h-6 w-12 shrink-0 rounded-full transition-all ${
          visible ? 'bg-medical-600' : 'bg-slate-300'
        }`}
        aria-pressed={visible}
        aria-label="Mostrar Braden y Downton en el censo diario"
      >
        <div
          className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${
            visible ? 'left-7' : 'left-1'
          }`}
        />
      </button>
    </div>
  );
};
