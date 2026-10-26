import React from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import clsx from 'clsx';
import type { Notification } from '@/context/uiContracts';

interface ToastRendererProps {
  notification: Notification;
  onDismiss: () => void;
}

export const ToastRenderer: React.FC<ToastRendererProps> = ({ notification, onDismiss }) => {
  const icons = {
    success: <CheckCircle className="text-green-600" size={16} aria-hidden="true" />,
    error: <AlertCircle className="text-red-600" size={16} aria-hidden="true" />,
    warning: <AlertTriangle className="text-amber-600" size={16} aria-hidden="true" />,
    info: <Info className="text-blue-600" size={16} aria-hidden="true" />,
  };

  const bgColors = {
    success: 'bg-green-50 border-green-200',
    error: 'bg-red-50 border-red-200',
    warning: 'bg-amber-50 border-amber-200',
    info: 'bg-blue-50 border-blue-200',
  };

  return (
    <div
      role={notification.type === 'error' ? 'alert' : 'status'}
      aria-atomic="true"
      className={clsx(
        'pointer-events-auto flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 shadow-md animate-slide-in-right',
        bgColors[notification.type]
      )}
    >
      <div className="mt-0.5 shrink-0">{icons[notification.type]}</div>
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <p className="text-xs font-semibold leading-5 text-slate-800">{notification.title}</p>
        {notification.message && (
          <p className="text-[11px] leading-4 text-slate-600">{notification.message}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/70 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-medical-600"
        aria-label="Cerrar notificación"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
};
