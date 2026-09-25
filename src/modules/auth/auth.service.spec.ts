/// <reference types="jest" />
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

// Real bcrypt, wrapped so tests can count comparisons (the export itself cannot be spied on).
jest.mock('bcrypt', () => {
  const actual = jest.requireActual<typeof import('bcrypt')>('bcrypt');
  return {
    ...actual,
    compare: jest.fn((data: string, hash: string) =>
      actual.compare(data, hash),
    ),
  };
});
const bcryptCompare = bcrypt.compare as unknown as jest.Mock;
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateProfileDto } from './dto/auth.dto';

const SECRET = 'test-access-secret';
const REFRESH_SECRET = 'test-refresh-secret';
const config: Record<string, string> = {
  'jwt.secret': SECRET,
  'jwt.refreshSecret': REFRESH_SECRET,
  'jwt.expiration': '20m',
  'jwt.refreshExpiration': '8h',
};

const FUTURE = () => new Date(Date.now() + 5 * 60 * 1000);

function createPrisma() {
  return {
    captcha: {
      create: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    employee: { findUnique: jest.fn(), update: jest.fn() },
    adminSetting: { findUnique: jest.fn() },
  };
}

let prisma: ReturnType<typeof createPrisma>;
let mail: { sendEmail: jest.Mock };
let jwt: JwtService;
let service: AuthService;
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await bcrypt.hash('correct-password', 4);
});

beforeEach(() => {
  prisma = createPrisma();
  mail = { sendEmail: jest.fn().mockResolvedValue(true) };
  jwt = new JwtService({});
  service = new AuthService(
    prisma as never,
    jwt,
    { get: (k: string) => config[k] } as never,
    mail as never,
  );
  prisma.adminSetting.findUnique.mockResolvedValue(null);
});

/** A valid, unused, unexpired CAPTCHA with code "AbCdE". */
function captchaOk() {
  prisma.captcha.updateMany.mockResolvedValue({ count: 1 });
  prisma.captcha.findUnique.mockResolvedValue({
    id: 'cap-1',
    captchaCode: 'AbCdE',
    expiredAt: FUTURE(),
  });
}

function dbUser(over: Record<string, unknown> = {}) {
  return {
    id: 'u-1',
    email: 'emp@nid.test',
    username: 'emp',
    passwordHash,
    isActive: true,
    lockedUntil: null as Date | null,
    failedLoginAttempts: 0,
    tokenVersion: 3,
    avatarUrl: null,
    role: { name: 'Employee' },
    employee: {
      firstName: 'สมหญิง',
      lastName: 'ใจดี',
      employeeCode: 'E001',
      department: { name: 'Dev' },
      position: { name: 'Programmer' },
    },
    ...over,
  };
}

const login = (password = 'correct-password') =>
  service.login(
    {
      username: 'emp',
      password,
      captchaId: 'cap-1',
      captchaInput: 'abcde',
    },
    '10.0.0.1',
  );

describe('AuthService.verifyCaptcha', () => {
  it('claims the CAPTCHA atomically (only while unused) and accepts a case-insensitive match', async () => {
    captchaOk();
    await expect(
      service.verifyCaptcha({ captchaId: 'cap-1', captchaCode: 'ABCDE' }),
    ).resolves.toEqual({ success: true });
    expect(prisma.captcha.updateMany).toHaveBeenCalledWith({
      where: { id: 'cap-1', isUsed: false },
      data: { isUsed: true },
    });
  });

  it('unknown CAPTCHA id is refused', async () => {
    prisma.captcha.updateMany.mockResolvedValue({ count: 0 });
    prisma.captcha.findUnique.mockResolvedValue(null);
    await expect(
      service.verifyCaptcha({ captchaId: 'x', captchaCode: 'a' }),
    ).rejects.toThrow('รหัส CAPTCHA ไม่ถูกต้องหรือไม่มีอยู่ในระบบ');
  });

  it('an already used CAPTCHA cannot be replayed', async () => {
    prisma.captcha.updateMany.mockResolvedValue({ count: 0 });
    prisma.captcha.findUnique.mockResolvedValue({ id: 'cap-1' });
    await expect(
      service.verifyCaptcha({ captchaId: 'cap-1', captchaCode: 'AbCdE' }),
    ).rejects.toThrow('รหัส CAPTCHA ถูกใช้งานไปแล้ว กรุณาขอใหม่');
  });

  it('an expired CAPTCHA is refused even with the right code', async () => {
    prisma.captcha.updateMany.mockResolvedValue({ count: 1 });
    prisma.captcha.findUnique.mockResolvedValue({
      id: 'cap-1',
      captchaCode: 'AbCdE',
      expiredAt: new Date(Date.now() - 1000),
    });
    await expect(
      service.verifyCaptcha({ captchaId: 'cap-1', captchaCode: 'AbCdE' }),
    ).rejects.toThrow('รหัส CAPTCHA หมดอายุ กรุณาขอใหม่');
  });

  it('a wrong code is refused', async () => {
    captchaOk();
    await expect(
      service.verifyCaptcha({ captchaId: 'cap-1', captchaCode: 'zzzzz' }),
    ).rejects.toThrow('รหัส CAPTCHA ไม่ถูกต้อง');
  });
});

