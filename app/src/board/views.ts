/**
 * The five planner views (handoff §Screens): route-param key, sidebar
 * label, header title, keyboard shortcut, icon. `/b/:owner/:repo/:view`
 * validates against these keys — anything else is a 404.
 */
import { IconBoard, IconList, IconRoadmap, IconSprint, IconBacklog } from '../components/icons';

export type ViewKey = 'board' | 'list' | 'roadmap' | 'sprint' | 'backlog';

export interface ViewMeta {
    key: ViewKey;
    /** Sidebar nav label. */
    label: string;
    /** Header breadcrumb title (List → "Issues", Sprint → "Current cycle"). */
    title: string;
    /** Mono shortcut hint (1–5). */
    kbd: string;
    icon: typeof IconBoard;
}

export const VIEWS: readonly ViewMeta[] = [
    { key: 'board', label: 'Board', title: 'Board', kbd: '1', icon: IconBoard },
    { key: 'list', label: 'List', title: 'Issues', kbd: '2', icon: IconList },
    { key: 'roadmap', label: 'Roadmap', title: 'Roadmap', kbd: '3', icon: IconRoadmap },
    { key: 'sprint', label: 'Sprint', title: 'Current cycle', kbd: '4', icon: IconSprint },
    { key: 'backlog', label: 'Backlog', title: 'Backlog', kbd: '5', icon: IconBacklog }
];

export function isViewKey(value: string): value is ViewKey {
    return VIEWS.some((v) => v.key === value);
}
