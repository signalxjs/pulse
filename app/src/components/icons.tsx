/**
 * Pulse's icon set — the handoff's tiny inline SVGs (simple rects, lines,
 * circles) drawn as components. All render 16×16 (13×13 for the type
 * glyphs), stroke/fill `currentColor` so the surrounding text color tints
 * them (e.g. the accent on the active view).
 */
import { component } from 'sigx';

const FILLED = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'currentColor' };
const STROKED = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const
};

/** Board — three kanban bars. */
export const IconBoard = component(() => () => (
    <svg {...FILLED}>
        <rect x={2} y={2.5} width={3.2} height={11} rx={1} />
        <rect x={6.4} y={2.5} width={3.2} height={7} rx={1} />
        <rect x={10.8} y={2.5} width={3.2} height={9} rx={1} />
    </svg>
), { name: 'IconBoard' });

/** List — three full-width lines. */
export const IconList = component(() => () => (
    <svg {...STROKED}>
        <line x1={2} y1={4} x2={14} y2={4} />
        <line x1={2} y1={8} x2={14} y2={8} />
        <line x1={2} y1={12} x2={14} y2={12} />
    </svg>
), { name: 'IconList' });

/** Roadmap — offset gantt bars. */
export const IconRoadmap = component(() => () => (
    <svg {...FILLED}>
        <rect x={2} y={3} width={7} height={2.6} rx={1} />
        <rect x={5} y={7} width={8} height={2.6} rx={1} />
        <rect x={3} y={11} width={6} height={2.6} rx={1} />
    </svg>
), { name: 'IconRoadmap' });

/** Sprint — a target. */
export const IconSprint = component(() => () => (
    <svg {...STROKED}>
        <circle cx={8} cy={8} r={5.4} />
        <circle cx={8} cy={8} r={1.6} fill="currentColor" stroke="none" />
    </svg>
), { name: 'IconSprint' });

/** Backlog — dotted lines. */
export const IconBacklog = component(() => () => (
    <svg {...STROKED}>
        <circle cx={3.4} cy={4} r={1.4} fill="currentColor" stroke="none" />
        <line x1={6.5} y1={4} x2={14} y2={4} />
        <circle cx={3.4} cy={8} r={1.4} fill="currentColor" stroke="none" />
        <line x1={6.5} y1={8} x2={14} y2={8} />
        <circle cx={3.4} cy={12} r={1.4} fill="currentColor" stroke="none" />
        <line x1={6.5} y1={12} x2={14} y2={12} />
    </svg>
), { name: 'IconBacklog' });

/** Issue — target circle (13×13, the card/type size). */
export const IconIssue = component(() => () => (
    <svg width={13} height={13} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7}>
        <circle cx={8} cy={8} r={6} />
        <circle cx={8} cy={8} r={1.7} fill="currentColor" stroke="none" />
    </svg>
), { name: 'IconIssue' });

/** Pull request — branch glyph (13×13). */
export const IconPr = component(() => () => (
    <svg width={13} height={13} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round">
        <circle cx={4} cy={4} r={1.8} />
        <circle cx={4} cy={12} r={1.8} />
        <circle cx={12} cy={12} r={1.8} />
        <line x1={4} y1={5.8} x2={4} y2={10.2} />
        <path d="M12 10.2V8.5C12 7 11 6 9.5 6H7" />
    </svg>
), { name: 'IconPr' });

/** Magnifier — search affordances (13×13). */
export const IconSearch = component(() => () => (
    <svg width={13} height={13} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
        <circle cx={7} cy={7} r={4.6} />
        <line x1={10.6} y1={10.6} x2={14} y2={14} />
    </svg>
), { name: 'IconSearch' });

/** Repository — rounded-square outline. */
export const IconRepo = component(() => () => (
    <svg {...STROKED}>
        <rect x={2.5} y={2.5} width={11} height={11} rx={3} />
    </svg>
), { name: 'IconRepo' });
