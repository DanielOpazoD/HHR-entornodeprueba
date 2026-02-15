export interface ResolveActionHeaderStateParams {
  readOnly: boolean;
  canDeleteRecord: boolean;
  deniedMessage: string;
}

export interface ActionHeaderState {
  shouldRenderButton: boolean;
  buttonClassName: string;
  title: string;
  icon: 'trash' | 'shield';
}

export const resolveActionHeaderState = ({
  readOnly,
  canDeleteRecord,
  deniedMessage,
}: ResolveActionHeaderStateParams): ActionHeaderState => {
  const shouldRenderButton = !readOnly || canDeleteRecord;

  if (canDeleteRecord) {
    return {
      shouldRenderButton,
      buttonClassName:
        'p-1 rounded-md transition-all mx-auto block bg-slate-500/10 hover:bg-rose-500/20 text-slate-400 hover:text-rose-600',
      title: 'Limpiar todos los datos del día',
      icon: 'trash',
    };
  }

  return {
    shouldRenderButton,
    buttonClassName:
      'p-1 rounded-md transition-all mx-auto block bg-slate-100 text-slate-300 cursor-not-allowed opacity-50',
    title: deniedMessage,
    icon: 'shield',
  };
};
