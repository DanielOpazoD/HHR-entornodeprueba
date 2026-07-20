// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/hhr-ui.js';

type Controller = {
  closeMenu: (restoreFocus?: boolean) => void;
  scheduleIdle: () => void;
  setActive: (module: string) => void;
  setCollapsed: (collapsed: boolean, persist?: boolean) => void;
};

const ui = () =>
  (
    globalThis as unknown as {
      HhrUI: {
        createOperationsBarController: (options: Record<string, unknown>) => Controller;
        enableRovingFocus: (root: ShadowRoot) => void;
      };
    }
  ).HhrUI;

const makeBar = (storedCollapsed = false, deferRestore = false) => {
  const host = document.createElement('aside');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <button class="brand"></button>
    <div class="modules"><button class="module hhr-ops-recipes"></button>
      <button class="module hhr-ops-exams" aria-expanded="false"></button>
      <button class="module hhr-ops-favorites"></button></div>
    <button class="session hhr-ops-session"></button><button class="collapse"></button>
    <div class="exams-menu" hidden><button role="menuitem" data-module="lab">Lab</button>
      <button role="menuitem" data-module="imaging">Imágenes</button></div>`;
  document.body.appendChild(host);
  const stored: boolean[] = [];
  const selected: string[] = [];
  const opened = vi.fn();
  let restore = () => {};
  const controller = ui().createOperationsBarController({
    root,
    host,
    onOpenBrand: opened,
    onExamSelect: (module: string) => selected.push(module),
    storageArea: {
      get: (_key: string, callback: (value: object) => void) => {
        restore = () => callback({ hhrOperationsBarCollapsed: storedCollapsed });
        if (!deferRestore) restore();
      },
      set: (value: { hhrOperationsBarCollapsed: boolean }) =>
        stored.push(value.hhrOperationsBarCollapsed),
    },
  });
  ui().enableRovingFocus(root);
  return { host, root, controller, stored, selected, opened, restore: () => restore() };
};

describe('HHR operations bar UI controller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('restores collapse and expands from the logo without opening the center', () => {
    const { host, root, stored, opened } = makeBar(true);
    expect(host.classList.contains('is-collapsed')).toBe(true);
    (root.querySelector('.brand') as HTMLButtonElement).click();
    expect(host.classList.contains('is-collapsed')).toBe(false);
    expect(stored).toEqual([false]);
    expect(opened).not.toHaveBeenCalled();
    (root.querySelector('.brand') as HTMLButtonElement).click();
    expect(opened).toHaveBeenCalledOnce();
  });

  it('does not let a late preference restore overwrite an immediate brand action', () => {
    const { host, root, opened, restore } = makeBar(true, true);
    (root.querySelector('.brand') as HTMLButtonElement).click();
    expect(opened).not.toHaveBeenCalled();
    restore();
    expect(host.classList.contains('is-collapsed')).toBe(false);
    expect(opened).not.toHaveBeenCalled();
  });

  it('opens Exámenes by keyboard, routes the choice and returns focus on Escape', () => {
    const { root, selected } = makeBar();
    const trigger = root.querySelector('.hhr-ops-exams') as HTMLButtonElement;
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(root.activeElement?.getAttribute('data-module')).toBe('lab');
    root.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(root.activeElement).toBe(trigger);
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(root.activeElement?.getAttribute('data-module')).toBe('lab');
    root.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    trigger.click();
    (root.querySelector('[data-module="imaging"]') as HTMLButtonElement).click();
    expect(selected).toEqual(['imaging']);
    trigger.click();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the mobile control within the viewport by hiding secondary actions', () => {
    const styles = (globalThis as unknown as { HhrUI: { barCss: string } }).HhrUI.barCss;
    expect(styles).toContain('@media(max-width:560px)');
    expect(styles).toContain('.session,.hhr-ops-favorites{display:none}');
    expect(styles).toContain('@media(max-width:340px)');
    expect(styles).toContain('.module{width:28px;padding:0 5px}');
  });

  it('skips responsive-hidden controls during roving keyboard focus', () => {
    const { root } = makeBar();
    const exams = root.querySelector('.hhr-ops-exams') as HTMLButtonElement;
    (root.querySelector('.hhr-ops-favorites') as HTMLButtonElement).style.display = 'none';
    (root.querySelector('.session') as HTMLButtonElement).style.display = 'none';
    exams.focus();
    exams.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(root.activeElement).toBe(root.querySelector('.collapse'));
  });

  it('suspends roving focus while the bar is collapsed', () => {
    const { root, controller } = makeBar();
    const brand = root.querySelector('.brand') as HTMLButtonElement;
    controller.setCollapsed(true, false);
    brand.focus();
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    brand.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(root.activeElement).toBe(brand);
  });

  it('skips a disabled laboratory item and maps both exam modules to one active button', () => {
    const { root, controller, selected } = makeBar();
    const lab = root.querySelector('[data-module="lab"]') as HTMLButtonElement;
    lab.setAttribute('aria-disabled', 'true');
    lab.click();
    expect(selected).toEqual([]);
    (root.querySelector('.hhr-ops-exams') as HTMLButtonElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );
    expect(root.activeElement?.getAttribute('data-module')).toBe('imaging');
    controller.setActive('lab');
    expect(root.querySelector('.hhr-ops-exams')?.classList.contains('is-active')).toBe(true);
    controller.setActive('recipes');
    expect(root.querySelector('.hhr-ops-recipes')?.classList.contains('is-active')).toBe(true);
    controller.setActive('connection');
    expect(root.querySelector('.session')?.classList.contains('is-active')).toBe(true);
    expect(root.querySelector('.session')?.getAttribute('aria-current')).toBe('page');
    controller.setActive('recipes');
    expect(root.querySelector('.session')?.classList.contains('is-active')).toBe(false);
    expect(root.querySelector('.session')?.hasAttribute('aria-current')).toBe(false);
    controller.setActive('connection');
    const collapse = root.querySelector('.collapse') as HTMLButtonElement;
    collapse.focus();
    collapse.click();
    expect(root.activeElement).toBe(root.querySelector('.brand'));
  });

  it('dims only while idle and never when the connection is offline', () => {
    const { host, root, controller } = makeBar();
    vi.advanceTimersByTime(4000);
    expect(host.classList.contains('is-idle')).toBe(true);
    host.dispatchEvent(new Event('pointerenter'));
    expect(host.classList.contains('is-idle')).toBe(false);
    root.querySelector('.session')?.classList.add('is-offline');
    controller.scheduleIdle();
    vi.advanceTimersByTime(4000);
    expect(host.classList.contains('is-idle')).toBe(false);
  });
});
