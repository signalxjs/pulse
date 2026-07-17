/** The user shape shared between the auth package and the app. */
export interface SessionUser {
    login: string;
    name: string | null;
    avatarUrl: string;
}
