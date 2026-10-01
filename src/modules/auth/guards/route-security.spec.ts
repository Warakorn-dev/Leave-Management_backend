/// <reference types="jest" />
/**
 * System-wide authorization audit, read from the real decorators.
 * Every route is checked for an authentication guard and for which roles the
 * RolesGuard admits, so a new or changed route cannot silently open up.
 */
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from './roles.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AppController } from '../../../app.controller';
import { AdminController } from '../../admin/admin.controller';
import { AnnouncementController } from '../../announcement/announcement.controller';
import { AuthController } from '../auth.controller';
import { CeoController } from '../../ceo/ceo.controller';
import { EmployeeController } from '../../employee/employee.controller';
import { ExportController } from '../../export/export.controller';
import { HrController } from '../../hr/hr.controller';
import { ManagerController } from '../../manager/manager.controller';
import { NotificationController } from '../../notification/notification.controller';
import { UploadController } from '../../upload/upload.controller';

type Ctor = abstract new (...args: never[]) => unknown;
type Handler = (...args: unknown[]) => unknown;

const CONTROLLERS: Ctor[] = [
  AppController,
  AdminController,
  AnnouncementController,
  AuthController,
  CeoController,
  EmployeeController,
  ExportController,
  HrController,
  ManagerController,
  NotificationController,
  UploadController,
];
const ROLES = ['Employee', 'Manager', 'HR', 'CEO', 'Admin'] as const;

interface Route {
  controller: Ctor;
  name: string;
  handler: Handler;
}

function routesOf(controller: Ctor): Route[] {
  const proto = controller.prototype as Record<string, Handler>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name) => ({ controller, name, handler: proto[name] }))
    .filter(
      (r) =>
        typeof r.handler === 'function' &&
        Reflect.getMetadata(PATH_METADATA, r.handler) !== undefined,
    );
}
const ALL_ROUTES = CONTROLLERS.flatMap(routesOf);
const label = (r: Route) => `${r.controller.name}.${r.name}`;

function guardsOf(r: Route): unknown[] {
  return [
    ...((Reflect.getMetadata(GUARDS_METADATA, r.controller) as unknown[]) ??
      []),
    ...((Reflect.getMetadata(GUARDS_METADATA, r.handler) as unknown[]) ?? []),
  ];
}
function isAuthenticated(r: Route): boolean {
  const accepted: unknown[] = [
    JwtAuthGuard,
    AuthGuard('jwt'),
    AuthGuard('jwt-refresh'),
  ];
  return guardsOf(r).some((g) => accepted.includes(g));
}

