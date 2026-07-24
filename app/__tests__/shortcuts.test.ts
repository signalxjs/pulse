/**
 * The keyboard dispatcher (board/shortcuts.ts) — pure decisions: modifier
 * handling, the Esc close-priority chain, and the typing-context
 * suppression rules (handoff §Interactions: everything ignored while
 * typing EXCEPT ⌘K and Esc).
 */
import { describe, it, expect } from 'vitest';
import { shortcutAction, type ShortcutModifiers, type ShortcutUiState } from '../src/board/shortcuts';

const none: ShortcutModifiers = { meta: false, ctrl: false, alt: false, shift: false };
const idle: ShortcutUiState = {
    typing: false, paletteOpen: false, newIssueOpen: false, detailOpen: false, navOpen: false
};

describe('shortcutAction', () => {
    it('⌘K / Ctrl+K toggles the palette', () => {
        expect(shortcutAction('k', { ...none, meta: true }, idle)).toEqual({ type: 'toggle-palette' });
        expect(shortcutAction('k', { ...none, ctrl: true }, idle)).toEqual({ type: 'toggle-palette' });
        expect(shortcutAction('K', { ...none, meta: true }, idle)).toEqual({ type: 'toggle-palette' });
        // A bare 'k' is nothing.
        expect(shortcutAction('k', none, idle)).toBeNull();
    });

    it('⌘K works even while typing (the palette-input case)', () => {
        expect(shortcutAction('k', { ...none, meta: true }, { ...idle, typing: true, paletteOpen: true }))
            .toEqual({ type: 'toggle-palette' });
    });

    it('Esc closes by priority: palette > new-issue > detail > nav', () => {
        const all = { typing: false, paletteOpen: true, newIssueOpen: true, detailOpen: true, navOpen: true };
        expect(shortcutAction('Escape', none, all)).toEqual({ type: 'close-palette' });
        expect(shortcutAction('Escape', none, { ...all, paletteOpen: false })).toEqual({ type: 'close-new-issue' });
        expect(shortcutAction('Escape', none, { ...all, paletteOpen: false, newIssueOpen: false }))
            .toEqual({ type: 'close-detail' });
        expect(shortcutAction('Escape', none, { ...idle, navOpen: true })).toEqual({ type: 'close-nav' });
        expect(shortcutAction('Escape', none, idle)).toBeNull();
    });

    it('Esc works while typing (closing from inside an input)', () => {
        expect(shortcutAction('Escape', none, { ...idle, typing: true, detailOpen: true }))
            .toEqual({ type: 'close-detail' });
    });

    it("'/' focuses the filter — unless typing", () => {
        expect(shortcutAction('/', none, idle)).toEqual({ type: 'focus-filter' });
        expect(shortcutAction('/', none, { ...idle, typing: true })).toBeNull();
    });

    it('digits 1–5 map to the views in VIEWS order', () => {
        expect(shortcutAction('1', none, idle)).toEqual({ type: 'go-view', view: 'board' });
        expect(shortcutAction('2', none, idle)).toEqual({ type: 'go-view', view: 'list' });
        expect(shortcutAction('3', none, idle)).toEqual({ type: 'go-view', view: 'roadmap' });
        expect(shortcutAction('4', none, idle)).toEqual({ type: 'go-view', view: 'sprint' });
        expect(shortcutAction('5', none, idle)).toEqual({ type: 'go-view', view: 'backlog' });
        expect(shortcutAction('6', none, idle)).toBeNull();
        expect(shortcutAction('1', none, { ...idle, typing: true })).toBeNull();
    });

    it("'c' opens the new-issue modal — but never while typing or with modifiers", () => {
        expect(shortcutAction('c', none, idle)).toEqual({ type: 'new-issue' });
        expect(shortcutAction('C', { ...none, shift: true }, idle)).toEqual({ type: 'new-issue' });
        expect(shortcutAction('c', none, { ...idle, typing: true })).toBeNull();
        // ⌘C is COPY — the dispatcher must not hijack it.
        expect(shortcutAction('c', { ...none, meta: true }, idle)).toBeNull();
        expect(shortcutAction('c', { ...none, ctrl: true }, idle)).toBeNull();
        expect(shortcutAction('c', { ...none, alt: true }, idle)).toBeNull();
    });

    it('modified digits pass through (⌘1 is a browser tab switch)', () => {
        expect(shortcutAction('1', { ...none, meta: true }, idle)).toBeNull();
        expect(shortcutAction('1', { ...none, alt: true }, idle)).toBeNull();
    });
});
