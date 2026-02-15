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
          : 'bg-amber-100 text-amber-700 border-amber-200',
      iconKind: 'loading',
    };
  }

  if (isArchived) {
    return {
      label: 'Sincronizado',
      buttonClassName: 'bg-emerald-600 hover:bg-emerald-700 text-white border-none shadow-sm',
      iconKind: 'archived',
    };
  }

  return {
    label: 'Guardar',
    buttonClassName: 'btn-primary bg-amber-500 hover:bg-amber-600 border-none shadow-sm',
    iconKind: 'default',
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
}

export const resolveEmailButtonUiState = ({
  status,
  errorMessage,
}: EmailButtonUiStateInput): EmailButtonUiState => {
  if (status === 'loading') {
    return {
      label: 'Enviando...',
      title: 'Enviar censo',
      buttonClassName: 'btn-primary bg-blue-600 hover:bg-blue-700 opacity-70 cursor-not-allowed',
    };
  }

  if (status === 'success') {
    return {
      label: 'Enviado',
      title: 'Enviar censo',
      buttonClassName: 'bg-blue-700 text-white shadow-inner',
    };
  }

  if (status === 'error') {
    return {
      label: 'Enviar censo',
      title: errorMessage || 'Ocurrió un error al enviar el correo',
      buttonClassName: 'btn-primary bg-blue-600 hover:bg-blue-700',
    };
  }

  return {
    label: 'Enviar censo',
    title: 'Enviar censo',
    buttonClassName: 'btn-primary bg-blue-600 hover:bg-blue-700',
  };
};
