import type { ResolverState } from '@shared/sync-types'

/**
 * Whether a resolver state represents an *actionable* conflict — i.e. there is
 * at least one file the user must resolve.
 *
 * `resolverGetState()` is not a reliable "is there a conflict" signal on its
 * own: when no persisted state exists it falls through to a fresh
 * `computeResolverState`, which returns a non-null state with `files: []`
 * whenever the repo simply has nothing diverging. Treating that as
 * "in progress" surfaces an empty, un-resolvable conflict modal. Gate the
 * banner/modal on this predicate everywhere instead.
 */
export function hasResolvableConflicts(state: ResolverState | null): boolean {
  return state !== null && state.files.length > 0
}
