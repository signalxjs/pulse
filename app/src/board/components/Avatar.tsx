import { component, type Define } from 'sigx';
import { avatarColor, personHue } from '../colors';
import { initialsOf } from '../derive';

type AvatarProps =
    /** GitHub login — drives the monogram and the stable derived hue. */
    Define.Prop<'login', string, true> &
    /** Pixel size (cards 20, list rows 22, header 26). */
    Define.Prop<'size', number, true> &
    /** The 2px ring color — the surface the avatar sits on (handoff:
     *  bg2 on cards, bg0 on list rows/header). */
    Define.Prop<'ring', string, true> &
    /** Overlapping-stack mode: -6px left margin (handoff avatar stacks). */
    Define.Prop<'overlap', boolean>;

/**
 * One initials-on-colored-circle avatar (handoff §Assets — no image
 * assets; production may swap in GitHub avatar_url later). Mono
 * initials, white text, `oklch(0.58 0.14 <hue>)` fill, 2px surface ring.
 */
export const Avatar = component<AvatarProps>(({ props }) => () => (
    <span
        role="img"
        aria-label={props.login}
        title={props.login}
        class={
            'flex shrink-0 items-center justify-center rounded-full font-mono text-[9px] font-medium text-white ' +
            (props.overlap ? '-ml-1.5' : '')
        }
        style={
            `width:${props.size}px;height:${props.size}px;` +
            `background:${avatarColor(personHue(props.login))};` +
            `box-shadow:0 0 0 2px ${props.ring}`
        }
    >
        {initialsOf(props.login)}
    </span>
), { name: 'Avatar' });
