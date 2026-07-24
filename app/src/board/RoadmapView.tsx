import { component, type Define } from 'sigx';
import type { BoardConfig } from '@pulse/db';
import type { GitHubIssue } from '@pulse/github';
import {
    ROADMAP_SLOTS, isMilestoneCycle, roadmapEndFraction, roadmapSlot,
    roadmapWindowStart, statusOf, type BoardCycle
} from './derive';
import { dateRange, monthDay } from './format';

type RoadmapViewProps =
    /** The working set AFTER the chrome filters (BoardPage applies them) —
     *  bar labels/progress count the FILTERED issues per cycle. */
    Define.Prop<'issues', GitHubIssue[], true> &
    Define.Prop<'config', BoardConfig, true> &
    /** Cycles from the repo's milestones (derive.cyclesFrom, due-date order). */
    Define.Prop<'cycles', BoardCycle[], true> &
    Define.Prop<'loading', boolean>;

/** Bar hue per cycle state (handoff §6): active violet, done green,
 *  planned blue — hard-coded design hues, not the tunable accent. */
const STATE_HUE: Record<BoardCycle['state'], number> = { active: 285, done: 150, planned: 210 };

const DAY = 86_400_000;

/**
 * The Roadmap view (handoff §6): a 150px/1fr gantt over the rolling
 * 12-week window — 6 week markers up top, one 52px row per cycle (name +
 * date range left, timeline track right). The track paints the 6-column
 * vertical grid rule via a repeating linear-gradient; each cycle renders
 * an absolutely-positioned bar at its 2-week slot with an inner done/total
 * progress fill, tinted by state. Milestone-style cycles (no issues on the
 * milestone — v3.0) render as the narrow red due-date marker instead.
 * Cycles outside the window keep their label row but paint nothing on the
 * track (derive.roadmapSlot answers null).
 */
export const RoadmapView = component<RoadmapViewProps>(({ props }) => () => {
    const cycles = props.cycles;
    if (cycles.length === 0) {
        return (
            <div class="flex h-full items-center justify-center">
                <span class="text-[11.5px] text-tf">
                    {props.loading ? 'Loading cycles…' : 'No cycles — milestones with due dates appear here'}
                </span>
            </div>
        );
    }
    const windowStart = roadmapWindowStart();
    const weeks = Array.from({ length: ROADMAP_SLOTS }, (_, k) =>
        monthDay(windowStart.getTime() + k * 14 * DAY));
    return (
        <div data-roadmap-view class="h-full overflow-auto px-[22px] py-5">
            <div class="grid min-w-[720px] grid-cols-[150px_1fr]">
                <div />
                <div class="mb-1.5 grid grid-cols-6 border-b border-bd pb-2">
                    {weeks.map((w) => (
                        <span key={w} class="font-mono text-[10.5px] text-tf">{w}</span>
                    ))}
                </div>
            </div>
            {cycles.map((c) => {
                const milestone = isMilestoneCycle(c);
                // Working-set counts, not the milestone's own totals — the
                // bar reflects what the board actually tracks (and follows
                // the live filters); an issue-less cycle reads "planned"
                // (prototype behavior).
                const inCycle = props.issues.filter((i) => i.milestone?.number === c.number);
                const done = inCycle.filter((i) => statusOf(i, props.config) === 'done').length;
                const hue = STATE_HUE[c.state];
                const slot = roadmapSlot(c, windowStart);
                const frac = roadmapEndFraction(c, windowStart);
                const progress = c.state === 'done'
                    ? 100
                    : inCycle.length === 0 ? 0 : Math.round((done / inCycle.length) * 100);
                return (
                    <div
                        key={c.number}
                        data-roadmap-row={c.number}
                        class="grid h-[52px] min-w-[720px] grid-cols-[150px_1fr] items-center"
                    >
                        <div class="flex flex-col pr-3.5 leading-[1.2]">
                            <span class={'text-[12.5px] font-semibold ' + (c.state === 'active' ? 'text-tx' : 'text-tm')}>
                                {c.title}
                            </span>
                            <span class="text-[10.5px] text-tf">
                                {milestone ? `Milestone · ${monthDay(c.end)}` : dateRange(c.start, c.end)}
                            </span>
                        </div>
                        <div
                            class="relative h-full"
                            style="background:linear-gradient(90deg,var(--color-bd) 1px,transparent 1px);background-size:16.666% 100%"
                        >
                            {milestone
                                ? frac !== null && (
                                    <div
                                        data-roadmap-marker={c.number}
                                        title={`${c.title} · ${monthDay(c.end)}`}
                                        class="absolute top-1/2 h-[30px] w-[10px] -translate-y-1/2 rounded-lg"
                                        style={`left:calc(${(frac * 100).toFixed(3)}% - 5px);background:oklch(0.65 0.19 25)`}
                                    />
                                )
                                : slot !== null && (
                                    <div
                                        data-roadmap-bar={c.number}
                                        class="absolute top-1/2 flex h-[30px] -translate-y-1/2 items-center overflow-hidden rounded-lg border px-2.5"
                                        style={
                                            `left:${((slot * 100) / ROADMAP_SLOTS).toFixed(3)}%;width:15%;` +
                                            `background:oklch(0.6 0.13 ${hue} / ${c.state === 'active' ? 0.2 : 0.14});` +
                                            `border-color:oklch(0.6 0.13 ${hue} / 0.4)`
                                        }
                                    >
                                        <div
                                            class="absolute inset-y-0 left-0"
                                            style={`width:${progress}%;background:oklch(0.6 0.13 ${hue} / 0.5)`}
                                        />
                                        <span
                                            class="relative whitespace-nowrap font-mono text-[11px] font-semibold"
                                            style={`color:oklch(0.9 0.06 ${hue})`}
                                        >
                                            {inCycle.length > 0 ? `${done}/${inCycle.length}` : 'planned'}
                                        </span>
                                    </div>
                                )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}, { name: 'RoadmapView' });
