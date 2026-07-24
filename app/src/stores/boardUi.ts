import { defineStore } from '@sigx/store';
import { persist } from '@sigx/store/persist';

/** Density presets — Cozy 40px rows / 14px base, Compact 34px / 13px. */
export type Density = 'cozy' | 'compact';

/** The handoff's default accent hue (violet). */
export const DEFAULT_ACCENT_HUE = 285;

/** One queued toast (handoff §11). */
export interface ToastEntry {
    id: number;
    message: string;
}

/** §11: toasts auto-dismiss after 2s. */
const TOAST_MS = 2000;

/**
 * Board-chrome UI state (pulse#39): the filter query + active label the
 * header/filter-bar/sidebar share, the responsive off-canvas nav, the
 * command palette (pulse#54: visibility + its own query), the toast queue,
 * and the two tweak props (density, accentHue). Only the tweaks persist —
 * filters are per-visit by design. Persistence is a browser concern: on the
 * server `persist()` is a no-op (no localStorage), so SSR renders the
 * defaults and the client re-applies the saved tweaks right after
 * hydration.
 */
export const useBoardUiStore = defineStore('boardUi', (ctx) => {
    const { state, signals, patch } = ctx.defineState({
        query: '',
        filterLabel: null as string | null,
        navOpen: false,
        paletteOpen: false,
        paletteQuery: '',
        toasts: [] as ToastEntry[],
        density: 'cozy' as Density,
        accentHue: DEFAULT_ACCENT_HUE
    });

    /** Monotonic toast ids — per store instance, never reused. */
    let toastSeq = 0;

    const { hydrated, whenHydrated } = persist(ctx, { state, patch }, {
        key: 'pulse:boardUi',
        pick: ['density', 'accentHue']
    });

    const actions = ctx.defineActions({
        setQuery(query: string) {
            patch((s) => {
                s.query = query;
            });
        },
        /** Toggle a single active label filter (click again to clear). */
        toggleFilterLabel(label: string) {
            patch((s) => {
                s.filterLabel = s.filterLabel === label ? null : label;
            });
        },
        clearFilter() {
            patch((s) => {
                s.filterLabel = null;
            });
        },
        setNavOpen(open: boolean) {
            patch((s) => {
                s.navOpen = open;
            });
        },
        /** Open the palette with a FRESH query (prototype behavior). */
        openPalette() {
            patch((s) => {
                s.paletteOpen = true;
                s.paletteQuery = '';
            });
        },
        closePalette() {
            patch((s) => {
                s.paletteOpen = false;
            });
        },
        /** ⌘K — toggles, clearing the query either way. */
        togglePalette() {
            patch((s) => {
                s.paletteOpen = !s.paletteOpen;
                s.paletteQuery = '';
            });
        },
        setPaletteQuery(query: string) {
            patch((s) => {
                s.paletteQuery = query;
            });
        },
        /**
         * Queue a toast (bottom-center stack, §11). Auto-dismisses after 2s
         * — pass `ms` to hold errors longer. The timer is browser-only:
         * toasts never fire during SSR, and a no-window guard keeps the
         * action safe to call anywhere.
         */
        showToast(message: string, ms: number = TOAST_MS) {
            // Browser-only: a toast enqueued under SSR would have no timer to
            // clear it (the queue would stick), and nothing paints it there
            // anyway — so never touch the queue off-window.
            if (typeof window === 'undefined') return;
            const id = ++toastSeq;
            patch((s) => {
                s.toasts = [...s.toasts, { id, message }];
            });
            setTimeout(() => {
                patch((s) => {
                    s.toasts = s.toasts.filter((t) => t.id !== id);
                });
            }, ms);
        },
        setDensity(density: Density) {
            patch((s) => {
                s.density = density;
            });
        },
        setAccentHue(hue: number) {
            patch((s) => {
                s.accentHue = ((hue % 360) + 360) % 360;
            });
        }
    });

    return { ...signals, ...actions, hydrated, whenHydrated };
});
