import { authClient } from "./client";

/** Normalized user shape used across the app. */
export type AppUser = {
  id: string;
  displayName: string | null;
  primaryEmail: string | null;
  profileImageUrl: string | null;
};

/** `useCurrentUserState()` result: the user plus the session-loading flag. */
export type CurrentUserState = {
  /** The user: `null` BOTH while the session loads and when signed out. */
  user: AppUser | null;
  /** True while the session is still resolving: don't treat `user: null` as signed out yet. */
  isPending: boolean;
};

/**
 * Current user + loading state, from Better Auth `useSession()`.
 *
 * Protect a route by waiting out `isPending` before acting on `user`;
 * redirecting on `user: null` alone bounces signed-in visitors to sign-in on
 * every hard reload:
 *
 *   const { user, isPending } = useCurrentUserState();
 *   if (isPending) return null;
 *   if (!user) return <RedirectToSignIn />;
 */
export function useCurrentUserState(): CurrentUserState {
  const { data, isPending } = authClient.useSession();
  const user = data?.user;
  return {
    user: user
      ? {
          id: user.id,
          displayName: user.name ?? null,
          primaryEmail: user.email ?? null,
          profileImageUrl: user.image ?? null,
        }
      : null,
    isPending,
  };
}

/**
 * Convenience view of `useCurrentUserState().user` for display. NOTE: `null`
 * means *loading OR signed out*; for redirects use `useCurrentUserState()`.
 */
export function useCurrentUser(): AppUser | null {
  return useCurrentUserState().user;
}
