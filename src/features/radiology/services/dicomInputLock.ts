const EVENTS = ['wheel', 'pointerdown', 'mousedown', 'touchstart', 'keydown'];

/** Blocks pointer, wheel and keyboard input on the panes while cine or a video owns the view. */
export const lockDicomInput = (elements: HTMLElement[]) => {
  const block = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  elements.forEach(element =>
    EVENTS.forEach(name => element.addEventListener(name, block, { capture: true, passive: false }))
  );
  let locked = true;
  return () => {
    if (!locked) return;
    locked = false;
    elements.forEach(element =>
      EVENTS.forEach(name => element.removeEventListener(name, block, true))
    );
  };
};
