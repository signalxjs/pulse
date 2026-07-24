/**
 * Global keyboard shortcuts (handoff §Interactions, pulse#54) — the PURE
 * decision function. BoardPage owns the single window keydown listener and
 * executes whatever this returns; keeping the decision separate from the
 * DOM is what makes the priority/suppression rules unit-testable.
 *
 * Rules:
 *   ⌘K / Ctrl+K   toggle the command palette (works while typing)
 *   Esc           close palette > new-issue > detail > nav (first open
 *                 wins; works while typing)
 *   /             focus the header filter input
 *   1–5           switch views (VIEWS order)
 *   c             open the new-issue modal
 * Everything below Esc is ignored while an input/textarea/select/
 * contentEditable has focus, and whenever meta/ctrl/alt is held (never
 * hijack ⌘C, ⌘1, Alt+digit …).
 */
import { VIEWS, type ViewKey } from './views';

export interface ShortcutModifiers {
    meta: boolean;
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
}

/** What the dispatcher needs to know about the moment the key landed. */
export interface ShortcutUiState {
    /** An input/textarea/select/contentEditable has focus. */
    typing: boolean;
    paletteOpen: boolean;
    newIssueOpen: boolean;
    detailOpen: boolean;
    navOpen: boolean;
}

export type ShortcutAction =
    | { type: 'toggle-palette' }
    | { type: 'close-palette' }
    | { type: 'close-new-issue' }
    | { type: 'close-detail' }
    | { type: 'close-nav' }
    | { type: 'focus-filter' }
    | { type: 'go-view'; view: ViewKey }
    | { type: 'new-issue' };

/** Decide what one keydown means — or null (let the browser have it). */
export function shortcutAction(
    key: string,
    mods: ShortcutModifiers,
    ui: ShortcutUiState
): ShortcutAction | null {
    if ((mods.meta || mods.ctrl) && key.toLowerCase() === 'k') {
        return { type: 'toggle-palette' };
    }
    if (key === 'Escape') {
        if (ui.paletteOpen) return { type: 'close-palette' };
        if (ui.newIssueOpen) return { type: 'close-new-issue' };
        if (ui.detailOpen) return { type: 'close-detail' };
        if (ui.navOpen) return { type: 'close-nav' };
        return null;
    }
    if (ui.typing || mods.meta || mods.ctrl || mods.alt) return null;
    if (key === '/') return { type: 'focus-filter' };
    const view = VIEWS.find((v) => v.kbd === key);
    if (view) return { type: 'go-view', view: view.key };
    if (key.toLowerCase() === 'c') return { type: 'new-issue' };
    return null;
}

/** The listener-side typing probe (kept here so tests and the wiring agree
 *  on what counts as "typing"). */
export function isTypingTarget(target: EventTarget | null): boolean {
    if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
