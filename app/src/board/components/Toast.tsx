import { component } from 'sigx';
import { useBoardUiStore } from '../../stores/boardUi';

/**
 * The toast system (handoff §11, pulse#54): a bottom-center stack rendered
 * from the boardUi store's queue — `ui.showToast(message)` from anywhere,
 * toastIn entry, auto-dismiss 2s (the store owns the timers). Each toast is
 * bg3 over a bds border with the accent dot; role=status/aria-live keeps
 * them announced.
 */
export const Toasts = component(() => {
    const ui = useBoardUiStore();
    return () => (
        <div class="pointer-events-none fixed bottom-6 left-1/2 z-[90] flex -translate-x-1/2 flex-col items-center gap-2">
            {ui.toasts.map((t) => (
                <div
                    key={t.id}
                    data-toast
                    role="status"
                    aria-live="polite"
                    class={
                        'flex max-w-[min(90vw,26rem)] animate-toast-in items-center gap-2 rounded-[10px] border border-bds ' +
                        'bg-bg3 px-4 py-[11px] text-[12.5px] text-tx shadow-[0_12px_34px_rgba(0,0,0,.4)]'
                    }
                >
                    <span class="size-[7px] shrink-0 rounded-full bg-ac" />
                    <span class="min-w-0">{t.message}</span>
                </div>
            ))}
        </div>
    );
}, { name: 'Toasts' });
