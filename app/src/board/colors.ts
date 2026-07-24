/**
 * Semantic color helpers — the handoff's oklch formulas as pure functions
 * (design_handoff_pulse_planner §Design Tokens). Everything hue-driven
 * (labels, avatars, statuses, priorities) derives from these so the whole
 * board stays at consistent chroma/lightness while hue varies.
 */

/** The pill/dot styling for one label hue (handoff label token formula). */
export interface LabelStyle {
    /** Pill background — `oklch(0.62 0.14 <hue> / 0.15)`. */
    bg: string;
    /** Pill text — `oklch(0.82 0.11 <hue>)`. */
    fg: string;
    /** Pill border — `oklch(0.62 0.14 <hue> / 0.30)`. */
    bd: string;
    /** Solid dot — `oklch(0.62 0.14 <hue>)`. */
    dot: string;
}

/** Tint a label pill from its hue (0–360). */
export function labelStyle(hue: number): LabelStyle {
    return {
        bg: `oklch(0.62 0.14 ${hue} / 0.15)`,
        fg: `oklch(0.82 0.11 ${hue})`,
        bd: `oklch(0.62 0.14 ${hue} / 0.30)`,
        dot: `oklch(0.62 0.14 ${hue})`
    };
}

/** Avatar fill for a person hue — `oklch(0.58 0.14 <hue>)`. */
export function avatarColor(hue: number): string {
    return `oklch(0.58 0.14 ${hue})`;
}

/** One of the five card statuses, in board-column order. */
export interface StatusMeta {
    id: 'backlog' | 'todo' | 'inprogress' | 'inreview' | 'done';
    name: string;
    /** Status dot / accent color. */
    dot: string;
}

/** Statuses & order: Backlog · Todo · In Progress · In Review · Done. */
export const STATUSES: readonly StatusMeta[] = [
    { id: 'backlog', name: 'Backlog', dot: 'var(--color-tf)' },
    { id: 'todo', name: 'Todo', dot: 'oklch(0.7 0.11 250)' },
    { id: 'inprogress', name: 'In Progress', dot: 'oklch(0.74 0.15 65)' },
    { id: 'inreview', name: 'In Review', dot: 'oklch(0.7 0.12 210)' },
    { id: 'done', name: 'Done', dot: 'oklch(0.68 0.14 150)' }
];

/** Priority label + color, indexed by priority 0–3 (P0 urgent … P3 low). */
export interface PriorityMeta {
    label: string;
    color: string;
}

export const PRIORITIES: readonly PriorityMeta[] = [
    { label: 'P0', color: 'oklch(0.65 0.19 25)' },
    { label: 'P1', color: 'oklch(0.74 0.15 65)' },
    { label: 'P2', color: 'oklch(0.72 0.11 250)' },
    { label: 'P3', color: 'var(--color-tf)' }
];

/**
 * OKLCh hue (degrees, [0, 360)) of a sRGB hex color — for deriving the
 * handoff's hue-keyed tints from real GitHub label colors (`#d73a4a` → a
 * hue that feeds labelStyle()). Proper pipeline: hex → linear sRGB → OKLab
 * (Björn Ottosson's reference matrices) → hue = atan2(b, a).
 *
 * Returns null for achromatic colors (greys — hue is meaningless);
 * throws TypeError on malformed input. Accepts #rgb and #rrggbb.
 */
export function hexToOklchHue(hex: string): number | null {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
    if (!m || !m[1]) {
        throw new TypeError(`hexToOklchHue: not a hex color: ${JSON.stringify(hex)}`);
    }
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    const channel = (i: number) => parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255;

    // sRGB transfer function → linear light.
    const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const r = lin(channel(0));
    const g = lin(channel(1));
    const b = lin(channel(2));

    // Linear sRGB → LMS (OKLab reference), then the non-linearity.
    const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

    // LMS′ → OKLab a/b (L is not needed for the hue).
    const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

    // Achromatic: chroma ≈ 0 makes the hue angle numeric noise.
    if (Math.hypot(a, bb) < 1e-4) return null;

    const deg = (Math.atan2(bb, a) * 180) / Math.PI;
    return (deg + 360) % 360;
}
