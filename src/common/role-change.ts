/**
 * Prisma `user.update` data for a role change (business rule 2026-09-24).
 *
 * Permissions already follow the database on every request (JwtStrategy reads
 * the role), but the web app keeps the role from login time for its menus and
 * pages. So any role change also signs the user out everywhere — bumping
 * tokenVersion kills their access tokens and clearing the refresh token stops
 * silent re-login — and their next login shows the new role's UI.
 *
 * Use it only when the role really changes.
 */
export function roleChangeSignOut(roleId: string) {
  return {
    roleId,
    tokenVersion: { increment: 1 },
    refreshToken: null,
  };
}
