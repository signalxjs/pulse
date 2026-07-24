/**
 * GitHub's paging contract, shared by the live and fixtures adapters so
 * out-of-contract options can never make them diverge: page >= 1,
 * per_page in 1..100.
 * @param {number | undefined} page
 * @param {number | undefined} perPage
 * @returns {{ page: number, perPage: number }}
 */
export function clampPaging(page, perPage) {
    return {
        page: Math.max(1, Math.floor(page ?? 1)),
        perPage: Math.min(100, Math.max(1, Math.floor(perPage ?? 100)))
    };
}
