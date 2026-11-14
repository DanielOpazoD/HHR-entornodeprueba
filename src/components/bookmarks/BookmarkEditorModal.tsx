import React, { useState, useEffect } from 'react';
import { Bookmark, BookmarkInput } from '@/types/bookmarks';
import { BaseModal } from '@/components/shared/BaseModal';
import { buttonClassName } from '@/components/ui/base/buttonStyles';
import { Bookmark as BookmarkIcon } from 'lucide-react';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { bookmarkLogger } from '@/services/bookmarks/bookmarkLoggers';
import {
  buildBookmarkInput,
  createBookmarkEditorInitialState,
  DEFAULT_BOOKMARK_ICON,
} from '@/components/bookmarks/controllers/bookmarkEditorController';

interface BookmarkEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (input: BookmarkInput) => Promise<void>;
  initialData?: Bookmark;
}

const COMMON_EMOJIS = [
  '🔗',
  '🏥',
  '📋',
  '💉',
  '🧪',
  '🩸',
  '💊',
  '🩺',
  '💾',
  '📁',
  '🏠',
  '📞',
  '📧',
  '⚙️',
  '📊',
  '🌐',
];

export const BookmarkEditorModal: React.FC<BookmarkEditorModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialData,
}) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [icon, setIcon] = useState(DEFAULT_BOOKMARK_ICON);
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const initialState = createBookmarkEditorInitialState(initialData);
      setName(initialState.name);
      setUrl(initialState.url);
      setIcon(initialState.icon);
      setNotes(initialState.notes);
    }
  }, [isOpen, initialData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave(buildBookmarkInput({ name, url, icon, notes }));
      onClose();
    } catch (error) {
      bookmarkLogger.error('Error saving bookmark from editor modal', error);
      defaultBrowserWindowRuntime.alert('No se pudo guardar el marcador. Intente nuevamente.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? 'Editar Marcador' : 'Nuevo Marcador'}
      icon={<BookmarkIcon size={14} />}
      headerIconColor="text-slate-500"
      variant="white"
      size="sm"
      className="!rounded-lg border-slate-100 shadow-xl"
      showCloseButton={true}
    >
      <form onSubmit={handleSubmit} className="space-y-4 -mt-2">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-600">Nombre del Sistema</label>
            <input
              autoFocus
              required
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ej: Fonasa"
              className="hhr-field"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-600">Icono</label>
            <select
              value={icon}
              onChange={e => setIcon(e.target.value)}
              className="hhr-field cursor-pointer"
            >
              {COMMON_EMOJIS.map(e => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-600">URL / Enlace</label>
          <input
            required
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="ejemplo.cl"
            className="hhr-field"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-600">Notas o Credenciales</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Usuario, clave o recordatorios..."
            rows={1}
            className="hhr-field resize-none"
          />
        </div>

        <div className="pt-4 flex gap-4">
          <button
            type="button"
            onClick={onClose}
            className={buttonClassName('secondary', 'sm', 'flex-1')}
          >
            Cerrar
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className={buttonClassName('primary', 'sm', 'flex-1')}
          >
            {isSaving ? '...' : initialData ? 'Guardar' : 'Crear'}
          </button>
        </div>
      </form>
    </BaseModal>
  );
};
