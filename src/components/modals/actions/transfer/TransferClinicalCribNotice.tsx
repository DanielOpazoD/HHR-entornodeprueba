import React from 'react';
import { Baby } from 'lucide-react';

interface TransferClinicalCribNoticeProps {
  clinicalCribName?: string;
}

export const TransferClinicalCribNotice: React.FC<TransferClinicalCribNoticeProps> = ({
  clinicalCribName,
}) => (
  <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-lg flex items-start gap-2 animate-fade-in mb-2">
    <Baby className="text-blue-500 mt-0.5 shrink-0" size={14} />
    <div className="space-y-0.5">
      <p className="text-[9px] font-bold text-blue-900 uppercase tracking-tight">
        Cuna Clínica Detectada
      </p>
      <p className="text-[10px] text-blue-800/80 leading-tight">
        Se generará un traslado adicional para {clinicalCribName || 'RN'}.
      </p>
    </div>
  </div>
);
