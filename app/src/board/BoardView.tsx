import { component, signal, type Define } from 'sigx';
import type { BoardConfig, BoardStatusId } from '@pulse/db';
import type { GitHubIssue } from '@pulse/github';
import { STATUSES } from './colors';
import { canRepresent, sortByPriority, statusOf } from './derive';
import { IssueCard } from './components/IssueCard';

type BoardViewProps =
    /** The working set AFTER the chrome filters (BoardPage applies them). */
    Define.Prop<'issues', GitHubIssue[], true> &
    Define.Prop<'config', BoardConfig, true> &
    Define.Prop<'loading', boolean> &
    /** Fired on drop: move `number` to the `target` column. */
    Define.Prop<'onMove', (number: number, target: BoardStatusId) => void, true> &
    /** Fired on card click: open the detail slide-over for `number`. */
    Define.Prop<'onOpen', (number: number) => void, true> &
    /** Fired by a column's + button: new issue preselecting that status. */
    Define.Prop<'onNew', (status: BoardStatusId) => void, true>;

/**
 * The kanban board (handoff §4): five 292px columns over the derived
 * working set, cards sorted priority-then-number. Native HTML5 DnD —
 * dataTransfer carries the issue number (the card sets it), dragover
 * highlights the drop list (accent border + tint, .12s), drop fires
 * `onMove`. The dragOver highlight is view-local state: it dies with the
 * view, nothing else reads it.
 */
export const BoardView = component<BoardViewProps>(({ props }) => {
    const drag = signal<{ over: BoardStatusId | null }>({ over: null });

    return () => {
        const config = props.config;
        const byStatus = new Map<BoardStatusId, GitHubIssue[]>();
        for (const issue of props.issues) {
            const id = statusOf(issue, config);
            const list = byStatus.get(id);
            if (list) list.push(issue);
            else byStatus.set(id, [issue]);
        }
        return (
            <div class="flex h-full items-start gap-3.5 overflow-x-auto px-[18px] py-4">
                {STATUSES.map((s) => {
                    const cards = sortByPriority(byStatus.get(s.id) ?? [], config);
                    const over = drag.over === s.id;
                    // A column that can't persist a drop (unmapped, not
                    // state-derivable) doesn't accept one — see
                    // derive.canRepresent; setup maps a label to unlock it.
                    const droppable = canRepresent(props.config, s.id);
                    return (
                        <section key={s.id} data-column={s.id} class="flex h-full w-[292px] min-h-0 shrink-0 flex-col">
                            <div class="flex items-center gap-2 px-1 pt-0.5 pb-2.5">
                                <span class="size-[9px] rounded-full" style={`background:${s.dot}`} />
                                <span class="text-[12.5px] font-semibold">{s.name}</span>
                                <span data-column-count class="rounded-full bg-bg2 px-[7px] py-px font-mono text-[11px] text-tf">
                                    {cards.length}
                                </span>
                                <div class="flex-1" />
                                {/* Enabled exactly where a drop would be:
                                    a column that can't PERSIST a placement
                                    can't take a new issue either. */}
                                <button
                                    type="button"
                                    disabled={!droppable}
                                    onClick={() => props.onNew(s.id)}
                                    aria-label={`New issue in ${s.name}`}
                                    class={
                                        'size-[22px] rounded-md text-base leading-none text-tf ' +
                                        (droppable ? 'cursor-pointer hover:bg-bg2 hover:text-tx' : 'opacity-50')
                                    }
                                >
                                    +
                                </button>
                            </div>
                            <div
                                data-drop-list
                                onDragOver={(e: DragEvent) => {
                                    e.preventDefault();
                                    if (e.dataTransfer) e.dataTransfer.dropEffect = droppable ? 'move' : 'none';
                                    if (droppable && drag.over !== s.id) drag.over = s.id;
                                }}
                                onDragLeave={(e: DragEvent) => {
                                    // Only when the drag truly leaves the list —
                                    // moving between cards inside it also fires.
                                    const into = e.relatedTarget as Node | null;
                                    if (into && (e.currentTarget as HTMLElement).contains(into)) return;
                                    if (drag.over === s.id) drag.over = null;
                                }}
                                onDrop={(e: DragEvent) => {
                                    e.preventDefault();
                                    drag.over = null;
                                    if (!droppable) return;
                                    const n = Number(e.dataTransfer?.getData('text/plain'));
                                    if (Number.isInteger(n) && n > 0) props.onMove(n, s.id);
                                }}
                                class={
                                    'flex min-h-0 flex-1 flex-col gap-[9px] overflow-y-auto rounded-xl border p-2 ' +
                                    'transition-[background-color,border-color] duration-[.12s] ' +
                                    (over ? 'border-ac bg-ac/[.06]' : 'border-transparent bg-bg1')
                                }
                            >
                                {cards.length === 0 && (
                                    <div class="flex flex-1 items-center justify-center">
                                        <span class="text-[11.5px] text-tf">
                                            {props.loading ? 'Loading issues…' : 'No issues'}
                                        </span>
                                    </div>
                                )}
                                {cards.map((issue) => (
                                    <IssueCard
                                        key={issue.number}
                                        issue={issue}
                                        config={config}
                                        onDragEnd={() => { drag.over = null; }}
                                        onOpen={() => props.onOpen(issue.number)}
                                    />
                                ))}
                            </div>
                        </section>
                    );
                })}
            </div>
        );
    };
}, { name: 'BoardView' });