describe('AuthService.generateCaptcha', () => {
  it('stores a 5-character code that expires in 10 minutes and returns an SVG data URL', async () => {
    prisma.captcha.create.mockResolvedValue({ id: 'cap-9' });
    const before = Date.now();
    const out = await service.generateCaptcha();

    const { data } = (
      prisma.captcha.create.mock.calls as unknown[][]
    )[0][0] as {
      data: { captchaCode: string; isUsed: boolean; expiredAt: Date };
    };
    expect(data.captchaCode).toHaveLength(5);
    expect(data.isUsed).toBe(false);
    const ttl = data.expiredAt.getTime() - before;
    expect(ttl).toBeGreaterThan(9 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(10 * 60 * 1000 + 1000);
    expect(out.captcha_id).toBe('cap-9');
    expect(out.captcha_image).toMatch(/^data:image\/svg\+xml;base64,/);
    // the code itself is never returned to the client
    expect(JSON.stringify(out)).not.toContain(data.captchaCode);
  });
});

describe('AuthService.login', () => {
  it('requires CAPTCHA fields before anything else', async () => {
    prisma.user.findFirst.mockResolvedValue(dbUser());
    await expect(
      service.login({ username: 'emp', password: 'x' }),
    ).rejects.toThrow('กรุณากรอกรหัส CAPTCHA');
    expect(prisma.captcha.updateMany).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('a bad CAPTCHA stops the login before the password is checked', async () => {
    prisma.user.findFirst.mockResolvedValue(dbUser());
    prisma.captcha.updateMany.mockResolvedValue({ count: 0 });
    prisma.captcha.findUnique.mockResolvedValue(null);
    await expect(login('wrong')).rejects.toThrow(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // Business rule (2026-09-24): unknown user, wrong password and locked
  // account answer with ONE message, so usernames cannot be probed.
  const GENERIC =
    'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (หากใส่รหัสผ่านผิดติดต่อกัน 5 ครั้ง ระบบจะระงับการเข้าสู่ระบบชั่วคราว 15 นาที)';

  it('unknown user gets the generic message (not a distinct "Invalid credentials")', async () => {
    captchaOk();
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(login()).rejects.toThrow(new UnauthorizedException(GENERIC));
  });

  it('looks the user up by username OR e-mail', async () => {
    captchaOk();
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(login()).rejects.toThrow();
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ username: 'emp' }, { email: 'emp' }] },
      }),
    );
  });

  it('NO USERNAME PROBING: unknown user, wrong password and locked account all get the identical answer', async () => {
    const messages: string[] = [];
    const attempt = async (user: unknown, password: string) => {
      captchaOk();
      prisma.user.findFirst.mockResolvedValue(user);
      const e = (await login(password).catch((x: Error) => x)) as Error;
      messages.push(`${e.constructor.name}: ${e.message}`);
    };
    await attempt(null, 'whatever');
    await attempt(dbUser(), 'wrong');
    await attempt(dbUser({ failedLoginAttempts: 3 }), 'wrong');
    await attempt(
      dbUser({ lockedUntil: new Date(Date.now() + 7 * 60 * 1000) }),
      'wrong',
    );
    await attempt(
      dbUser({ lockedUntil: new Date(Date.now() + 7 * 60 * 1000) }),
      'correct-password',
    );
    expect(new Set(messages)).toEqual(
      new Set([`UnauthorizedException: ${GENERIC}`]),
    );
    expect(messages.join()).not.toMatch(
      /เหลือโอกาส|Invalid credentials|อีก \d+ นาที/,
    );
  });

  it('an unknown user still costs one bcrypt comparison (no timing shortcut)', async () => {
    captchaOk();
    prisma.user.findFirst.mockResolvedValue(null);
    bcryptCompare.mockClear();
    await expect(login()).rejects.toThrow(GENERIC);
    expect(bcryptCompare).toHaveBeenCalledTimes(1);
  });

  it('a locked account is refused WITHOUT checking the password (no password oracle during lockout)', async () => {
    captchaOk();
    prisma.user.findFirst.mockResolvedValue(
      dbUser({ lockedUntil: new Date(Date.now() + 7 * 60 * 1000) }),
    );
    bcryptCompare.mockClear();
    await expect(login()).rejects.toThrow(GENERIC);
    expect(bcryptCompare).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('a suspended account is only revealed to someone who knows the password', async () => {
    captchaOk();
    prisma.user.findFirst.mockResolvedValue(dbUser({ isActive: false }));
    await expect(login()).rejects.toThrow(
      'บัญชีของคุณถูกระงับการใช้งาน กรุณาติดต่อฝ่ายบุคคล',
    );
    captchaOk();
    prisma.user.findFirst.mockResolvedValue(dbUser({ isActive: false }));
    await expect(login('wrong')).rejects.toThrow(GENERIC);
  });

  it('an expired lock is cleared, and the attempt counter restarts from 0', async () => {
    captchaOk();
    prisma.user.findFirst.mockResolvedValue(
      dbUser({
        lockedUntil: new Date(Date.now() - 1000),
        failedLoginAttempts: 5,
      }),
    );
    await expect(login('wrong')).rejects.toThrow(GENERIC);
    expect(prisma.user.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'u-1' },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
    expect(prisma.user.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'u-1' },
      data: { failedLoginAttempts: 1, lockedUntil: null },
    });
  });

  it('a wrong password is still counted (default max 5)', async () => {
    captchaOk();
    prisma.user.findFirst.mockResolvedValue(dbUser({ failedLoginAttempts: 2 }));
    await expect(login('wrong')).rejects.toThrow(GENERIC);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { failedLoginAttempts: 3, lockedUntil: null },
    });
  });

  it('reaching the limit locks the account for the configured minutes; the message states the (global) policy', async () => {
    captchaOk();
    prisma.adminSetting.findUnique.mockImplementation(
      ({ where }: { where: { key: string } }) =>
        Promise.resolve(
          where.key === 'MAX_FAILED_LOGINS'
            ? { value: '3' }
            : where.key === 'LOCKOUT_DURATION_MINUTES'
              ? { value: '30' }
              : null,
        ),
    );
    prisma.user.findFirst.mockResolvedValue(dbUser({ failedLoginAttempts: 2 }));
    const before = Date.now();
    await expect(login('wrong')).rejects.toThrow(
      'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (หากใส่รหัสผ่านผิดติดต่อกัน 3 ครั้ง ระบบจะระงับการเข้าสู่ระบบชั่วคราว 30 นาที)',
    );
    const { data } = (prisma.user.update.mock.calls as unknown[][])[0][0] as {
      data: { failedLoginAttempts: number; lockedUntil: Date };
    };
    expect(data.failedLoginAttempts).toBe(3);
    const lockMs = data.lockedUntil.getTime() - before;
    expect(lockMs).toBeGreaterThanOrEqual(30 * 60 * 1000 - 50);
    expect(lockMs).toBeLessThanOrEqual(30 * 60 * 1000 + 1000);
  });

  it('success: resets the counter, records IP/time, issues tokens carrying role and tokenVersion, stores only a hash of the refresh token', async () => {
    captchaOk();
    prisma.user.findFirst.mockResolvedValue(dbUser({ failedLoginAttempts: 2 }));
    const out = await login();

    expect(prisma.user.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'u-1' },
      data: expect.objectContaining({
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginIp: '10.0.0.1',
      }) as unknown,
    });

    const access = jwt.verify<{
      sub: string;
      role: string;
      tokenVersion: number;
    }>(out.accessToken, { secret: SECRET });
    expect(access).toEqual(
      expect.objectContaining({
        sub: 'u-1',
        role: 'Employee',
        tokenVersion: 3,
      }),
    );
    expect(() => {
      jwt.verify(out.refreshToken, { secret: REFRESH_SECRET });
    }).not.toThrow();
    expect(() => {
      jwt.verify(out.accessToken, { secret: REFRESH_SECRET });
    }).toThrow();

    const stored = (
      (prisma.user.update.mock.calls as unknown[][])[1][0] as {
        data: { refreshToken: string };
      }
    ).data.refreshToken;
    expect(stored).not.toBe(out.refreshToken);
    await expect(bcrypt.compare(out.refreshToken, stored)).resolves.toBe(true);

    expect(out.user).toEqual({
      id: 'u-1',
      email: 'emp@nid.test',
      role: 'Employee',
      profilePic: null,
      firstName: 'สมหญิง',
      lastName: 'ใจดี',
      employeeCode: 'E001',
      departmentName: 'Dev',
      positionName: 'Programmer',
    });
    expect(JSON.stringify(out.user)).not.toContain('passwordHash');
  });
});

