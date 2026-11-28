import React from 'react';
import type { HandoffDailyRecordContract } from '@/domain/handoff/recordContracts';
import { DebouncedInput } from '@/components/ui/DebouncedInput';

interface HandoffSharedChecklistProps {
  data: HandoffDailyRecordContract['handoffSharedChecklist'];
  onUpdate: (field: 'crashCartReviewDate' | 'crashCartCode', value: string) => void;
  readOnly: boolean;
  inline?: boolean;
}

export const HandoffSharedChecklist: React.FC<HandoffSharedChecklistProps> = ({
  data,
  onUpdate,
  readOnly,
  inline = false,
}) => {
  const inputClass =
    'handoff-review-input h-7 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 disabled:bg-slate-50 disabled:text-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500';

  return (
    <div
      className={`handoff-review flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-600 ${
        inline ? '' : 'pb-1.5 border-b border-slate-100/80'
      }`}
    >
      <label className="handoff-review-field flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-slate-500">
        Última fecha revisión carro de paro
        <input
          type="date"
          value={data?.crashCartReviewDate || ''}
          onChange={event => onUpdate('crashCartReviewDate', event.target.value)}
          disabled={readOnly}
          className={`${inputClass} w-[7.75rem]`}
        />
      </label>
      <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
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
          className={`${inputClass} w-24`}
        />
      </label>
    </div>
  );
};
