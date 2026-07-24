import { component, type Define } from 'sigx';
import { labelStyle } from '../colors';

type LabelPillProps =
    Define.Prop<'name', string, true> &
    /** OKLCh hue for the tint formula; null = achromatic → neutral tokens. */
    Define.Prop<'hue', number | null, true> &
    /** Card pills are 10.5px / 2px 8px; list-row pills 10px / 1px 7px. */
    Define.Prop<'size', 'card' | 'row'>;

/**
 * One label tag pill (handoff label token formula): 20px-radius, tinted
 * background/text/border from the label's hue; hue-less labels (greys)
 * fall back to the neutral surface tokens.
 */
export const LabelPill = component<LabelPillProps>(({ props }) => () => {
    const s = props.hue !== null ? labelStyle(props.hue) : null;
    return (
        <span
            class={
                'whitespace-nowrap rounded-full border ' +
                (props.size === 'row' ? 'px-[7px] py-px text-[10px]' : 'px-2 py-[2px] text-[10.5px]')
            }
            style={s
                ? `color:${s.fg};background:${s.bg};border-color:${s.bd}`
                : 'color:var(--color-tm);background:var(--color-bg2);border-color:var(--color-bd)'}
        >
            {props.name}
        </span>
    );
}, { name: 'LabelPill' });