describe('AuthService.logout / refreshTokens', () => {
  it('logout clears the refresh token and bumps tokenVersion (kills existing access tokens)', async () => {
    await service.logout('u-1');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { refreshToken: null, tokenVersion: { increment: 1 } },
    });
  });

  it('refresh is denied after logout (no stored token) or for an unknown user', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.refreshTokens('u-x', 't')).rejects.toThrow(
      'Access Denied',
    );
    prisma.user.findUnique.mockResolvedValueOnce(
      dbUser({ refreshToken: null }),
    );
    await expect(service.refreshTokens('u-1', 't')).rejects.toThrow(
      'Access Denied',
    );
  });

  it('refresh is denied for a suspended account', async () => {
    prisma.user.findUnique.mockResolvedValue(
      dbUser({ isActive: false, refreshToken: 'h' }),
    );
    await expect(service.refreshTokens('u-1', 't')).rejects.toThrow(
      'ACCOUNT_SUSPENDED',
    );
  });

  it('refresh is denied when the presented token does not match the stored hash', async () => {
    prisma.user.findUnique.mockResolvedValue(
      dbUser({ refreshToken: await bcrypt.hash('real', 4) }),
    );
    await expect(service.refreshTokens('u-1', 'stolen')).rejects.toThrow(
      'Access Denied',
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refresh rotates: new tokens are issued and the new refresh hash replaces the old one', async () => {
    prisma.user.findUnique.mockResolvedValue(
      dbUser({ refreshToken: await bcrypt.hash('real', 4) }),
    );
    const out = await service.refreshTokens('u-1', 'real');
    const stored = (
      (prisma.user.update.mock.calls as unknown[][])[0][0] as {
        data: { refreshToken: string };
      }
    ).data.refreshToken;
    await expect(bcrypt.compare(out.refreshToken, stored)).resolves.toBe(true);
  });
});