const reflector = new Reflector();
const guard = new RolesGuard(reflector);
function admits(r: Route, role: string): boolean {
  const ctx = {
    getHandler: () => r.handler,
    getClass: () => r.controller,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u', role } }) }),
  };
  try {
    return guard.canActivate(ctx as never);
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}
function declaredRoles(r: Route): string[] | undefined {
  return reflector.getAllAndOverride<string[]>(ROLES_KEY, [
    r.handler,
    r.controller,
  ]);
}

/** Routes that are public on purpose (login flow, health). */
const PUBLIC_BY_DESIGN = new Set([
  'AppController.getHello',
  'AppController.health',
  'AuthController.getConfig',
  'AuthController.getCaptcha',
  'AuthController.verifyCaptcha',
  'AuthController.login',
  'AuthController.forgotPassword',
  'AuthController.resetPassword',
]);

describe('Route inventory', () => {
  it('finds the routes of every controller', () => {
    for (const c of CONTROLLERS) expect(routesOf(c).length).toBeGreaterThan(0);
    expect(ALL_ROUTES.length).toBeGreaterThan(90);
  });

  it('every public route name in the allow-list really exists', () => {
    const names = new Set(ALL_ROUTES.map(label));
    for (const n of PUBLIC_BY_DESIGN) expect(names).toContain(n);
  });
});

describe('Authentication: no route is reachable without a token unless listed', () => {
  it('every other route requires authentication', () => {
    const unguarded = ALL_ROUTES.filter((r) => !isAuthenticated(r))
      .map(label)
      .filter((n) => !PUBLIC_BY_DESIGN.has(n));
    expect(unguarded).toEqual([]);
  });

  it('announcements: every route needs a token (was fully public before 2026-09-24)', () => {
    for (const r of routesOf(AnnouncementController))
      expect([label(r), isAuthenticated(r)]).toEqual([label(r), true]);
  });

  it('logout, profile update and token refresh require a token', () => {
    for (const n of ['logout', 'updateProfile', 'refreshTokens']) {
      const r = ALL_ROUTES.find(
        (x) => x.controller === AuthController && x.name === n,
      )!;
      expect(isAuthenticated(r)).toBe(true);
    }
  });
});

describe('Authorization: every role-guarded route declares roles', () => {
  it('any route guarded by RolesGuard also has @Roles (otherwise RolesGuard lets everyone through)', () => {
    const missing = ALL_ROUTES.filter((r) =>
      guardsOf(r).includes(RolesGuard),
    ).filter((r) => !declaredRoles(r)?.length);
    expect(missing.map(label)).toEqual([]);
  });

  /** Roles each controller admits, per the business rules. */
  const EXPECTED: [Ctor, string[]][] = [
    [AdminController, ['Admin']],
    [CeoController, ['CEO']],
    [ExportController, ['HR', 'CEO']],
    [ManagerController, ['Manager', 'HR']],
    [EmployeeController, ['Employee', 'Manager', 'HR', 'CEO']],
  ];

  /** The only /hr routes the CEO may use — read-only lists for CEO pages. */
  const CEO_READ_ON_HR = new Set([
    'HrController.findAllLeaves',
    'HrController.findAllEmployees',
    'HrController.findAllDepartments',
  ]);

  it('HrController: HR on every route; the CEO only on the three read lists', () => {
    for (const r of routesOf(HrController)) {
      const got = ROLES.filter((role) => admits(r, role));
      const expected = CEO_READ_ON_HR.has(label(r)) ? ['HR', 'CEO'] : ['HR'];
      expect({ route: label(r), roles: got }).toEqual({
        route: label(r),
        roles: expected,
      });
    }
  });

  it('the CEO’s /hr routes are all GET (read-only)', () => {
    for (const r of routesOf(HrController).filter((x) =>
      CEO_READ_ON_HR.has(label(x)),
    )) {
      expect([label(r), Reflect.getMetadata('method', r.handler)]).toEqual([
        label(r),
        0, // RequestMethod.GET
      ]);
    }
  });

  it('the CEO cannot do HR work: verify, employees, org setup, balances', () => {
    const work = [
      'processLeaveRequest',
      'markAsViewed',
      'createEmployee',
      'updateEmployee',
      'updateEmployeeStatus',
      'deleteEmployee',
      'updateLeaveBalance',
      'createLeaveType',
      'updateLeaveType',
      'createHoliday',
      'createDepartment',
      'createPosition',
    ];
    for (const name of work) {
      const r = routesOf(HrController).find((x) => x.name === name)!;
      expect([name, admits(r, 'CEO')]).toEqual([name, false]);
    }
  });

  it.each(EXPECTED)(
    '%p admits exactly %p on every route',
    (controller, allowed) => {
      for (const r of routesOf(controller)) {
        const got = ROLES.filter((role) => admits(r, role));
        expect({ route: label(r), roles: got }).toEqual({
          route: label(r),
          roles: ROLES.filter((x) => allowed.includes(x)),
        });
      }
    },
  );

  it.each([
    [
      'Employee',
      [
        HrController,
        ManagerController,
        CeoController,
        AdminController,
        ExportController,
      ],
    ],
    [
      'Manager',
      [HrController, CeoController, AdminController, ExportController],
    ],
    ['HR', [CeoController, AdminController]],
    ['CEO', [AdminController, ManagerController]],
    [
      'Admin',
      [
        EmployeeController,
        HrController,
        ManagerController,
        CeoController,
        ExportController,
      ],
    ],
  ] as [string, Ctor[]][])(
    '%s is refused on every route of %p',
    (role, controllers) => {
      for (const c of controllers)
        for (const r of routesOf(c))
          expect([label(r), admits(r, role)]).toEqual([label(r), false]);
    },
  );

  it('a request with no role at all is refused on role-guarded routes', () => {
    const r = routesOf(CeoController)[0];
    const ctx = {
      getHandler: () => r.handler,
      getClass: () => r.controller,
      switchToHttp: () => ({ getRequest: () => ({ user: undefined }) }),
    };
    expect(() => guard.canActivate(ctx as never)).toThrow(
      'No role found for user',
    );
  });
});

describe('Announcements: any logged-in user reads, only HR manages', () => {
  const route = (name: string) =>
    routesOf(AnnouncementController).find((r) => r.name === name)!;

  it('reading is open to every role (no RolesGuard on the list endpoint)', () => {
    const r = route('getAnnouncements');
    expect(guardsOf(r)).not.toContain(RolesGuard);
    expect(ROLES.filter((role) => admits(r, role))).toEqual([...ROLES]);
  });

  it.each(['createAnnouncement', 'updateAnnouncement', 'deleteAnnouncement'])(
    '%s admits HR only',
    (name) => {
      const r = route(name);
      expect(guardsOf(r)).toContain(RolesGuard);
      expect(ROLES.filter((role) => admits(r, role))).toEqual(['HR']);
    },
  );
});
