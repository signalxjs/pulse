import { describe, it, expect, beforeEach } from 'vitest';
import { useBoardUiStore, DEFAULT_ACCENT_HUE } from '../src/stores/boardUi';

/** Let the persist watcher's write flush (debounce 0 = next change flush). */
const tick = () => new Promise((r) => setTimeout(r, 20));

describe('boardUi store', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('defaults per the handoff tweak props', async () => {
        const ui = useBoardUiStore();
        try {
            expect(ui.query).toBe('');
            expect(ui.filterLabel).toBeNull();
            expect(ui.navOpen).toBe(false);
            expect(ui.density).toBe('cozy');
            expect(ui.accentHue).toBe(DEFAULT_ACCENT_HUE);
        } finally {
            ui.$dispose();
        }
    });

    it('toggles the single active label filter', () => {
        const ui = useBoardUiStore();
        try {
            ui.toggleFilterLabel('bug');
            expect(ui.filterLabel).toBe('bug');
            ui.toggleFilterLabel('feature');
            expect(ui.filterLabel).toBe('feature');
            ui.toggleFilterLabel('feature');
            expect(ui.filterLabel).toBeNull();
            ui.toggleFilterLabel('docs');
            ui.clearFilter();
            expect(ui.filterLabel).toBeNull();
        } finally {
            ui.$dispose();
        }
    });

    it('persists ONLY density + accentHue, and rehydrates them into a fresh instance', async () => {
        const first = useBoardUiStore();
        await first.whenHydrated;
        first.setQuery('secret search');
        first.toggleFilterLabel('bug');
        first.setDensity('compact');
        first.setAccentHue(150);
        await tick();
        first.$dispose();

        const raw = localStorage.getItem('pulse:boardUi');
        expect(raw).not.toBeNull();
        expect(raw!).toContain('compact');
        expect(raw!).toContain('150');
        // Filters are per-visit — never persisted.
        expect(raw!).not.toContain('secret search');
        expect(raw!).not.toContain('bug');

        // Roundtrip: a fresh instance hydrates the persisted tweaks and
        // keeps the per-visit state at defaults.
        const second = useBoardUiStore();
        try {
            await second.whenHydrated;
            expect(second.density).toBe('compact');
            expect(second.accentHue).toBe(150);
            expect(second.query).toBe('');
            expect(second.filterLabel).toBeNull();
        } finally {
            second.$dispose();
        }
    });

    it('normalizes accentHue into [0, 360)', () => {
        const ui = useBoardUiStore();
        try {
            ui.setAccentHue(-75);
            expect(ui.accentHue).toBe(285);
            ui.setAccentHue(360);
            expect(ui.accentHue).toBe(0);
            ui.setAccentHue(390);
            expect(ui.accentHue).toBe(30);
        } finally {
            ui.$dispose();
        }
    });
});