describe('AuthService.forgotPassword / resetPassword', () => {
  const RESET_SECRET = `${SECRET}:password-reset`;

  /** Stateful user row so single-use can be proven end to end. */
  function trackTokenVersion(start = 3) {
    const row = { tokenVersion: start, passwordHash: 'old' };
    prisma.user.updateMany.mockImplementation(
      ({
        where,
        data,
      }: {
        where: { id: string; tokenVersion: number };
        data: { passwordHash: string };
      }) => {
        if (where.id !== 'u-1' || where.tokenVersion !== row.tokenVersion)
          return Promise.resolve({ count: 0 });
        row.tokenVersion += 1;
        row.passwordHash = data.passwordHash;
        return Promise.resolve({ count: 1 });
      },
    );
    return row;
  }

  async function tokenFromEmail(): Promise<string> {
    prisma.user.findFirst.mockResolvedValue(dbUser());
    await service.forgotPassword('emp');
    const text = (mail.sendEmail.mock.calls as unknown[][]).at(
      -1,
    )![2] as string;
    return /token=([^\s]+)/.exec(text)![1];
  }

  it('unknown account: same generic message and no e-mail (no user enumeration)', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    const out = await service.forgotPassword('nobody');
    expect(out).toEqual({
      message:
        'หากบัญชีนี้มีอยู่ในระบบ ลิงก์สำหรับรีเซ็ตรหัสผ่านจะถูกส่งไปยังอีเมลของคุณ',
    });
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it('known account: e-mails a purpose-bound, versioned link to the account address and never returns it', async () => {
    prisma.user.findFirst.mockResolvedValue(dbUser());
    const out = await service.forgotPassword('emp');
    const [to, subject] = (
      mail.sendEmail.mock.calls as unknown[][]
    )[0] as string[];
    expect(to).toBe('emp@nid.test');
    expect(subject).toContain('Reset');

    const token = await tokenFromEmail();
    expect(
      jwt.verify<Record<string, unknown>>(token, { secret: RESET_SECRET }),
    ).toEqual(
      expect.objectContaining({
        sub: 'u-1',
        purpose: 'password-reset',
        tokenVersion: 3,
      }),
    );
    expect(JSON.stringify(out)).not.toContain(token);
  });

  it('the e-mailed link resets the password: new bcrypt hash, sessions ended, only while the version still matches', async () => {
    trackTokenVersion();
    const token = await tokenFromEmail();
    await expect(
      service.resetPassword({ token, newPassword: 'N3w-password!' }),
    ).resolves.toEqual({ message: 'Password reset successfully' });

    const call = (prisma.user.updateMany.mock.calls as unknown[][])[0][0] as {
      where: unknown;
      data: { passwordHash: string; refreshToken: null; tokenVersion: unknown };
    };
    expect(call.where).toEqual({ id: 'u-1', tokenVersion: 3 });
    await expect(
      bcrypt.compare('N3w-password!', call.data.passwordHash),
    ).resolves.toBe(true);
    expect(call.data.refreshToken).toBeNull();
    expect(call.data.tokenVersion).toEqual({ increment: 1 });
  });

  it('SINGLE USE: the same link cannot reset the password a second time', async () => {
    const row = trackTokenVersion();
    const token = await tokenFromEmail();
    await service.resetPassword({ token, newPassword: 'First-111' });
    const afterFirst = row.passwordHash;

    await expect(
      service.resetPassword({ token, newPassword: 'Second-222' }),
    ).rejects.toThrow('Invalid or expired token');
    expect(row.passwordHash).toBe(afterFirst);
  });

  it('SINGLE USE under concurrency: two simultaneous submissions, exactly one wins', async () => {
    trackTokenVersion();
    const token = await tokenFromEmail();
    const results = await Promise.allSettled([
      service.resetPassword({ token, newPassword: 'Race-aaa1' }),
      service.resetPassword({ token, newPassword: 'Race-bbb2' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
  });

  it('a link issued before a logout / force-logout / earlier reset no longer works', async () => {
    const row = trackTokenVersion();
    const token = await tokenFromEmail();
    row.tokenVersion += 1; // e.g. the user logged out afterwards
    await expect(
      service.resetPassword({ token, newPassword: 'Late-1234' }),
    ).rejects.toThrow('Invalid or expired token');
  });

  it('an ACCESS token (as issued at login) is refused as a reset token; nothing is written', async () => {
    trackTokenVersion();
    const access = jwt.sign(
      { sub: 'u-1', email: 'emp@nid.test', role: 'Employee', tokenVersion: 3 },
      { secret: SECRET, expiresIn: '20m' },
    );
    await expect(
      service.resetPassword({ token: access, newPassword: 'Owned-123' }),
    ).rejects.toThrow('Invalid or expired token');
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('a reset token is not a valid access token (JwtStrategy’s secret rejects it)', async () => {
    const token = await tokenFromEmail();
    expect(() => {
      jwt.verify(token, { secret: SECRET });
    }).toThrow();
  });

  it.each([
    ['garbage', 'not-a-jwt'],
    [
      'signed with another secret',
      new JwtService({}).sign(
        { sub: 'u-1', purpose: 'password-reset', tokenVersion: 3 },
        { secret: 'other' },
      ),
    ],
    [
      'expired',
      new JwtService({}).sign(
        {
          sub: 'u-1',
          purpose: 'password-reset',
          tokenVersion: 3,
          exp: Math.floor(Date.now() / 1000) - 60,
        },
        { secret: `${SECRET}:password-reset` },
      ),
    ],
    [
      'wrong purpose',
      new JwtService({}).sign(
        { sub: 'u-1', purpose: 'something-else', tokenVersion: 3 },
        { secret: `${SECRET}:password-reset` },
      ),
    ],
    [
      'no version',
      new JwtService({}).sign(
        { sub: 'u-1', purpose: 'password-reset' },
        { secret: `${SECRET}:password-reset` },
      ),
    ],
  ])(
    'an invalid reset token (%s) is refused and nothing is written',
    async (_n, token) => {
      await expect(
        service.resetPassword({ token, newPassword: 'x' }),
      ).rejects.toThrow('Invalid or expired token');
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    },
  );
});

describe('AuthService.updateProfile / getPublicConfig', () => {
  it('updates only the fields provided, on the caller’s own employee record', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
    await service.updateProfile('u-1', { phone: '0812345678' });
    expect(prisma.employee.findUnique).toHaveBeenCalledWith({
      where: { userId: 'u-1' },
    });
    expect(prisma.employee.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { phone: '0812345678' },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('a password change is stored as a hash, never in plain text', async () => {
    prisma.user.findUnique.mockResolvedValue({
      passwordHash,
      passwordChangedAt: null,
      email: 'emp@nid.test',
      tokenVersion: 3,
      role: { name: 'Employee' },
    });
    await service.updateProfile('u-1', { password: 'Plain-123' });
    const { data } = (prisma.user.update.mock.calls as unknown[][])[0][0] as {
      data: { passwordHash: string };
    };
    expect(data.passwordHash).not.toBe('Plain-123');
    await expect(bcrypt.compare('Plain-123', data.passwordHash)).resolves.toBe(
      true,
    );
  });

  it('idle timeout comes from admin settings, default 60 minutes', async () => {
    await expect(service.getPublicConfig()).resolves.toEqual({
      idleTimeoutMinutes: 60,
    });
    prisma.adminSetting.findUnique.mockResolvedValue({ value: '15' });
    await expect(service.getPublicConfig()).resolves.toEqual({
      idleTimeoutMinutes: 15,
    });
  });
});

describe('Business rule — first password change needs no current password; later ones do', () => {
  /** Stateful user row so the sequence of changes can be followed. */
  function userRow(start: { passwordChangedAt: Date | null; plain: string }) {
    const row = {
      passwordHash: bcrypt.hashSync(start.plain, 4),
      passwordChangedAt: start.passwordChangedAt,
      email: 'emp@nid.test',
      tokenVersion: 3,
      refreshToken: 'old-hash' as string | null,
      role: { name: 'Employee' },
    };
    prisma.user.findUnique.mockImplementation(() =>
      Promise.resolve({ ...row }),
    );
    prisma.user.update.mockImplementation(
      ({ data }: { data: Partial<typeof row> }) => {
        Object.assign(row, data);
        return Promise.resolve({ ...row });
      },
    );
    return row;
  }

  it('status: never changed → no current password needed; changed before → needed', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ passwordChangedAt: null });
    await expect(service.getPasswordStatus('u-1')).resolves.toEqual({
      requiresCurrentPassword: false,
    });
    prisma.user.findUnique.mockResolvedValueOnce({
      passwordChangedAt: new Date('2026-09-01'),
    });
    await expect(service.getPasswordStatus('u-1')).resolves.toEqual({
      requiresCurrentPassword: true,
    });
  });

  it('status for an unknown user is refused', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.getPasswordStatus('ghost')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('FIRST change (e.g. from the default password123): no current password, and it is recorded', async () => {
    const row = userRow({ passwordChangedAt: null, plain: 'password123' });
    await expect(
      service.updateProfile('u-1', { newPassword: 'Mine-2026' }),
    ).resolves.toEqual(
      expect.objectContaining({
        success: true,
        message: 'Profile updated successfully',
      }),
    );
    await expect(bcrypt.compare('Mine-2026', row.passwordHash)).resolves.toBe(
      true,
    );
    expect(row.passwordChangedAt).toBeInstanceOf(Date);
  });

  it('LATER change without the current password is refused and nothing is written', async () => {
    const row = userRow({
      passwordChangedAt: new Date('2026-09-01'),
      plain: 'Mine-2026',
    });
    const before = row.passwordHash;
    await expect(
      service.updateProfile('u-1', { newPassword: 'Other-111' }),
    ).rejects.toThrow('กรุณากรอกรหัสผ่านปัจจุบัน');
    expect(row.passwordHash).toBe(before);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('LATER change with a wrong current password is refused; the rest of the profile is not touched either', async () => {
    userRow({ passwordChangedAt: new Date('2026-09-01'), plain: 'Mine-2026' });
    prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
    await expect(
      service.updateProfile('u-1', {
        currentPassword: 'wrong',
        newPassword: 'Other-111',
        phone: '0899999999',
      }),
    ).rejects.toThrow('รหัสผ่านปัจจุบันไม่ถูกต้อง');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.employee.update).not.toHaveBeenCalled();
  });

  it('LATER change with the correct current password succeeds', async () => {
    const row = userRow({
      passwordChangedAt: new Date('2026-09-01'),
      plain: 'Mine-2026',
    });
    await service.updateProfile('u-1', {
      currentPassword: 'Mine-2026',
      newPassword: 'Other-111',
    });
    await expect(bcrypt.compare('Other-111', row.passwordHash)).resolves.toBe(
      true,
    );
  });

  it('end to end: first change free → status flips → second change needs the password just set', async () => {
    userRow({ passwordChangedAt: null, plain: 'password123' });
    await service.updateProfile('u-1', { newPassword: 'First-111' });
    await expect(service.getPasswordStatus('u-1')).resolves.toEqual({
      requiresCurrentPassword: true,
    });
    await expect(
      service.updateProfile('u-1', { newPassword: 'Second-222' }),
    ).rejects.toThrow('กรุณากรอกรหัสผ่านปัจจุบัน');
    await expect(
      service.updateProfile('u-1', {
        currentPassword: 'password123',
        newPassword: 'Second-222',
      }),
    ).rejects.toThrow('รหัสผ่านปัจจุบันไม่ถูกต้อง');
    await expect(
      service.updateProfile('u-1', {
        currentPassword: 'First-111',
        newPassword: 'Second-222',
      }),
    ).resolves.toEqual(expect.objectContaining({ success: true }));
  });

  it('a profile edit without a password change never asks for the current password', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
    await service.updateProfile('u-1', { phone: '0899999999' });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.employee.update).toHaveBeenCalled();
  });

  it('a reset through the e-mailed link also counts as "changed" (records passwordChangedAt)', async () => {
    prisma.user.findFirst.mockResolvedValue(dbUser());
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    await service.forgotPassword('emp');
    const text = (mail.sendEmail.mock.calls as unknown[][])[0][2] as string;
    const token = /token=([^\s]+)/.exec(text)![1];
    await service.resetPassword({ token, newPassword: 'Reset-123' });
    const { data } = (
      prisma.user.updateMany.mock.calls as unknown[][]
    )[0][0] as {
      data: { passwordChangedAt: unknown };
    };
    expect(data.passwordChangedAt).toBeInstanceOf(Date);
  });
});

describe('UpdateProfileDto validation (what the settings forms send)', () => {
  const check = async (body: object) =>
    validate(plainToInstance(UpdateProfileDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it.each([
    ['only a new password (first change)', { newPassword: 'abcdef' }],
    ['current + new password', { currentPassword: 'x', newPassword: 'abcdef' }],
    ['only a phone number', { phone: '0812345678' }],
    ['the older "password" field name', { password: 'abcdef' }],
  ])('%s is accepted', async (_n, body) => {
    await expect(check(body)).resolves.toEqual([]);
  });

  it('a new password shorter than 6 characters is refused with a Thai message', async () => {
    const errors = await check({ newPassword: '123' });
    expect(JSON.stringify(errors)).toContain(
      'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร',
    );
  });

  it('unknown fields are refused', async () => {
    const errors = await check({ newPassword: 'abcdef', role: 'Admin' });
    expect(errors.map((e) => e.property)).toContain('role');
  });
});

describe('Business rule — a password change signs out every OTHER device, keeps this one', () => {
  function userRow() {
    const row = {
      passwordHash: bcrypt.hashSync('Mine-2026', 4),
      passwordChangedAt: new Date('2026-09-01') as Date | null,
      email: 'emp@nid.test',
      tokenVersion: 3,
      refreshToken: 'hash-of-old-refresh' as string | null,
      role: { name: 'Employee' },
    };
    prisma.user.findUnique.mockImplementation(() =>
      Promise.resolve({ ...row }),
    );
    prisma.user.update.mockImplementation(({ data }: { data: object }) => {
      Object.assign(row, data);
      return Promise.resolve({ ...row });
    });
    return row;
  }
  const change = () =>
    service.updateProfile('u-1', {
      currentPassword: 'Mine-2026',
      newPassword: 'Next-3030',
    });

  it('bumps tokenVersion: every access token issued before (all devices) stops working', async () => {
    const row = userRow();
    await change();
    expect(row.tokenVersion).toBe(4);
    // an old access token still carries version 3 → JwtStrategy refuses it
    const old = jwt.sign({ sub: 'u-1', tokenVersion: 3 }, { secret: SECRET });
    expect(
      jwt.verify<{ tokenVersion: number }>(old, { secret: SECRET })
        .tokenVersion,
    ).not.toBe(row.tokenVersion);
  });

  it('replaces the stored refresh token: other devices cannot refresh their way back in', async () => {
    const row = userRow();
    const out = (await change()) as { refreshToken: string };
    expect(row.refreshToken).not.toBe('hash-of-old-refresh');
    await expect(
      bcrypt.compare(out.refreshToken, row.refreshToken!),
    ).resolves.toBe(true);
  });

  it('THIS device gets a fresh token pair that works with the new version', async () => {
    userRow();
    const out = (await change()) as {
      accessToken: string;
      refreshToken: string;
    };
    const access = jwt.verify<{
      sub: string;
      role: string;
      tokenVersion: number;
    }>(out.accessToken, { secret: SECRET });
    expect(access).toEqual(
      expect.objectContaining({
        sub: 'u-1',
        role: 'Employee',
        tokenVersion: 4,
      }),
    );
    expect(() => {
      jwt.verify(out.refreshToken, { secret: REFRESH_SECRET });
    }).not.toThrow();
  });

  it('password, "changed" mark, version and refresh token are written in ONE update', async () => {
    userRow();
    await change();
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    const { data } = (prisma.user.update.mock.calls as unknown[][])[0][0] as {
      data: Record<string, unknown>;
    };
    expect(Object.keys(data).sort()).toEqual(
      [
        'passwordChangedAt',
        'passwordHash',
        'refreshToken',
        'tokenVersion',
      ].sort(),
    );
  });

  it('a refused change (wrong current password) signs nobody out', async () => {
    const row = userRow();
    await expect(
      service.updateProfile('u-1', {
        currentPassword: 'wrong',
        newPassword: 'Next-3030',
      }),
    ).rejects.toThrow('รหัสผ่านปัจจุบันไม่ถูกต้อง');
    expect(row.tokenVersion).toBe(3);
    expect(row.refreshToken).toBe('hash-of-old-refresh');
  });

  it('a profile edit without a password change returns no tokens and signs nobody out', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
    const out = await service.updateProfile('u-1', { phone: '0811111111' });
    expect(out).toEqual({
      success: true,
      message: 'Profile updated successfully',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('Security — the reset link always points at OUR site (no reset poisoning)', () => {
  function serviceWith(cfg: Record<string, string | undefined>) {
    const svc = new AuthService(
      prisma as never,
      jwt,
      { get: (k: string) => ({ ...config, ...cfg })[k] } as never,
      mail as never,
    );
    prisma.user.findFirst.mockResolvedValue(dbUser());
    return svc;
  }
  const linkIn = () =>
    /(\S+\/reset-password)\?token=/.exec(
      (mail.sendEmail.mock.calls as unknown[][]).at(-1)![2] as string,
    )![1];

  it('uses FRONTEND_URL from the server configuration', async () => {
    await serviceWith({
      frontendUrl: 'https://leave.nid.co.th',
    }).forgotPassword('emp');
    expect(linkIn()).toBe('https://leave.nid.co.th/reset-password');
  });

  it('a trailing slash or a comma-separated list is handled', async () => {
    await serviceWith({
      frontendUrl: ' https://leave.nid.co.th/ , https://other.example ',
    }).forgotPassword('emp');
    expect(linkIn()).toBe('https://leave.nid.co.th/reset-password');
  });

  it('falls back to the first CORS origin, then to local development', async () => {
    await serviceWith({
      frontendUrl: undefined,
      corsOrigins: 'https://hr.nid.co.th,https://x.example',
    }).forgotPassword('emp');
    expect(linkIn()).toBe('https://hr.nid.co.th/reset-password');

    await serviceWith({
      frontendUrl: undefined,
      corsOrigins: undefined,
    }).forgotPassword('emp');
    expect(linkIn()).toBe('http://localhost:3000/reset-password');
  });

  it('the controller ignores forged Origin / Referer headers: only the username reaches the service', () => {
    const svc = { forgotPassword: jest.fn() };
    const ctrl = new AuthController(svc as never);
    // the handler has no header parameters any more
    expect(
      (
        Object.getOwnPropertyDescriptor(
          AuthController.prototype,
          'forgotPassword',
        )!.value as (...a: unknown[]) => unknown
      ).length,
    ).toBe(1);
    void ctrl.forgotPassword({ username: 'victim' });
    expect(svc.forgotPassword).toHaveBeenCalledWith('victim');
  });
});

describe('Business rule — names cannot be changed through the profile endpoint', () => {
  const check = async (body: object) =>
    validate(plainToInstance(UpdateProfileDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it.each([
    ['firstName', { firstName: '<img src=x onerror=alert(1)>' }],
    ['lastName', { lastName: 'ใหม่' }],
  ])('sending %s is refused by validation', async (field, body) => {
    const errors = await check(body);
    expect(errors.map((e) => e.property)).toContain(field);
  });

  it('phone is still editable', async () => {
    await expect(check({ phone: '0812345678' })).resolves.toEqual([]);
  });
});
