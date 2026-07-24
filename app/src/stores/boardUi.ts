import { defineStore } from '@sigx/store';
import { persist } from '@sigx/store/persist';

/** Density presets — Cozy 40px rows / 14px base, Compact 34px / 13px. */
export type Density = 'cozy' | 'compact';

/** The handoff's default accent hue (violet). */
export const DEFAULT_ACCENT_HUE = 285;

/**
 * Board-chrome UI state (pulse#39): the filter query + active label the
 * header/filter-bar/sidebar share, the responsive off-canvas nav, and the
 * two tweak props (density, accentHue). Only the tweaks persist — filters
 * are per-visit by design. Persistence is a browser concern: on the server
 * `persist()` is a no-op (no localStorage), so SSR renders the defaults and
 * the client re-applies the saved tweaks right after hydration.
 */
export const useBoardUiStore = defineStore('boardUi', (ctx) => {
    const { state, signals, patch } = ctx.defineState({
        query: '',
        filterLabel: null as string | null,
        navOpen: false,
        density: 'cozy' as Density,
        accentHue: DEFAULT_ACCENT_HUE
    });

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
