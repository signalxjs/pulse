import { component, type Define } from 'sigx';

type ToastProps = Define.Prop<'message', string, true>;

/**
 * The minimal inline toast (handoff §11): fixed bottom-center, bg3 over a
 * bds border, accent dot + message, toastIn entry. Deliberately tiny — the
 * full toast system (queueing, actions) is a later PR; the caller owns the
 * message signal and its auto-dismiss timer.
 */
export const Toast = component<ToastProps>(({ props }) => () => (
    <div
        data-toast
        role="status"
        aria-live="polite"
        class={
            'fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 animate-toast-in items-center gap-2 ' +
            'rounded-[10px] border border-bds bg-bg3 px-3.5 py-2.5 text-[12.5px] text-tx ' +
            'shadow-[0_12px_34px_rgba(0,0,0,.4)]'
        }
    >
        <span class="size-1.5 shrink-0 rounded-full bg-ac" />
        {props.message}
    </div>
), { name: 'Toast' });
