/**
 * Where a leave requester should land from a notification about their own
 * request. Paths are the real frontend routes per role (app/dashboard/<role>/…);
 * the CEO area has no history page, so CEO requests open the CEO dashboard.
 */
export function leaveHistoryUrlForRole(roleName?: string | null): string {
  switch (roleName) {
    case 'Manager':
      return '/dashboard/manager/history';
    case 'HR':
      return '/dashboard/hr/leave-history';
    case 'CEO':
      return '/dashboard/ceo/dashboard';
    default:
      return '/dashboard/user/history';
  }
}

/**
 * Business rule (2026-09-24): ONLY a "Leader" position is a department head.
 * A position merely named "...Manager" (e.g. "Project Manager") is not.
 * Every place that decides department-head status must use this.
 */
export function isLeaderPosition(positionName?: string | null): boolean {
  return (positionName || '').toLowerCase().includes('leader');
}

/**
 * Who may act as department head for a leave (mirrors ManagerService access):
 * a user with role Manager, or an HR user in a Leader position.
 */
export function isDepartmentApprover(
  roleName?: string | null,
  positionName?: string | null,
): boolean {
  if (roleName === 'Manager') return true;
  if (roleName !== 'HR') return false;
  return isLeaderPosition(positionName);
}
