import { component } from 'sigx';

/**
 * The Dashboard repo filter as a RESUMABLE boundary (pulse#57). A
 * `*.resume.tsx` module, so `sigxResume()` extracts the input handler into a
 * lazily-imported QRL chunk and renders the input with `hydrate: 'never'`:
 * the page ships ZERO JS for the filter, and the delegation loader wakes it
 * on the first keystroke (upgrade-on-write).
 *
 * Why the filter — and not the grid — is the boundary: the repo cards are
 * `@sigx/router` `<Link>`s that must stay hydrated for client-side board
 * navigation. A `hydrate: 'never'` boundary owning the grid would leave those
 * Links dead until interaction. So the grid stays server-rendered AND
 * hydrated in `Dashboard.tsx`; this boundary filters it by toggling each
 * card's `hidden` from the card's `data-repo-search` haystack — a real
 * progressive-enhancement filter that works the instant JS wakes, and simply
 * shows every repo (its server-rendered default) until then.
 *
 * Named = transferred: `query`/`shown` are `ctx.signal(...)`, so the transform
 * keys and serializes them and the handler upgrades this one boundary on the
 * first write (the live "N of M" count) without capturing any module-scope
 * value (which would drop it to wake-on-interaction — findings F16).
 */
export const RepoFilter = component<{ total: number }>((ctx) => {
    const query = ctx.signal('');
    const shown = ctx.signal(ctx.props.total);

    return () => (
        <div class="flex items-center gap-3">
            <input
                class="w-full rounded-lg border border-bd bg-bg2 px-3 py-2 text-[12.5px] text-tx outline-none placeholder:text-tf focus:border-ac"
                type="search"
                data-repo-filter
                placeholder="Filter repos by name or description…"
                aria-label="Filter repos"
                onInput={(e) => {
                    const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
                    query.value = q;
                    let visible = 0;
                    for (const el of document.querySelectorAll<HTMLElement>('[data-repo-card]')) {
                        const match = q === '' || (el.getAttribute('data-repo-search') ?? '').includes(q);
                        el.hidden = !match;
                        if (match) visible++;
                    }
                    shown.value = visible;
                }}
            />
            <span class="shrink-0 whitespace-nowrap font-mono text-[11px] text-tf" data-repo-filter-count>
                {query.value === '' ? `${ctx.props.total} repos` : `${shown.value} of ${ctx.props.total}`}
            </span>
        </div>
    );
});
