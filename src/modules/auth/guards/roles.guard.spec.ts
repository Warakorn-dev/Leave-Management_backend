/// <reference types="jest" />
/**
 * Role checks for the leave workflow endpoints: RolesGuard behaviour plus the
 * @Roles metadata actually declared on each controller/handler (read via
 * Reflector, exactly as the guard does). The expected role lists mirror the
 * current code; see the final report for the points where they go beyond the
 * business-flow document.
 */
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { EmployeeController } from '../../employee/employee.controller';
import { HrController } from '../../hr/hr.controller';
import { ManagerController } from '../../manager/manager.controller';
import { CeoController } from '../../ceo/ceo.controller';

type Handler = (...args: never[]) => unknown;

function contextFor(
  controller: { prototype: object },
  handler: Handler,
  role?: string,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({
        user: role === undefined ? undefined : { id: 'u', role },
      }),
    }),
  } as unknown as ExecutionContext;
}

const reflector = new Reflector();
const guard = new RolesGuard(reflector);
const ALL_ROLES = ['Employee', 'Manager', 'HR', 'CEO', 'Admin'];

function allowedRoles(controller: { prototype: object }, handler: Handler) {
  return ALL_ROLES.filter((role) => {
    try {
      return guard.canActivate(contextFor(controller, handler, role));
    } catch {
      return false;
    }
  });
}

describe('RolesGuard', () => {
  it('refuses a request whose user has no role', () => {
    const p = ManagerController.prototype as unknown as Record<string, Handler>;
    expect(() =>
      guard.canActivate(contextFor(ManagerController, p.approveRequest)),
    ).toThrow(new ForbiddenException('No role found for user'));
  });

  it('refuses a role that is not listed', () => {
    const p = CeoController.prototype as unknown as Record<string, Handler>;
    expect(() =>
      guard.canActivate(
        contextFor(CeoController, p.approveSpecialLeave, 'Manager'),
      ),
    ).toThrow(new ForbiddenException('Insufficient permissions'));
  });

  it('lets a handler through when no @Roles metadata exists (why every route must declare roles)', () => {
    class Bare {}
    const open: Handler = () => undefined;
    expect(guard.canActivate(contextFor(Bare, open, 'Admin'))).toBe(true);
    expect(
      reflector.getAllAndOverride(ROLES_KEY, [open, Bare]),
    ).toBeUndefined();
  });
});

describe('Role matrix of the leave workflow endpoints (actual code)', () => {
  const emp = EmployeeController.prototype as unknown as Record<
    string,
    Handler
  >;
  const hr = HrController.prototype as unknown as Record<string, Handler>;
  const mgr = ManagerController.prototype as unknown as Record<string, Handler>;
  const ceo = CeoController.prototype as unknown as Record<string, Handler>;

  it.each([
    [
      'submit leave  POST /leave',
      EmployeeController,
      emp.createLeaveRequest,
      ['Employee', 'Manager', 'HR', 'CEO'],
    ],
    [
      'cancel leave  DELETE /leave/:id',
      EmployeeController,
      emp.deleteLeaveRequest,
      ['Employee', 'Manager', 'HR', 'CEO'],
    ],
    [
      'HR verify     PUT /hr/leaves/:id/verify',
      HrController,
      hr.processLeaveRequest,
      ['HR'], // CEO read-only on /hr since 2026-09-24
    ],
    [
      'HR open/lock  PATCH /hr/leaves/:id/view',
      HrController,
      hr.markAsViewed,
      ['HR'],
    ],
    [
      'dept approve  PUT /manager/approve/:id',
      ManagerController,
      mgr.approveRequest,
      ['Manager', 'HR'], // CEO is not a department head
    ],
    [
      'dept reject   PUT /manager/reject/:id',
      ManagerController,
      mgr.rejectRequest,
      ['Manager', 'HR'],
    ],
    [
      'CEO approve   PUT /ceo/approve/:id',
      CeoController,
      ceo.approveSpecialLeave,
      ['CEO'],
    ],
    [
      'CEO reject    PUT /ceo/reject/:id',
      CeoController,
      ceo.rejectSpecialLeave,
      ['CEO'],
    ],
  ])('%s', (_label, controller, handler, expected) => {
    expect(handler).toBeInstanceOf(Function);
    expect(allowedRoles(controller, handler)).toEqual(expected);
  });

  it('Admin is excluded from every leave workflow endpoint', () => {
    for (const [c, h] of [
      [EmployeeController, emp.createLeaveRequest],
      [HrController, hr.processLeaveRequest],
      [ManagerController, mgr.approveRequest],
      [CeoController, ceo.approveSpecialLeave],
    ] as const) {
      expect(() => guard.canActivate(contextFor(c, h, 'Admin'))).toThrow(
        ForbiddenException,
      );
    }
  });

  it('an Employee cannot reach any approval endpoint', () => {
    for (const [c, h] of [
      [HrController, hr.processLeaveRequest],
      [ManagerController, mgr.approveRequest],
      [CeoController, ceo.approveSpecialLeave],
    ] as const) {
      expect(() => guard.canActivate(contextFor(c, h, 'Employee'))).toThrow(
        ForbiddenException,
      );
    }
  });
});
