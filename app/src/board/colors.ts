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
 * Deterministic avatar/person hue from a GitHub login — real GitHub
 * accounts have no design hue, so one is derived stably from the login
 * (same login, same color, every render and every session).
 */
export function personHue(login: string): number {
    let h = 0;
    for (let i = 0; i < login.length; i++) {
        h = (h * 31 + login.charCodeAt(i)) % 360;
    }
    return h;
}

/**
 * sRGB hex (no leading '#', GitHub label form) of an OKLCh color — the
 * inverse of {@link hexToOklchHue}'s pipeline (OKLab reference matrices),
 * for creating REAL GitHub labels in the design system's hues (the label
 * dot formula `oklch(0.62 0.14 <hue>)` → `createLabel` hex). Out-of-gamut
 * channels are clamped — a crude clip, fine at the label chroma.
 */
export function oklchToHex(l: number, c: number, hue: number): string {
    const hr = (hue * Math.PI) / 180;
    const a = c * Math.cos(hr);
    const b = c * Math.sin(hr);

    // OKLab → LMS′ → LMS (cube), then LMS → linear sRGB.
    const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = l - 0.0894841775 * a - 1.2914855480 * b;
    const L = l_ ** 3;
    const M = m_ ** 3;
    const S = s_ ** 3;
    const r = 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
    const g = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
    const bl = -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S;

    // Linear light → sRGB transfer, clamped into gamut, two hex digits.
    const enc = (x: number) => {
        const clamped = Math.min(1, Math.max(0, x));
        const srgb = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
        return Math.round(srgb * 255).toString(16).padStart(2, '0');
    };
    return enc(r) + enc(g) + enc(bl);
}

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
