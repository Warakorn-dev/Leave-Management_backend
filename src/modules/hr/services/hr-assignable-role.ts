import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { isLeaderPosition } from '../../notification/leave-history-url';

/**
 * Business rule: HR may assign any role except Admin (CEO included).
 * Admin accounts are managed only from the Admin area.
 */
export const HR_UNASSIGNABLE_ROLE = 'Admin';
export const HR_ADMIN_ROLE_FORBIDDEN =
  'ฝ่ายบุคคลไม่สามารถกำหนดสิทธิ์ผู้ดูแลระบบ (Admin) ได้';

/**
 * The role a position implies (business rule 2026-09-24, same rule as the
 * "add employee" page): HR department → HR (an HR Leader is the HR
 * department head); a Leader position → Manager (ONLY Leader — a position
 * merely named "...Manager" is not a department head); otherwise Employee.
 * A CEO or Admin keeps their role — a position change never demotes them.
 */
export function roleForPosition(
  positionName: string | null | undefined,
  departmentName: string | null | undefined,
  currentRole: string | null | undefined,
): string {
  if (currentRole === 'CEO' || currentRole === HR_UNASSIGNABLE_ROLE) {
    return currentRole;
  }
  const dept = (departmentName ?? '').toLowerCase();
  const pos = (positionName ?? '').toLowerCase();
  if (dept.includes('hr') || dept.includes('human resource')) return 'HR';
  if (isLeaderPosition(pos)) return 'Manager';
  return 'Employee';
}

export const HR_ADMIN_ACCOUNT_FORBIDDEN =
  'ฝ่ายบุคคลไม่สามารถแก้ไข ระงับ หรือลบบัญชีผู้ดูแลระบบ (Admin) ได้';

function isAdminRoleName(name?: string | null): boolean {
  return name?.toLowerCase() === HR_UNASSIGNABLE_ROLE.toLowerCase();
}

/** Business rule: HR may not edit, suspend or delete an Admin account. */
export async function assertNotAdminAccount(
  prisma: Pick<Prisma.TransactionClient, 'user'>,
  userId?: string | null,
): Promise<void> {
  if (!userId) return;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true },
  });
  if (isAdminRoleName(user?.role?.name)) {
    throw new ForbiddenException(HR_ADMIN_ACCOUNT_FORBIDDEN);
  }
}

export async function assertHrAssignableRole(
  prisma: Pick<Prisma.TransactionClient, 'role'>,
  roleId?: string | null,
): Promise<void> {
  if (!roleId) return;
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (isAdminRoleName(role?.name)) {
    throw new ForbiddenException(HR_ADMIN_ROLE_FORBIDDEN);
  }
}
