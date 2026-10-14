import { useEffect, useRef, useState } from 'react';
import { MoaMascot } from '../navbar/MoaMascot';
import { fetchMoaAtlas, type MoaCatalogScene } from './moaCatalog';

export function moaKeyframes(scene: MoaCatalogScene, reduced: boolean): Keyframe[] {
  const duration = scene.durations.reduce((a, b) => a + b, 0);
  let elapsed = 0;
  const frames = scene.durations.map((hold, index) => {
    const frame = {
      offset: elapsed / duration,
      transform: `translateX(${(-100 * (reduced ? scene.still : index)) / scene.frames}%)`,
      easing: 'steps(1, end)',
    };
    elapsed += hold;
    return frame;
  });
  frames.push({ ...frames[frames.length - 1], offset: 1 });
  return frames;
}

export function MoaCatalogSequence({
  scene,
  paused,
  onComplete,
}: {
  scene: MoaCatalogScene;
  paused: boolean;
  onComplete: () => void;
}) {
  const [source, setSource] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const animation = useRef<Animation | null>(null);
  const completed = useRef(false);
  const completion = useRef(onComplete);
  useEffect(() => {
    completion.current = onComplete;
  }, [onComplete]);
  const isPaused = useRef(paused);
  useEffect(() => {
    isPaused.current = paused;
  }, [paused]);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let url: string | null = null;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    void fetchMoaAtlas(scene, controller.signal)
      .then(blob => {
        if (disposed) return;
        url = URL.createObjectURL(blob);
        setSource(url);
      })
      .catch(() => {
        if (!disposed) completion.current();
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timeout);
      if (url) URL.revokeObjectURL(url);
    };
  }, [scene]);
  useEffect(() => {
    if (!ready || !image.current) return;
    const element = image.current;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finish = () => {
      if (!completed.current) {
        completed.current = true;
        completion.current();
      }
    };
    if (typeof element.animate !== 'function') {
      finish();
      return;
    }
    const start = () => {
      const previous = animation.current;
      const time = previous?.currentTime;
      if (previous) {
        previous.onfinish = null;
        previous.cancel();
      }
      const next = element.animate(moaKeyframes(scene, preference.matches), {
        duration: scene.durations.reduce((a, b) => a + b, 0),
        iterations: scene.cycles,
        fill: 'forwards',
      });
      if (typeof time === 'number') next.currentTime = time;
      next.onfinish = finish;
      animation.current = next;
      if (isPaused.current) next.pause();
    };
    start();
    preference.addEventListener('change', start);
    return () => {
      preference.removeEventListener('change', start);
      if (animation.current) {
        animation.current.onfinish = null;
        animation.current.cancel();
        animation.current = null;
      }
    };
  }, [ready, scene]);
  useEffect(() => {
    if (animation.current) {
      if (paused) animation.current.pause();
      else animation.current.play();
    }
  }, [paused]);
  return (
    <span className="moa-sequence" data-moa-scene={scene.id} aria-hidden="true">
      {!ready && (
        <span className="moa-sequence-placeholder">
          <MoaMascot className="h-[84px] w-36" />
        </span>
      )}
      {source && (
        <img
          ref={image}
          src={source}
          alt=""
          draggable={false}
          decoding="async"
          width={scene.frameSize[0] * scene.frames}
          height={scene.frameSize[1]}
          className="moa-catalog-frames"
          data-ready={ready}
          style={{
            width: `${scene.frames * 100}%`,
            imageRendering: scene.renderMode === 'smooth' ? 'auto' : 'pixelated',
          }}
          onLoad={event => {
            const img = event.currentTarget;
            if (
              img.naturalWidth !== scene.frameSize[0] * scene.frames ||
              img.naturalHeight !== scene.frameSize[1]
            )
              completion.current();
            else setReady(true);
          }}
          onError={() => completion.current()}
        />
      )}
    </span>
  );
}
