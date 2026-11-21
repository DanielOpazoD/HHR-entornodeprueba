import React, { useState } from 'react';
import { Bookmark, BookmarkInput } from '@/types/bookmarks';
import { Plus, Edit2 } from 'lucide-react';
import { BookmarkEditorModal } from './BookmarkEditorModal';
import { BookmarkManagerModal } from './BookmarkManagerModal';
import { BookmarkBarActionsMenu } from './BookmarkBarActionsMenu';
import clsx from 'clsx';
import { useBookmarks } from '@/hooks/bookmarks/useBookmarks';
import { useBookmarkBarPreferences } from '@/hooks/bookmarks/useBookmarkBarPreferences';
import { useBookmarkImport } from '@/hooks/bookmarks/useBookmarkImport';

export const BookmarkBar: React.FC = () => {
  const { bookmarks, saveBookmark, exportBookmarks } = useBookmarks();
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | undefined>();
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const {
    alignment,
    customOffset,
    alignmentClass,
    customPaddingStyle,
    setAlignmentPreference,
    setCustomOffsetPreference,
  } = useBookmarkBarPreferences();
  const { fileInputRef, handleFileChange, openFilePicker } = useBookmarkImport();

  const handleSave = async (input: BookmarkInput) => {
    await saveBookmark(input, editingBookmark);
  };

  const handleEdit = (bookmark: Bookmark) => {
    setEditingBookmark(bookmark);
    setIsEditorOpen(true);
    setIsActionsMenuOpen(false);
  };

  return (
    <div
      className="w-full bg-white/95 backdrop-blur-md border-b border-slate-100 sticky top-[100px] z-[30] print:hidden h-9 flex items-center px-4 overflow-visible group"
      style={{ transform: 'translateZ(0)' }}
    >
      <div
        className={clsx(
          'flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 py-1',
          alignmentClass
        )}
        style={customPaddingStyle}
      >
        {bookmarks.map(bookmark => (
          <div key={bookmark.id} className="relative group/item shrink-0">
            <a
              href={bookmark.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-slate-50 transition-all text-slate-600 text-[11px] font-medium border border-transparent hover:border-slate-100"
              title={bookmark.notes || bookmark.url}
            >
              <span className="text-sm leading-none">{bookmark.icon || '🔗'}</span>
              <span className="truncate max-w-[120px]">{bookmark.name}</span>
            </a>

            {/* Inline controls on hover */}
            <div className="absolute top-0 right-0 opacity-0 group-hover/item:opacity-100 transition-opacity flex">
              <button
                aria-label={`Editar marcador ${bookmark.name}`}
                onClick={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleEdit(bookmark);
                }}
                className="p-0.5 text-slate-300 hover:text-medical-600 bg-white border border-slate-100 rounded-full -mt-1 -mr-1 shadow-sm"
              >
                <Edit2 size={8} aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}

        {bookmarks.length === 0 && <div className="w-4" />}
      </div>

      <div className="flex items-center gap-0.5 pl-4 border-l border-slate-100 ml-2">
        <button
          onClick={e => {
            e.stopPropagation();
            setEditingBookmark(undefined);
            setIsEditorOpen(true);
          }}
          className="p-1 text-slate-400 hover:text-medical-600 hover:bg-slate-50 rounded transition-all"
          title="Agregar"
        >
          <Plus size={14} />
        </button>

        <BookmarkBarActionsMenu
          bookmarksCount={bookmarks.length}
          alignment={alignment}
          customOffset={customOffset}
          isOpen={isActionsMenuOpen}
          onToggle={() => setIsActionsMenuOpen(current => !current)}
          onClose={() => setIsActionsMenuOpen(false)}
          onOpenManager={() => {
            setIsActionsMenuOpen(false);
            setIsManagerOpen(true);
          }}
          onImport={openFilePicker}
          onExport={() => {
            exportBookmarks();
            setIsActionsMenuOpen(false);
          }}
          onAlignmentChange={setAlignmentPreference}
          onCustomOffsetChange={setCustomOffsetPreference}
        />
      </div>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".json"
        className="hidden"
      />

      <BookmarkEditorModal
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        onSave={handleSave}
        initialData={editingBookmark}
      />
      {isManagerOpen && (
        <BookmarkManagerModal
          isOpen={isManagerOpen}
          onClose={() => setIsManagerOpen(false)}
          bookmarks={bookmarks}
          onEdit={bookmark => {
            setEditingBookmark(bookmark);
            setIsManagerOpen(false);
            setIsEditorOpen(true);
          }}
        />
      )}
    </div>
  );
};
