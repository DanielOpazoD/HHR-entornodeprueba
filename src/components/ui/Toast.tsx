import React from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import clsx from 'clsx';
import type { Notification } from '@/context/uiContracts';

interface ToastProps {
  notification: Notification;
  onDismiss: () => void;
}

export const Toast: React.FC<ToastProps> = ({ notification, onDismiss }) => {
  const icons = {
    success: <CheckCircle className="text-green-500" size={12} />,
    error: <AlertCircle className="text-red-500" size={12} />,
    warning: <AlertTriangle className="text-amber-500" size={12} />,
    info: <Info className="text-blue-500" size={12} />,
  };

  const bgColors = {
    success: 'bg-green-50 border-green-200',
    error: 'bg-red-50 border-red-200',
    warning: 'bg-amber-50 border-amber-200',
    info: 'bg-blue-50 border-blue-200',
  };

  return (
    <div
      className={clsx(
        'flex items-start gap-2 px-2 py-1.5 rounded border shadow-md animate-slide-in-right max-w-[200px]',
        bgColors[notification.type]
      )}
    >
      <div className="flex-shrink-0 mt-0.5">{icons[notification.type]}</div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-[10px] text-slate-800 leading-tight">{notification.title}</p>
        {notification.message && (
          <p className="text-[9px] text-slate-500 leading-tight">{notification.message}</p>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="flex-shrink-0 text-slate-400 hover:text-slate-600 transition-colors"
        aria-label="Cerrar notificación"
      >
        <X size={10} />
      </button>
    </div>
  );
};
