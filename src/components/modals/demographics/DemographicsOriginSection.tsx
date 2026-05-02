import React from 'react';
import clsx from 'clsx';
import { resolveAdmissionDateOptions } from '@/shared/date/admissionDateOptions';
import {
  resolveAdmissionTimePickerModel,
  resolveAdmissionTimeValue,
} from '@/shared/date/admissionTimeOptions';
import { LocalDemographicsState, Origin } from './types';
import { DemographicsAdmissionOriginField } from './DemographicsAdmissionOriginField';
import { DemographicsSexField } from './DemographicsSexField';

const resolveDraftAdmissionTime = (
  admissionTime?: string
): {
  hour: string;
  minute: string;
} => {
  const [hour = '', minute = ''] = admissionTime?.split(':') ?? [];

  return {
    hour: /^\d{2}$/.test(hour) ? hour : '',
    minute: /^\d{2}$/.test(minute) ? minute : '',
  };
};

const ADMISSION_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

interface DemographicsOriginSectionProps {
  localData: LocalDemographicsState;
  setLocalData: React.Dispatch<React.SetStateAction<LocalDemographicsState>>;
  recordDate: string;
  missingRequiredFields?: string[];
}

const missingRequiredClass =
  'border-amber-300 bg-amber-50/60 focus:border-amber-500 focus:ring-amber-500/20';

