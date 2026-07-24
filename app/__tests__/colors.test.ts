import { describe, it, expect } from 'vitest';
import { labelStyle, avatarColor, hexToOklchHue, oklchToHex, personHue, STATUSES, PRIORITIES } from '../src/board/colors';

describe('labelStyle', () => {
    it('applies the handoff tint formula for a hue', () => {
        expect(labelStyle(25)).toEqual({
            bg: 'oklch(0.62 0.14 25 / 0.15)',
            fg: 'oklch(0.82 0.11 25)',
            bd: 'oklch(0.62 0.14 25 / 0.30)',
            dot: 'oklch(0.62 0.14 25)'
        });
    });

    it('varies only the hue across labels', () => {
        const a = labelStyle(150);
        const b = labelStyle(285);
        expect(a.bg.replace('150', 'H')).toBe(b.bg.replace('285', 'H'));
    });
});

describe('avatarColor', () => {
    it('uses the handoff avatar formula', () => {
        expect(avatarColor(200)).toBe('oklch(0.58 0.14 200)');
    });
});

describe('status/priority maps', () => {
    it('carries the five statuses in board-column order', () => {
        expect(STATUSES.map((s) => s.id)).toEqual(['backlog', 'todo', 'inprogress', 'inreview', 'done']);
        expect(STATUSES.find((s) => s.id === 'done')?.dot).toBe('oklch(0.68 0.14 150)');
    });

    it('maps P0–P3 with P0 urgent red and P3 faint', () => {
        expect(PRIORITIES.map((p) => p.label)).toEqual(['P0', 'P1', 'P2', 'P3']);
        expect(PRIORITIES[0]?.color).toBe('oklch(0.65 0.19 25)');
        expect(PRIORITIES[3]?.color).toBe('var(--color-tf)');
    });
});

describe('hexToOklchHue', () => {
    // Reference values from the OKLab reference implementation (Ottosson):
    // pure sRGB red/green/blue land at ≈29.23°, ≈142.50°, ≈264.05°.
    it('converts pure red to ≈29°', () => {
        expect(hexToOklchHue('#ff0000')).toBeCloseTo(29.23, 1);
    });

    it('converts pure green to ≈142°', () => {
        expect(hexToOklchHue('#00ff00')).toBeCloseTo(142.5, 1);
    });

    it('converts pure blue to ≈264°', () => {
        expect(hexToOklchHue('#0000ff')).toBeCloseTo(264.05, 1);
    });

    it('handles GitHub label colors (with or without #, short form)', () => {
        // GitHub's default "bug" label color.
        const bug = hexToOklchHue('d73a4a');
        expect(bug).not.toBeNull();
        expect(bug!).toBeGreaterThan(10);
        expect(bug!).toBeLessThan(40);
        // #f00 expands to #ff0000.
        expect(hexToOklchHue('#f00')).toBeCloseTo(hexToOklchHue('#ff0000')!, 6);
    });

    it('returns null for achromatic colors', () => {
        expect(hexToOklchHue('#000000')).toBeNull();
        expect(hexToOklchHue('#ffffff')).toBeNull();
        expect(hexToOklchHue('#808080')).toBeNull();
    });

    it('throws on malformed input', () => {
        expect(() => hexToOklchHue('nope')).toThrow(TypeError);
        expect(() => hexToOklchHue('#12345')).toThrow(TypeError);
        expect(() => hexToOklchHue('')).toThrow(TypeError);
    });

    it('stays within [0, 360)', () => {
        for (const hex of ['#ff0000', '#00ff88', '#123456', '#abcdef', '#d73a4a']) {
            const hue = hexToOklchHue(hex);
            expect(hue).not.toBeNull();
            expect(hue!).toBeGreaterThanOrEqual(0);
            expect(hue!).toBeLessThan(360);
        }
    });
});

describe('oklchToHex', () => {
    it('round-trips the design hues through hexToOklchHue (label dot formula)', () => {
        for (const hue of [25, 65, 150, 210, 250, 285]) {
            const hex = oklchToHex(0.62, 0.14, hue);
            expect(hex).toMatch(/^[0-9a-f]{6}$/);
            const back = hexToOklchHue(hex);
            expect(back).not.toBeNull();
            // Gamut clipping shifts the hue a touch — a few degrees is fine
            // for label colors.
            const delta = Math.abs(back! - hue);
            expect(Math.min(delta, 360 - delta)).toBeLessThan(8);
        }
    });

    it('emits GitHub label form: six lowercase hex digits, no #', () => {
        expect(oklchToHex(0.62, 0.14, 250)).toMatch(/^[0-9a-f]{6}$/);
    });

    it('clamps out-of-gamut requests instead of overflowing', () => {
        expect(oklchToHex(1.2, 0.4, 150)).toMatch(/^[0-9a-f]{6}$/);
        expect(oklchToHex(-0.5, 0.4, 150)).toMatch(/^[0-9a-f]{6}$/);
    });
});

describe('personHue', () => {
    it('is deterministic and in [0, 360)', () => {
        for (const login of ['rin', 'mira', 'devon', 'sana', 'lee', 'octocat-42']) {
            const hue = personHue(login);
            expect(hue).toBe(personHue(login));
            expect(hue).toBeGreaterThanOrEqual(0);
            expect(hue).toBeLessThan(360);
        }
    });

    it('separates nearby logins', () => {
        expect(personHue('mira')).not.toBe(personHue('mirb'));
    });
});
