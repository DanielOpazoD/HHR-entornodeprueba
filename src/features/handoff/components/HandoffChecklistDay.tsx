import React from 'react';
import { ClipboardCheck } from 'lucide-react';
import { HandoffChecklistItem as ChecklistItem } from './HandoffChecklistItem';

interface HandoffChecklistDayProps {
  data?: {
    escalaBraden?: boolean;
    escalaRiesgoCaidas?: boolean;
    escalaRiesgoLPP?: boolean;
  };
  onUpdate: (field: string, value: boolean) => void;
  readOnly?: boolean;
}

export const HandoffChecklistDay: React.FC<HandoffChecklistDayProps> = ({
  data = {},
  onUpdate,
  readOnly = false,
}) => {
  return (
    <div className="handoff-checklist">
      <div className="flex w-full items-center gap-2 text-slate-500 shrink-0 lg:w-auto print:w-auto print:text-sky-700">
        <ClipboardCheck size={14} className="print:w-3 print:h-3" aria-hidden="true" />
        <span className="text-[10px] font-semibold uppercase tracking-wide print:font-bold print:tracking-normal print:text-black print:text-[9px]">
          Checklist
        </span>
      </div>
      <div className="handoff-checklist-items">
        <ChecklistItem
          checked={!!data.escalaBraden}
          onChange={checked => onUpdate('escalaBraden', checked)}
          label="Escala Braden"
          disabled={readOnly}
        />
        <ChecklistItem
          checked={!!data.escalaRiesgoCaidas}
          onChange={checked => onUpdate('escalaRiesgoCaidas', checked)}
          label="Escala Riesgo Caídas"
          disabled={readOnly}
        />
        <ChecklistItem
          checked={!!data.escalaRiesgoLPP}
          onChange={checked => onUpdate('escalaRiesgoLPP', checked)}
          label="Evaluación LPP"
          disabled={readOnly}
        />
      </div>
    </div>
  );
};
