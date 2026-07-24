/**
 * Chrome data shapes (pulse#39). The shell renders these from props so the
 * later data PRs only have to produce them from live GitHub labels /
 * collaborators — empty arrays are the valid "no data yet" state and every
 * chrome component renders gracefully without them.
 */

/** A repo label as the sidebar/filter chips consume it. */
export interface BoardLabel {
    /** Stable key (the GitHub label name). */
    key: string;
    name: string;
    /** OKLCh hue driving the tint formula (see colors.labelStyle). */
    hue: number;
    /** Open issues carrying the label. */
    count: number;
}

/** A person as avatars/team rows consume them. */
export interface BoardPerson {
    name: string;
    /** 1–2 char monogram for the colored-circle avatar. */
    initials: string;
    /** OKLCh hue for the avatar fill (see colors.avatarColor). */
    hue: number;
    /** Assigned-issue count (team section). */
    count?: number;
}
