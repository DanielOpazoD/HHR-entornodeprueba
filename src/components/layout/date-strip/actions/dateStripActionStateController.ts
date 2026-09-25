import type { EmailStatus } from './types';

interface SaveButtonUiStateInput {
  isArchived: boolean;
  isBackingUp: boolean;
  variant: 'census' | 'handoff';
}

interface SaveButtonUiState {
  label: string;
  buttonClassName: string;
  iconKind: 'loading' | 'archived' | 'default';
  widthClassName: string;
}

export const resolveSaveButtonUiState = ({
  isArchived,
  isBackingUp,
  variant,
}: SaveButtonUiStateInput): SaveButtonUiState => {
  if (isBackingUp) {
    return {
      label: 'Guardando...',
      buttonClassName:
        variant === 'handoff'
          ? 'bg-slate-100 text-slate-400 border-slate-200'
          : 'border border-slate-200 bg-slate-50 text-slate-600',
      iconKind: 'loading',
      widthClassName: variant === 'handoff' ? 'min-w-[40px]' : 'w-[34px]',
    };
  }

  if (isArchived) {
    return {
      label: 'Sincronizado',
      buttonClassName:
        variant === 'handoff'
          ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-none shadow-sm'
          : 'border border-slate-200 bg-slate-50 text-teal-700 hover:bg-slate-100',
      iconKind: 'archived',
      widthClassName: variant === 'handoff' ? 'min-w-[40px]' : 'w-[34px]',
    };
  }

  return {
    label: 'Guardar',
    buttonClassName:
      variant === 'handoff'
        ? 'btn-primary bg-emerald-500 hover:bg-emerald-600 border-none shadow-sm'
        : 'border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50',
    iconKind: 'default',
    widthClassName: variant === 'handoff' ? 'min-w-[40px]' : 'w-[34px]',
  };
};

interface EmailButtonUiStateInput {
  status: EmailStatus;
  errorMessage?: string | null;
}

interface EmailButtonUiState {
  label: string;
  title: string;
  buttonClassName: string;
  widthClassName: string;
}

export const resolveEmailButtonUiState = ({
  status,
  errorMessage,
}: EmailButtonUiStateInput): EmailButtonUiState => {
  if (status === 'loading') {
    return {
      label: 'Enviando...',
      title: 'Enviar censo',
      buttonClassName: 'btn-primary bg-teal-600 opacity-70 cursor-not-allowed',
      widthClassName: 'min-w-[116px]',
    };
  }

  if (status === 'success') {
    return {
      label: 'Enviado',
      title: 'Enviar censo',
      buttonClassName: 'bg-teal-700 text-white shadow-inner',
      widthClassName: 'min-w-[116px]',
    };
  }

  if (status === 'error') {
    return {
      label: 'Enviar censo',
      title: errorMessage || 'Ocurrió un error al enviar el correo',
      buttonClassName: 'btn-primary bg-teal-600 hover:bg-teal-700',
      widthClassName: 'min-w-[116px]',
    };
  }

  return {
    label: 'Enviar censo',
    title: 'Enviar censo',
    buttonClassName: 'btn-primary bg-teal-600 hover:bg-teal-700',
    widthClassName: 'min-w-[116px]',
  };
};
