import { component, onMounted, signal, type Define } from 'sigx';
import type { BoardConfig, BoardStatusId } from '@pulse/db';
import type { GitHubIssue } from '@pulse/github';
import { STATUSES } from '../colors';
import { canRepresent } from '../derive';
import { createIssue } from '../../server/mutations.server';

type NewIssueProps =
    Define.Prop<'owner', string, true> &
    Define.Prop<'repo', string, true> &
    Define.Prop<'config', BoardConfig, true> &
    /** Preselected column (the per-column + buttons); null = none. */
    Define.Prop<'initialStatus', BoardStatusId | null, true> &
    Define.Prop<'onClose', () => void, true> &
    /** Fired with the created issue as GitHub answered it — the caller's
     *  optimistic-append source. */
    Define.Prop<'onCreated', (issue: GitHubIssue) => void, true>;

type PriorityId = 'p0' | 'p1' | 'p2' | 'p3';
const PRIORITY_IDS: readonly PriorityId[] = ['p0', 'p1', 'p2', 'p3'];
const PRIORITY_LABELS: Record<PriorityId, string> = {
    p0: 'P0 · Urgent', p1: 'P1 · High', p2: 'P2 · Medium', p3: 'P3 · Low'
};

const fieldLabel = 'mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[.08em] text-tf';
const inputClass =
    'w-full rounded-[9px] border border-bd bg-bg2 px-3 py-[9px] text-[12.5px] text-tx outline-none focus:border-ac';

/**
 * The new-issue modal (pulse#54): a minimal centered form — title
 * (required), body, priority select (mapped priorities only), status select
 * (columns that can PERSIST a placement, derive.canRepresent — same rule as
 * board drops). Submit runs the createIssue server fn (labels are mapped
 * server-side from the stored config); the created issue flows back through
 * onCreated for the optimistic append + toast.
 */
export const NewIssue = component<NewIssueProps>(({ props }) => {
    const form = signal<{
        title: string;
        body: string;
        priority: '' | PriorityId;
        status: '' | BoardStatusId;
        saving: boolean;
        error: string | null;
    }>({
        title: '',
        body: '',
        priority: '',
        status: props.initialStatus ?? '',
        saving: false,
        error: null
    });

    let titleEl: HTMLInputElement | null = null;
    onMounted(() => {
        setTimeout(() => titleEl?.focus(), 20);
    });

    const submit = async () => {
        const title = form.title.trim();
        if (title === '' || form.saving) return;
        form.saving = true;
        form.error = null;
        try {
            const issue = await createIssue({
                owner: props.owner,
                repo: props.repo,
                title,
                ...(form.body.trim() !== '' && { body: form.body }),
                priority: form.priority === '' ? null : form.priority,
                status: form.status === '' ? null : form.status
            });
            props.onCreated(issue);
        } catch (err) {
            form.error = err instanceof Error ? err.message : String(err);
            form.saving = false;
        }
    };

    return () => {
        const statuses = STATUSES.filter((s) => canRepresent(props.config, s.id));
        const priorities = PRIORITY_IDS.filter((p) => props.config.priorities[p] !== null);
        return (
            <div
                onClick={() => props.onClose()}
                class="fixed inset-0 z-[85] flex animate-fade-in items-start justify-center bg-[rgba(4,5,8,.55)] pt-[14vh]"
            >
                <form
                    data-new-issue
                    role="dialog"
                    aria-label="New issue"
                    onClick={(e: MouseEvent) => e.stopPropagation()}
                    onSubmit={(e: Event) => {
                        e.preventDefault();
                        void submit();
                    }}
                    class="w-[min(480px,92vw)] animate-pop-in overflow-hidden rounded-[14px] border border-bds bg-bg1 shadow-[0_30px_80px_rgba(0,0,0,.5)]"
                >
                    <div class="flex items-center gap-2.5 border-b border-bd px-[18px] py-3.5">
                        <span class="text-sm font-semibold text-tx">New issue</span>
                        <span class="text-[12.5px] text-tf">{props.owner}/{props.repo}</span>
                        <div class="flex-1" />
                        <button
                            type="button"
                            aria-label="Close"
                            onClick={() => props.onClose()}
                            class="size-[30px] cursor-pointer rounded-lg border border-bd text-sm text-tm hover:bg-bg2 hover:text-tx"
                        >
                            ✕
                        </button>
                    </div>
                    <div class="flex flex-col gap-3.5 px-[18px] py-4">
                        <div>
                            <label class={fieldLabel} for="new-issue-title">Title</label>
                            <input
                                id="new-issue-title"
                                name="title"
                                ref={(el: HTMLInputElement) => { titleEl = el; }}
                                value={form.title}
                                onInput={(e: Event) => { form.title = (e.target as HTMLInputElement).value; }}
                                placeholder="Issue title"
                                required
                                class={inputClass}
                            />
                        </div>
                        <div>
                            <label class={fieldLabel} for="new-issue-body">Description</label>
                            <textarea
                                id="new-issue-body"
                                name="body"
                                value={form.body}
                                onInput={(e: Event) => { form.body = (e.target as HTMLTextAreaElement).value; }}
                                placeholder="Add a description…"
                                rows={4}
                                class={`${inputClass} resize-y leading-[1.5]`}
                            />
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class={fieldLabel} for="new-issue-priority">Priority</label>
                                <select
                                    id="new-issue-priority"
                                    name="priority"
                                    class={`${inputClass} cursor-pointer`}
                                    onChange={(e: Event) => {
                                        form.priority = (e.target as HTMLSelectElement).value as '' | PriorityId;
                                    }}
                                >
                                    {/* Per-option `selected` — sigx has no
                                        controlled-<select> value handling. */}
                                    <option value="" selected={form.priority === ''}>No priority</option>
                                    {priorities.map((p) => (
                                        <option key={p} value={p} selected={form.priority === p}>
                                            {PRIORITY_LABELS[p]}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label class={fieldLabel} for="new-issue-status">Status</label>
                                <select
                                    id="new-issue-status"
                                    name="status"
                                    class={`${inputClass} cursor-pointer`}
                                    onChange={(e: Event) => {
                                        form.status = (e.target as HTMLSelectElement).value as '' | BoardStatusId;
                                    }}
                                >
                                    <option value="" selected={form.status === ''}>No status</option>
                                    {statuses.map((s) => (
                                        <option key={s.id} value={s.id} selected={form.status === s.id}>
                                            {s.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        {form.error !== null && (
                            <div class="text-[12px] text-[oklch(0.65_0.19_25)]">{form.error}</div>
                        )}
                    </div>
                    <div class="flex items-center justify-end gap-2 border-t border-bd px-[18px] py-3">
                        <button
                            type="button"
                            onClick={() => props.onClose()}
                            class="cursor-pointer rounded-[9px] border border-bd bg-bg2 px-3.5 py-[9px] text-[12.5px] text-tm hover:border-bds hover:text-tx"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            data-new-issue-submit
                            disabled={form.saving || form.title.trim() === ''}
                            class={
                                'rounded-[9px] bg-ac px-3.5 py-[9px] text-[12.5px] font-semibold text-white ' +
                                'enabled:cursor-pointer enabled:hover:brightness-[1.08] disabled:opacity-50'
                            }
                        >
                            {form.saving ? 'Creating…' : 'Create issue'}
                        </button>
                    </div>
                </form>
            </div>
        );
    };
}, { name: 'NewIssue' });