export const DemographicsOriginSection: React.FC<DemographicsOriginSectionProps> = ({
  localData,
  setLocalData,
  recordDate,
  missingRequiredFields = [],
}) => {
  const isMissingRequired = (field: string): boolean => missingRequiredFields.includes(field);
  const admissionDateOptions = React.useMemo(
    () => resolveAdmissionDateOptions(recordDate, localData.admissionDate),
    [localData.admissionDate, recordDate]
  );
  const admissionTimeModel = React.useMemo(
    () => resolveAdmissionTimePickerModel({ admissionTime: localData.admissionTime }),
    [localData.admissionTime]
  );
  const [draftAdmissionTime, setDraftAdmissionTime] = React.useState(() =>
    resolveDraftAdmissionTime(localData.admissionTime)
  );
  const [draftAdmissionTimeText, setDraftAdmissionTimeText] = React.useState(
    localData.admissionTime || ''
  );

  React.useEffect(() => {
    setDraftAdmissionTime(resolveDraftAdmissionTime(localData.admissionTime));
    setDraftAdmissionTimeText(localData.admissionTime || '');
  }, [localData.admissionTime]);

  const updateAdmissionTimePart =
    (part: 'hour' | 'minute') => (event: React.ChangeEvent<HTMLSelectElement>) => {
      const nextDraftAdmissionTime = {
        ...draftAdmissionTime,
        [part]: event.target.value,
      };
      const nextAdmissionTime =
        nextDraftAdmissionTime.hour && nextDraftAdmissionTime.minute
          ? resolveAdmissionTimeValue({
              hour: nextDraftAdmissionTime.hour,
              minute: nextDraftAdmissionTime.minute,
            })
          : '';

      setDraftAdmissionTime(nextDraftAdmissionTime);
      setDraftAdmissionTimeText(nextAdmissionTime);
      setLocalData(current => ({
        ...current,
        admissionTime: nextAdmissionTime,
      }));
    };

  const updateAdmissionTimeText = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextAdmissionTimeText = event.target.value.trim();
    const match = nextAdmissionTimeText.match(ADMISSION_TIME_PATTERN);

    setDraftAdmissionTimeText(nextAdmissionTimeText);

    if (!match) {
      setDraftAdmissionTime(resolveDraftAdmissionTime());
      setLocalData(current => ({
        ...current,
        admissionTime: '',
      }));
      return;
    }

    const [, hour, minute] = match;
    const nextAdmissionTime = resolveAdmissionTimeValue({ hour, minute });

    setDraftAdmissionTime({ hour, minute });
    setLocalData(current => ({
      ...current,
      admissionTime: nextAdmissionTime,
    }));
  };

  const updateAdmissionDate = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextAdmissionDate = event.target.value;
    setLocalData(current => ({
      ...current,
      admissionDate: nextAdmissionDate,
    }));
  };

  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2 text-[11px] font-bold text-slate-800 uppercase tracking-wider pb-1.5 border-b border-slate-100">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-3.5 w-3.5 text-emerald-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
        Origen y Estadía
      </h4>

      <div className="space-y-3">
        <DemographicsAdmissionOriginField
          localData={localData}
          setLocalData={setLocalData}
          isOriginMissing={isMissingRequired('procedencia')}
          isOriginDetailsMissing={isMissingRequired('detalle de procedencia')}
          missingRequiredClass={missingRequiredClass}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="space-y-1">
            <label
              htmlFor="demographics-admission-date"
              className="block text-[9px] font-bold text-slate-500 uppercase tracking-wide ml-1"
            >
              Fecha de ingreso
            </label>
            <select
              id="demographics-admission-date"
              aria-invalid={isMissingRequired('fecha de ingreso') || undefined}
              className={clsx(
                'w-full px-2.5 py-1.5 border rounded-lg text-[13px] text-slate-700 focus:bg-white focus:ring-2 outline-none shadow-sm transition-all',
                isMissingRequired('fecha de ingreso')
                  ? missingRequiredClass
                  : 'bg-slate-50 border-transparent focus:ring-blue-500/20 focus:border-blue-500'
              )}
              value={localData.admissionDate}
              onChange={updateAdmissionDate}
            >
              <option value="">-- Seleccionar --</option>
              {admissionDateOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wide ml-1">
              Hora de ingreso
            </label>
            <div
              role="group"
              aria-label="Configuración de hora de ingreso"
              className={clsx(
                'grid grid-cols-[1.15fr_0.72fr_0.72fr] overflow-hidden rounded-xl border bg-white shadow-sm transition-colors',
                isMissingRequired('hora de ingreso')
                  ? 'border-amber-300 bg-amber-50/60'
                  : 'border-slate-200 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20'
              )}
            >
              <input
                type="text"
                inputMode="numeric"
                aria-label="Hora de ingreso"
                aria-invalid={isMissingRequired('hora de ingreso') || undefined}
                placeholder="14:00"
                className={clsx(
                  'w-full border-0 bg-transparent px-2.5 py-1.5 text-[13px] text-slate-700 outline-none transition-colors',
                  isMissingRequired('hora de ingreso') ? 'focus:bg-amber-50' : 'focus:bg-white'
                )}
                value={draftAdmissionTimeText}
                onChange={updateAdmissionTimeText}
              />
              <select
                aria-label="Hora de ingreso - horas"
                aria-invalid={isMissingRequired('hora de ingreso') || undefined}
                className={clsx(
                  'w-full border-0 border-l border-slate-200 bg-transparent px-2 py-1.5 text-center text-[13px] text-slate-700 outline-none transition-colors',
                  isMissingRequired('hora de ingreso') ? 'focus:bg-amber-50' : 'focus:bg-white'
                )}
                value={draftAdmissionTime.hour}
                onChange={updateAdmissionTimePart('hour')}
              >
                <option value="">--</option>
                {admissionTimeModel.hourOptions.map(hour => (
                  <option key={hour} value={hour}>
                    {hour}
                  </option>
                ))}
              </select>
              <select
                aria-label="Hora de ingreso - minutos"
                aria-invalid={isMissingRequired('hora de ingreso') || undefined}
                className={clsx(
                  'w-full border-0 border-l border-slate-200 bg-transparent px-2 py-1.5 text-center text-[13px] text-slate-700 outline-none transition-colors',
                  isMissingRequired('hora de ingreso') ? 'focus:bg-amber-50' : 'focus:bg-white'
                )}
                value={draftAdmissionTime.minute}
                onChange={updateAdmissionTimePart('minute')}
              >
                <option value="">--</option>
                {admissionTimeModel.minuteOptions.map(minute => (
                  <option key={minute} value={minute}>
                    {minute}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wide ml-1">
            Condición
          </label>
          <div className="relative">
            <select
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-transparent rounded-lg text-[13px] text-slate-700 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none appearance-none cursor-pointer shadow-sm transition-all"
              value={localData.origin}
              onChange={e => setLocalData({ ...localData, origin: e.target.value as Origin })}
            >
              <option value="Residente">Residente</option>
              <option value="Turista Nacional">Turista Nacional</option>
              <option value="Turista Extranjero">Turista Extranjero</option>
            </select>
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>
          </div>
        </div>

        <div className="pt-1">
          <label
            className={clsx(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all cursor-pointer select-none',
              localData.isRapanui
                ? 'bg-amber-50 border-amber-200 shadow-sm'
                : 'bg-white border-slate-200 hover:bg-slate-50'
            )}
          >
            <div
              className={clsx(
                'w-5 h-5 rounded border flex items-center justify-center transition-colors',
                localData.isRapanui ? 'bg-amber-500 border-amber-600' : 'bg-white border-slate-300'
              )}
            >
              {localData.isRapanui && (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3.5 w-3.5 text-white"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
              <input
                type="checkbox"
                className="sr-only"
                checked={localData.isRapanui}
                onChange={e => setLocalData({ ...localData, isRapanui: e.target.checked })}
              />
            </div>
            <div>
              <span
                className={clsx(
                  'text-[13px] font-bold block',
                  localData.isRapanui ? 'text-amber-900' : 'text-slate-700'
                )}
              >
                Pertenencia Rapanui
              </span>
            </div>
          </label>
        </div>

        <DemographicsSexField
          localData={localData}
          setLocalData={setLocalData}
          isMissingRequired={isMissingRequired('sexo')}
        />
      </div>
    </div>
  );
};
