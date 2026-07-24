import { component, onMounted, type Define } from 'sigx';
import { useRouter } from '@sigx/router';
import type { BoardConfig } from '@pulse/db';
import type { GitHubIssue } from '@pulse/github';
import { IconSearch } from '../../components/icons';
import { STATUSES } from '../colors';
import { statusOf } from '../derive';
import { VIEWS } from '../views';
import { useBoardUiStore } from '../../stores/boardUi';
import { jumpMatches } from './palette-derive';

type CommandPaletteProps =
    Define.Prop<'owner', string, true> &
    Define.Prop<'repo', string, true> &
    /** The UNFILTERED working set — the palette searches all of it. */
    Define.Prop<'issues', GitHubIssue[], true> &
    /** Null while the board is unconfigured (jump dots fall back to grey). */
    Define.Prop<'config', BoardConfig | null, true> &
    Define.Prop<'onOpenIssue', (number: number) => void, true> &
    Define.Prop<'onNewIssue', () => void, true> &
    Define.Prop<'onSync', () => void, true>;

/** §10 section header. */
const sectionHeader = 'px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[.08em] text-tf';
/** §10 result row. */
const row = 'flex w-full cursor-pointer items-center gap-[11px] rounded-[9px] px-[11px] py-[9px] text-left text-[13.5px] text-tx hover:bg-bg3';

/**
 * The command palette (handoff §10, ⌘K): centered popIn panel over a
 * backdrop, autofocused query input, and three sections — Views ("Go to
 * …"), Jump to issue (filterIssues over the palette query, capped at 6;
 * hidden when empty), Actions (new issue / copy board link / sync now).
 * Open/close and the query live in the boardUi store; Esc is the global
 * shortcut handler's job.
 */
export const CommandPalette = component<CommandPaletteProps>(({ props }) => {
    const ui = useBoardUiStore();
    const router = useRouter();
    let inputEl: HTMLInputElement | null = null;
    // Autofocus: the palette mounts on open, so focus rides the mount (a
    // tick later — the overlay's paint must land first, prototype timing).
    onMounted(() => {
        setTimeout(() => inputEl?.focus(), 20);
    });

    const base = () => `/b/${props.owner}/${props.repo}`;
    const goView = (key: string) => {
        ui.closePalette();
        void router.push(key === 'board' ? base() : `${base()}/${key}`);
    };
    const copyLink = () => {
        ui.closePalette();
        // Clipboard is absent in insecure contexts and can be permission-
        // denied — confirm only on success, report the failure otherwise
        // (and never let a missing API throw: guard before calling).
        const link = location.origin + base();
        if (!navigator.clipboard) {
            ui.showToast('Clipboard unavailable — copy from the address bar');
            return;
        }
        navigator.clipboard.writeText(link).then(
            () => ui.showToast('Board link copied'),
            () => ui.showToast("Couldn't copy the board link")
        );
    };

    return () => {
        const matches = jumpMatches(props.issues, ui.paletteQuery);
        const dotOf = (issue: GitHubIssue) =>
            props.config ? STATUSES.find((s) => s.id === statusOf(issue, props.config!))!.dot : 'var(--color-tf)';
        return (
            <div
                onClick={() => ui.closePalette()}
                class="fixed inset-0 z-[80] flex animate-fade-in items-start justify-center bg-[rgba(4,5,8,.55)] pt-[14vh]"
            >
                <div
                    data-command-palette
                    role="dialog"
                    aria-label="Command palette"
                    onClick={(e: MouseEvent) => e.stopPropagation()}
                    class="w-[min(600px,92vw)] animate-pop-in overflow-hidden rounded-[14px] border border-bds bg-bg1 shadow-[0_30px_80px_rgba(0,0,0,.5)]"
                >
                    <div class="flex items-center gap-[11px] border-b border-bd px-[18px] py-[15px]">
                        <span class="flex text-tf"><IconSearch /></span>
                        <input
                            ref={(el: HTMLInputElement) => { inputEl = el; }}
                            value={ui.paletteQuery}
                            onInput={(e: Event) => ui.setPaletteQuery((e.target as HTMLInputElement).value)}
                            onKeyDown={(e: KeyboardEvent) => {
                                // Enter = the first jump match (when searching).
                                if (e.key === 'Enter' && ui.paletteQuery.trim() !== '' && matches.length > 0) {
                                    props.onOpenIssue(matches[0]!.number);
                                }
                            }}
                            placeholder="Search issues, jump to a view, run a command…"
                            aria-label="Search issues, jump to a view, run a command"
                            class="min-w-0 flex-1 bg-transparent text-[15px] text-tx outline-none placeholder:text-tf"
                        />
                        <span class="rounded-[5px] border border-bd bg-bg0 px-1.5 py-[2px] font-mono text-[10px] text-tf">ESC</span>
                    </div>
                    <div class="max-h-[min(52vh,440px)] overflow-y-auto p-2">
                        <div class={`${sectionHeader} pt-2`}>Views</div>
                        {VIEWS.map((v) => (
                            <button key={v.key} type="button" onClick={() => goView(v.key)} class={row}>
                                <span class="flex text-tm"><v.icon /></span>
                                <span class="flex-1">Go to {v.label}</span>
                                <span class="font-mono text-[10px] text-tf">{v.kbd}</span>
                            </button>
                        ))}
                        {matches.length > 0 && (
                            <>
                                <div class={`${sectionHeader} pt-3`}>Jump to issue</div>
                                {matches.map((issue) => (
                                    <button
                                        key={issue.number}
                                        type="button"
                                        data-palette-jump={issue.number}
                                        onClick={() => props.onOpenIssue(issue.number)}
                                        class={row}
                                    >
                                        <span class="size-2 flex-none rounded-full" style={`background:${dotOf(issue)}`} />
                                        <span class="font-mono text-[11px] text-tf">
                                            {issue.isPr ? `PR #${issue.number}` : `#${issue.number}`}
                                        </span>
                                        <span class="min-w-0 flex-1 truncate">{issue.title}</span>
                                    </button>
                                ))}
                            </>
                        )}
                        <div class={`${sectionHeader} pt-3`}>Actions</div>
                        <button type="button" onClick={() => props.onNewIssue()} class={row}>
                            <span class="w-4 text-center font-bold text-ac">+</span>
                            <span class="flex-1">Create new issue</span>
                            <span class="font-mono text-[10px] text-tf">C</span>
                        </button>
                        <button type="button" onClick={copyLink} class={row}>
                            <span class="w-4 text-center font-bold text-ac">⤢</span>
                            <span class="flex-1">Copy board link</span>
                        </button>
                        <button type="button" onClick={() => props.onSync()} class={row}>
                            <span class="w-4 text-center font-bold text-ac">↺</span>
                            <span class="flex-1">Sync with GitHub now</span>
                        </button>
                    </div>
                </div>
            </div>
        );
    };
}, { name: 'CommandPalette' });
