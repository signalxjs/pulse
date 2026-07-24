import { component, type Define } from 'sigx';
import type { BoardConfig } from '@pulse/db';
import type { GitHubIssue } from '@pulse/github';
import { PRIORITIES } from './colors';
import { currentCycle, priorityOf, sortByPriority, sprintStats, statusOf, type BoardCycle } from './derive';
import { Avatar } from './components/Avatar';
import { dateRange } from './format';

type SprintViewProps =
    /** The working set AFTER the chrome filters (BoardPage applies them) —
     *  stats and lanes count the FILTERED issues in the current cycle. */
    Define.Prop<'issues', GitHubIssue[], true> &
    Define.Prop<'config', BoardConfig, true> &
    /** Cycles from the repo's milestones (derive.cyclesFrom). */
    Define.Prop<'cycles', BoardCycle[], true> &
    Define.Prop<'loading', boolean>;

const DAY = 86_400_000;

/**
 * The Sprint view ("Current cycle", handoff §7): a summary card — cycle
 * name, date range, amber days-left pill, N% complete — over an 8px
 * accent→cyan progress bar and the 4-tile stat grid (Scope / In flight /
 * Completed / Not started, big colored mono numbers), then two lanes of
 * compact issue rows: "In focus" (in progress + in review) and "Up next"
 * (todo), both priority-sorted. Without a current cycle the view is one
 * centered empty state.
 */
export const SprintView = component<SprintViewProps>(({ props }) => () => {
    const cycle = currentCycle(props.cycles);
    if (cycle === null) {
        return (
            <div class="flex h-full items-center justify-center">
                <span class="text-[11.5px] text-tf">
                    {props.loading ? 'Loading cycles…' : 'No active cycle — assign issues to a milestone'}
                </span>
            </div>
        );
    }
    const config = props.config;
    const stats = sprintStats(props.issues, config, cycle);
    // Whole days until the cycle's due date, floored at 0 — an overdue
    // cycle reads "0 days left", never a negative.
    const daysLeft = Math.max(0, Math.ceil((Date.parse(cycle.end) - Date.now()) / DAY));
    const scoped = props.issues.filter((i) => i.milestone?.number === cycle.number);
    const lanes = [
        {
            id: 'focus',
            name: 'In focus',
            dot: 'oklch(0.74 0.15 65)',
            rows: sortByPriority(scoped.filter((i) => {
                const s = statusOf(i, config);
                return s === 'inprogress' || s === 'inreview';
            }), config)
        },
        {
            id: 'next',
            name: 'Up next',
            dot: 'oklch(0.7 0.11 250)',
            rows: sortByPriority(scoped.filter((i) => statusOf(i, config) === 'todo'), config)
        }
    ];
    const tiles = [
        { id: 'scope', label: 'Scope', value: stats.scope, color: 'var(--color-tx)' },
        { id: 'inflight', label: 'In flight', value: stats.inFlight, color: 'oklch(0.74 0.15 65)' },
        { id: 'completed', label: 'Completed', value: stats.completed, color: 'oklch(0.68 0.14 150)' },
        { id: 'notstarted', label: 'Not started', value: stats.notStarted, color: 'var(--color-tm)' }
    ];
    return (
        <div data-sprint-view class="h-full overflow-y-auto px-[22px] py-5">
            <div class="mb-[18px] rounded-[14px] border border-bd bg-bg1 px-5 py-[18px]">
                <div class="flex flex-wrap items-center gap-3">
                    <span class="text-[17px] font-bold tracking-[-0.01em]">{cycle.title}</span>
                    <span class="text-[12px] text-tm">{dateRange(cycle.start, cycle.end)}</span>
                    <span
                        data-sprint-days-left
                        class="rounded-full border px-2.5 py-[3px] text-[11.5px] font-semibold"
                        style="background:oklch(0.72 0.15 65 / 0.14);border-color:oklch(0.72 0.15 65 / 0.3);color:oklch(0.82 0.12 65)"
                    >
                        {daysLeft} days left
                    </span>
                    <div class="flex-1" />
                    <span data-sprint-pct class="font-mono text-[12px] text-tm">{stats.pctComplete}% complete</span>
                </div>
                <div class="mt-3.5 h-2 overflow-hidden rounded-full bg-bg3">
                    <div
                        class="h-full rounded-full"
                        style={`width:${stats.pctComplete}%;background:linear-gradient(90deg,var(--ac),var(--ac2))`}
                    />
                </div>
                <div class="mt-4 grid grid-cols-4 gap-3">
                    {tiles.map((t) => (
                        <div key={t.id} class="rounded-[10px] border border-bd bg-bg2 px-3.5 py-3">
                            <div data-sprint-stat={t.id} class="font-mono text-[22px] font-medium" style={`color:${t.color}`}>
                                {t.value}
                            </div>
                            <div class="mt-0.5 text-[11px] text-tm">{t.label}</div>
                        </div>
                    ))}
                </div>
            </div>
            <div class="grid grid-cols-2 gap-[18px]">
                {lanes.map((lane) => (
                    <div key={lane.id} data-sprint-lane={lane.id}>
                        <div class="mb-2.5 flex items-center gap-2">
                            <span class="size-[9px] rounded-full" style={`background:${lane.dot}`} />
                            <span class="text-[12.5px] font-semibold">{lane.name}</span>
                            <span class="font-mono text-[11px] text-tf">{lane.rows.length}</span>
                        </div>
                        <div class="flex flex-col gap-2">
                            {lane.rows.length === 0 && (
                                <span class="px-1 text-[11.5px] text-tf">
                                    {props.loading ? 'Loading issues…' : 'No issues'}
                                </span>
                            )}
                            {lane.rows.map((issue) => {
                                const prio = priorityOf(issue, config);
                                return (
                                    <div
                                        key={issue.number}
                                        data-sprint-row={issue.number}
                                        class="flex items-center gap-2.5 rounded-[10px] border border-bd bg-bg2 px-3 py-2.5 hover:border-bds hover:bg-bg3"
                                    >
                                        <span
                                            class="font-mono text-[10px] font-semibold"
                                            style={prio !== null ? `color:${PRIORITIES[prio]!.color}` : undefined}
                                        >
                                            {prio !== null ? PRIORITIES[prio]!.label : ''}
                                        </span>
                                        <span class="font-mono text-[11px] text-tf">
                                            {issue.isPr ? `PR #${issue.number}` : `#${issue.number}`}
                                        </span>
                                        <span class="min-w-0 flex-1 truncate text-[12.5px]">{issue.title}</span>
                                        <div class="flex">
                                            {issue.assignees.map((a) => (
                                                <Avatar key={a.login} login={a.login} size={20} ring="var(--color-bg2)" overlap />
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}, { name: 'SprintView' });
