import { component, effect, signal, useAction, useData } from 'sigx';
import type { Define } from 'sigx';
import type { BoardConfig, BoardPriorities, BoardStatusId } from '@pulse/db';
import { boardLabels, detectConventions } from '../server/board.server';
import { createMissingLabels, saveBoard } from '../server/mutations.server';
import { labelStyle, hexToOklchHue, PRIORITIES, STATUSES } from './colors';
import { PRIORITY_IDS, STATUS_IDS } from './detect';
import { boardKeys } from './keys';

type SetupPageProps =
    Define.Prop<'owner', string, true> &
    Define.Prop<'repo', string, true> &
    /** The stored config when one exists (BoardPage's guard read owns the
     *  key) — setup revisited prefills from it instead of detection. */
    Define.Prop<'existing', BoardConfig | null, true> &
    /** Called after a successful save — BoardPage refreshes its config
     *  cell (so its guard sees the new board, not a cached null) and
     *  navigates into the board. */
    Define.Prop<'onSaved', () => void | Promise<void>, true>;

/** The setup form's working state — '' means "no label mapped". */
interface SetupForm {
    statuses: Record<BoardStatusId, string>;
    priorities: Record<keyof BoardPriorities, string>;
    useCycles: boolean;
    closeOnDone: boolean;
    /** Missing-label name → create it on save. */
    create: Record<string, boolean>;
}

const sectionTitle = 'text-[10.5px] font-semibold uppercase tracking-[.08em] text-tf';
const selectClass =
    'w-full cursor-pointer rounded-lg border border-bd bg-bg2 px-2.5 py-[7px] text-[12.5px] ' +
    'text-tx outline-none focus:border-ac';
const checkboxClass = 'size-3.5 cursor-pointer accent-[var(--color-ac)]';

/**
 * The board setup flow (pulse#40): detection-prefilled mapping form. A repo
 * becomes a board here — detected label conventions prefill the status /
 * priority selects, milestones drive the cycle toggle, unmatched
 * conventions offer create-missing-label checkboxes, and Save writes the
 * BoardConfig (+ creates opted-in labels) then navigates into the board.
 * Rendered by BoardPage inside the planner chrome (same lazy chunk).
 */
