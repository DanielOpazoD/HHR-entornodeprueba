import { useEffect, useRef, useState } from 'react';
import { Library, X } from 'lucide-react';
import { hideMoaAndRestoreFocus } from '@/shared/ui/useMoaVisibility';
import { MoaMascot } from './navbar/MoaMascot';
import { MoaSequence, moaScenes } from './MoaSequence';
import './moaCompanion.css';
import { useMoaCatalog } from './moa/useMoaCatalog';
import { MoaCatalogSequence } from './moa/MoaCatalogSequence';
import type { MoaCatalogScene } from './moa/moaCatalog';

const gestures = moaScenes;
type Gesture = string;

/** Optional decoration. No clinical data, auth or patient context enters this component. */
const MoaCompanion = () => {
  const catalog = useMoaCatalog();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [selected, setSelected] = useState<MoaCatalogScene | null>(null);
  const libraryButton = useRef<HTMLButtonElement>(null);
  const choices =
    catalog?.scenes || gestures.map(id => ({ id, title: id, category: 'Originales' }));
  const [gesture, setGesture] = useState<Gesture>('welcome');
  const [hidden, setHidden] = useState(() => document.hidden);
  const [playbackId, setPlaybackId] = useState(0);
  const nextGesture = useRef(0);
  const sceneChoice = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (libraryOpen) sceneChoice.current?.focus();
  }, [libraryOpen]);
  const scene = gesture === 'welcome' ? 'wave' : moaScenes.find(name => name === gesture);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const play = () => {
    const choice = choices[nextGesture.current++ % choices.length];
    setSelected(catalog?.scenes.find(item => item.id === choice.id) || null);
    setGesture(choice.id);
    setPlaybackId(value => value + 1);
  };
  const notice = () => {
    if (gesture === 'idle') {
      setSelected(null);
      setGesture('curious');
    }
  };
  return (
    <section
      id="census-moa"
      aria-label="Moa"
      className="moa-companion print:hidden"
      data-paused={hidden}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (libraryOpen) {
            setLibraryOpen(false);
            libraryButton.current?.focus();
          } else hideMoaAndRestoreFocus();
        }
      }}
    >
      <div className="moa-controls">
        <button
          ref={libraryButton}
          type="button"
          aria-label="Elegir animación de Moa"
          title={`${choices.length} animaciones`}
          aria-expanded={libraryOpen}
          aria-controls="moa-library"
          onClick={() => setLibraryOpen(value => !value)}
        >
          <Library size={12} />
        </button>
        <button
          type="button"
          aria-label="Ocultar Moa"
          title="Ocultar Moa"
          onClick={hideMoaAndRestoreFocus}
        >
          <X size={12} />
        </button>
      </div>
      {libraryOpen && (
        <div id="moa-library" className="moa-library" role="dialog" aria-label="Biblioteca de Moa">
          <label htmlFor="moa-scene-choice">{choices.length} animaciones</label>
          <select
            ref={sceneChoice}
            id="moa-scene-choice"
            aria-label="Animación de Moa"
            size={8}
            value={gesture === 'idle' || gesture === 'welcome' ? '' : gesture}
            onChange={event => {
              const id = event.target.value;
              setSelected(catalog?.scenes.find(item => item.id === id) || null);
              setGesture(id);
              setPlaybackId(value => value + 1);
              setLibraryOpen(false);
              libraryButton.current?.focus();
            }}
          >
            {choices.map(item => (
              <option key={item.id} value={item.id}>
                {item.category} · {item.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <button
        type="button"
        className="moa-character"
        aria-label="Jugar con Moa"
        title="Moa · Tócame para jugar"
        data-gesture={gesture}
        onClick={play}
        onPointerEnter={notice}
        onFocus={notice}
      >
        {selected && gesture !== 'idle' ? (
          <MoaCatalogSequence
            key={`${gesture}:${playbackId}`}
            scene={selected}
            paused={hidden}
            onComplete={() => setGesture('idle')}
          />
        ) : scene ? (
          <MoaSequence
            key={`${gesture}:${playbackId}`}
            scene={scene}
            onComplete={() => setGesture('idle')}
          />
        ) : (
          <MoaMascot className="h-[84px] w-36" />
        )}
      </button>
    </section>
  );
};

export default MoaCompanion;
