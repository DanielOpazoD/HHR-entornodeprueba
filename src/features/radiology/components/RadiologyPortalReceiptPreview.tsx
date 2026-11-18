import React from 'react';
import { Printer } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';

interface RadiologyPortalReceiptPreviewProps {
  title: string;
  html: string;
  onClose: () => void;
}

export const RadiologyPortalReceiptPreview = ({
  title,
  html,
  onClose,
}: RadiologyPortalReceiptPreviewProps) => {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);

  const handlePrint = () => {
    const frameWindow = iframeRef.current?.contentWindow;
    frameWindow?.focus();
    frameWindow?.print();
  };

  return (
    <BaseModal
      isOpen={true}
      onClose={onClose}
      variant="white"
      size="full"
      scrollableBody={false}
      className="!rounded-xl ring-1 ring-black/[0.04]"
      bodyClassName="h-[82vh] overflow-hidden bg-slate-100 p-0"
      title={<span className="text-[14px] font-bold text-slate-800">{title}</span>}
      headerActions={
        <button
          type="button"
          onClick={handlePrint}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
        >
          <Printer size={14} />
          Imprimir / guardar PDF
        </button>
      }
    >
      <iframe
        ref={iframeRef}
        title="Comprobante Portal Web paciente"
        srcDoc={html}
        className="h-full w-full border-0 bg-white"
      />
    </BaseModal>
  );
};
