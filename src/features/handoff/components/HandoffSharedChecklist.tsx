import React from 'react';
import type { DailyRecord } from '@/domain/handoff/recordContracts';
import { DebouncedInput } from '@/components/ui/DebouncedInput';

interface HandoffSharedChecklistProps {
  data: DailyRecord['handoffSharedChecklist'];
  onUpdate: (field: 'crashCartReviewDate' | 'crashCartCode', value: string) => void;
  readOnly: boolean;
}

export const HandoffSharedChecklist: React.FC<HandoffSharedChecklistProps> = ({
  data,
  onUpdate,
  readOnly,
}) => {
  const inputClass =
    'rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-2.5 pb-2.5 border-b border-slate-100/80 text-sm text-slate-700">
      <label className="flex flex-wrap items-center gap-2">
        Última fecha revisión carro de paro
        <input
          type="date"
          value={data?.crashCartReviewDate || ''}
          onChange={event => onUpdate('crashCartReviewDate', event.target.value)}
          disabled={readOnly}
          className={inputClass}
        />
      </label>
      <label className="flex items-center gap-2">
        Código
        <DebouncedInput
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          pattern="[0-9]{8}"
          value={data?.crashCartCode || ''}
          onChange={value => {
            if (/^(?:[0-9]{8})?$/.test(value)) onUpdate('crashCartCode', value);
          }}
          onInput={event => {
            const input = event.currentTarget;
            input.setCustomValidity(
              input.value && !/^[0-9]{8}$/.test(input.value)
                ? 'Ingrese un código de 8 dígitos.'
                : ''
            );
          }}
          onBlur={event => event.currentTarget.reportValidity()}
          placeholder="8 dígitos"
          disabled={readOnly}
          className={`${inputClass} w-28`}
        />
      </label>
    </div>
  );
};