export const SetupPage = component<SetupPageProps>(({ props }) => {
    // Client-only reads (`server: false`): the SSR document renders the
    // pending arm and the hydrated client fetches — a bare `.value` read
    // that settles during streaming SSR would make the renderer emit a
    // component-level $SIGX_REPLACE patch that hydration cannot reconcile
    // (see BoardPage's module comment).
    const detect = useData(
        () => boardKeys.detect(props.owner, props.repo),
        (key) => detectConventions({ owner: key[1], repo: key[2] }),
        { server: false }
    );
    const repoLabels = useData(
        () => boardKeys.labels(props.owner, props.repo),
        (key) => boardLabels({ owner: key[1], repo: key[2] }),
        { server: false }
    );

    // Seed the form ONCE, as soon as detection has arrived — from the
    // stored config when one exists ("setup with existing config →
    // prefill from it"), the detection proposal otherwise.
    const form = signal<{ current: SetupForm | null }>({ current: null });
    effect(() => {
        if (form.current !== null) return;
        const det = detect.value;
        if (!det) return;
        const base = props.existing ?? det.config;
        const statuses = {} as Record<BoardStatusId, string>;
        for (const s of base.statuses) statuses[s.id] = s.label ?? '';
        for (const id of STATUS_IDS) statuses[id] ??= '';
        const priorities = {} as Record<keyof BoardPriorities, string>;
        for (const id of PRIORITY_IDS) priorities[id] = base.priorities[id] ?? '';
        form.current = {
            statuses,
            priorities,
            useCycles: base.cycleSource === 'milestones',
            closeOnDone: base.closeOnDone,
            create: Object.fromEntries(det.missing.map((m) => [m.name, true]))
        };
    });

    const patch = (partial: Partial<SetupForm>) => {
        if (form.current) form.current = { ...form.current, ...partial };
    };

    const save = useAction(async () => {
        const f = form.current;
        const det = detect.value;
        if (!f || !det) throw new Error('setup form is not ready');
        const toCreate = det.missing.filter((m) => f.create[m.name]);
        // A slot left unmapped whose canonical label is being created maps
        // to that label — creating `status: todo` and not using it would
        // be absurd.
        const createdFor = (slot: string): string | null =>
            toCreate.find((m) => m.slot === slot)?.name ?? null;
        // Labels FIRST: if creation fails (permissions, rate limit), no
        // config is persisted — a saved config must never map slots to
        // labels that don't exist in the repo.
        if (toCreate.length > 0) {
            await createMissingLabels({
                owner: props.owner,
                repo: props.repo,
                labels: toCreate.map(({ name, color, description }) => ({ name, color, description }))
            });
        }
        await saveBoard({
            version: 1,
            owner: props.owner,
            repo: props.repo,
            statuses: STATUS_IDS.map((id) => ({ id, label: f.statuses[id] || createdFor(id) })),
            priorities: {
                p0: f.priorities.p0 || createdFor('p0'),
                p1: f.priorities.p1 || createdFor('p1'),
                p2: f.priorities.p2 || createdFor('p2'),
                p3: f.priorities.p3 || createdFor('p3')
            },
            cycleSource: f.useCycles ? 'milestones' : 'none',
            closeOnDone: f.closeOnDone
        });
        return true;
    });

    async function onSubmit(e: Event) {
        e.preventDefault();
        const result = await save.run();
        // The parent owns what happens next (config-cell refresh + the
        // navigation into the board) — the declared `invalidates` on the
        // mutations do not reach this page's mounted cells today (see
        // docs/findings.md), so the refresh is explicit.
        if (result.ok) await props.onSaved();
    }

    return () => {
        const f = form.current;
        const det = detect.value;
        if (!f || !det) {
            // A failed read must offer a way out — a spinner that can
            // never resolve is a dead end (transient network, revoked
            // token). refresh() re-runs both reads.
            const failed = detect.state === 'errored' || repoLabels.state === 'errored';
            return (
                <div data-setup-page class="flex h-full flex-col items-center justify-center gap-3">
                    <span class="text-[12.5px] text-tf">
                        {failed ? "Couldn't read the repo's conventions." : 'Reading the repo\'s conventions…'}
                    </span>
                    {failed && (
                        <button
                            type="button"
                            onClick={() => { detect.refresh(); repoLabels.refresh(); }}
                            class="cursor-pointer rounded-lg bg-ac px-3 py-1.5 text-[12.5px] font-semibold text-white hover:brightness-110"
                        >
                            Retry
                        </button>
                    )}
                </div>
            );
        }
        const labelOptions = (repoLabels.value ?? []).map((l) => l.name);
        const labelSelect = (
            value: string,
            onChange: (next: string) => void,
            attrs: Record<string, string>
        ) => (
            <select
                {...attrs}
                class={selectClass}
                value={value}
                onChange={(e: Event) => onChange((e.target as HTMLSelectElement).value)}
            >
                {/* Per-option `selected` is load-bearing: sigx's runtime-dom
                    has no React-style controlled-<select> value handling (the
                    SSR'd `value` attribute is inert on <select>), so the
                    selection must ride the options themselves. */}
                <option value="" selected={value === ''}>No label — derived from issue state</option>
                {labelOptions.map((name) => (
                    <option key={name} value={name} selected={name === value}>{name}</option>
                ))}
                {/* A stored mapping whose label has since been deleted or
                    renamed must stay visible (and selected) — silently
                    showing the first option would misreport the config. */}
                {value !== '' && !labelOptions.includes(value) && (
                    <option value={value} selected>{value} (missing from repo)</option>
                )}
            </select>
        );

        return (
            <div data-setup-page class="h-full overflow-y-auto">
                <form onSubmit={onSubmit} class="mx-auto flex max-w-[620px] flex-col gap-4 px-[18px] py-6">
                    <div class="flex flex-col gap-1">
                        <h1 class="text-[17px] font-bold tracking-[-.01em]">Set up the board</h1>
                        <p class="text-[12.5px] leading-[1.5] text-tm">
                            {props.owner}/{props.repo} — map the repo's labels to board columns and
                            priorities. Detection prefilled what it recognized; adjust anything below.
                        </p>
                    </div>

                    {/* Status mapping */}
                    <section class="flex flex-col gap-2.5 rounded-xl border border-bd bg-bg1 p-4">
                        <div class={sectionTitle}>Status columns</div>
                        {STATUSES.map((s) => (
                            <label key={s.id} class="grid grid-cols-[110px_1fr] items-center gap-3">
                                <span class="flex items-center gap-2 text-[12.5px] text-tm">
                                    <span class="size-[9px] rounded-full" style={`background:${s.dot}`} />
                                    {s.name}
                                </span>
                                {labelSelect(
                                    f.statuses[s.id],
                                    (next) => patch({ statuses: { ...f.statuses, [s.id]: next } }),
                                    { 'data-status-select': s.id }
                                )}
                            </label>
                        ))}
                    </section>

                    {/* Priority mapping */}
                    <section class="flex flex-col gap-2.5 rounded-xl border border-bd bg-bg1 p-4">
                        <div class={sectionTitle}>Priorities</div>
                        {PRIORITY_IDS.map((id, i) => (
                            <label key={id} class="grid grid-cols-[110px_1fr] items-center gap-3">
                                <span class="font-mono text-[11px] font-medium" style={`color:${PRIORITIES[i]!.color}`}>
                                    {PRIORITIES[i]!.label}
                                </span>
                                {labelSelect(
                                    f.priorities[id],
                                    (next) => patch({ priorities: { ...f.priorities, [id]: next } }),
                                    { 'data-priority-select': id }
                                )}
                            </label>
                        ))}
                    </section>

                    {/* Cycles + behavior */}
                    <section class="flex flex-col gap-3 rounded-xl border border-bd bg-bg1 p-4">
                        <div class={sectionTitle}>Cycles</div>
                        <label class="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-tm">
                            <input
                                type="checkbox"
                                data-cycle-toggle
                                class={checkboxClass}
                                checked={f.useCycles}
                                onChange={(e: Event) => patch({ useCycles: (e.target as HTMLInputElement).checked })}
                            />
                            <span>
                                Use milestones as cycles
                                <span class="ml-2 font-mono text-[10.5px] text-tf" data-milestone-count>
                                    {det.milestoneCount} milestone{det.milestoneCount === 1 ? '' : 's'} found
                                </span>
                            </span>
                        </label>
                        <label class="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-tm">
                            <input
                                type="checkbox"
                                class={checkboxClass}
                                checked={f.closeOnDone}
                                onChange={(e: Event) => patch({ closeOnDone: (e.target as HTMLInputElement).checked })}
                            />
                            Close the GitHub issue when a card reaches Done
                        </label>
                    </section>

                    {/* Missing convention labels */}
                    {det.missing.length > 0 && (
                        <section class="flex flex-col gap-2.5 rounded-xl border border-bd bg-bg1 p-4">
                            <div class={sectionTitle}>Create missing labels</div>
                            <p class="text-[12px] leading-[1.5] text-tm">
                                These conventions have no matching label yet — checked ones are
                                created on the repo when you save.
                            </p>
                            {det.missing.map((m) => {
                                const hue = hexToOklchHue(m.color);
                                const dot = hue === null ? 'var(--color-tf)' : labelStyle(hue).dot;
                                return (
                                    <label key={m.name} class="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-tm">
                                        <input
                                            type="checkbox"
                                            data-missing-label={m.name}
                                            class={checkboxClass}
                                            checked={f.create[m.name] ?? false}
                                            onChange={(e: Event) => patch({
                                                create: { ...f.create, [m.name]: (e.target as HTMLInputElement).checked }
                                            })}
                                        />
                                        <span class="size-[9px] rounded-full" style={`background:${dot}`} />
                                        <span class="font-mono text-[11.5px] text-tx">{m.name}</span>
                                        <span class="text-[11px] text-tf">{m.description}</span>
                                    </label>
                                );
                            })}
                        </section>
                    )}

                    <div class="flex items-center gap-3">
                        <button
                            type="submit"
                            data-setup-save
                            disabled={save.loading}
                            class="flex cursor-pointer items-center gap-[7px] rounded-lg bg-ac px-4 py-2 text-[12.5px] font-semibold text-white hover:brightness-[1.08] disabled:cursor-default disabled:opacity-60"
                        >
                            {save.loading ? 'Saving…' : 'Save & open board'}
                        </button>
                        {save.error && (
                            <span class="text-[12px] text-[oklch(0.82_0.11_25)]">
                                Couldn't save: {save.error.message}
                            </span>
                        )}
                    </div>
                </form>
            </div>
        );
    };
}, { name: 'SetupPage' });
