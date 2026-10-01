/// <reference types="jest" />
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { JwtRefreshStrategy } from './jwt-refresh.strategy';

const config = (values: Record<string, string | undefined>) =>
  ({ get: (k: string) => values[k] }) as never;

function prismaWith(user: unknown) {
  return { user: { findUnique: jest.fn().mockResolvedValue(user) } };
}

const activeUser = {
  id: 'u-1',
  email: 'emp@nid.test',
  isActive: true,
  tokenVersion: 2,
  role: { name: 'Employee' },
};

describe('JwtStrategy (every protected request)', () => {
  it('refuses to start without JWT_SECRET', () => {
    expect(
      () => new JwtStrategy(config({}), prismaWith(activeUser) as never),
    ).toThrow('JWT_SECRET is not configured.');
  });

  it('returns id, email and role for a current token of an active user', async () => {
    const prisma = prismaWith(activeUser);
    const s = new JwtStrategy(config({ 'jwt.secret': 's' }), prisma as never);
    await expect(s.validate({ sub: 'u-1', tokenVersion: 2 })).resolves.toEqual({
      id: 'u-1',
      email: 'emp@nid.test',
      role: 'Employee',
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      include: { role: true },
    });
  });

  it('the role comes from the database, not from the token (a changed role applies at once)', async () => {
    const s = new JwtStrategy(
      config({ 'jwt.secret': 's' }),
      prismaWith({ ...activeUser, role: { name: 'HR' } }) as never,
    );
    const out = await s.validate({
      sub: 'u-1',
      tokenVersion: 2,
      role: 'Employee',
    } as never);
    expect(out.role).toBe('HR');
  });

  it.each([
    ['deleted user', null, 'User not found'],
    ['suspended user', { ...activeUser, isActive: false }, 'ACCOUNT_SUSPENDED'],
  ])('%s is refused', async (_n, user, message) => {
    const s = new JwtStrategy(
      config({ 'jwt.secret': 's' }),
      prismaWith(user) as never,
    );
    await expect(s.validate({ sub: 'u-1', tokenVersion: 2 })).rejects.toThrow(
      new UnauthorizedException(message),
    );
  });

  it.each([
    ['older version (after logout / force-logout / password reset)', 1],
    ['token without a version (e.g. a password-reset token)', undefined],
  ])('a token with an %s is refused', async (_n, tokenVersion) => {
    const s = new JwtStrategy(
      config({ 'jwt.secret': 's' }),
      prismaWith(activeUser) as never,
    );
    await expect(
      s.validate({ sub: 'u-1', tokenVersion } as never),
    ).rejects.toThrow('Token is invalid or expired');
  });
});

describe('JwtRefreshStrategy', () => {
  it('passes the raw bearer token through so AuthService can compare it with the stored hash', async () => {
    const s = new JwtRefreshStrategy(
      config({ 'jwt.refreshSecret': 'r' }),
      prismaWith(activeUser) as never,
    );
    const req = { get: () => 'Bearer the.refresh.token' };
    await expect(s.validate(req as never, { sub: 'u-1' })).resolves.toEqual({
      id: 'u-1',
      email: 'emp@nid.test',
      role: 'Employee',
      refreshToken: 'the.refresh.token',
    });
  });

  it('unknown user is refused', async () => {
    const s = new JwtRefreshStrategy(
      config({ 'jwt.refreshSecret': 'r' }),
      prismaWith(null) as never,
    );
    await expect(
      s.validate({ get: () => 'Bearer x' } as never, { sub: 'u-x' }),
    ).rejects.toThrow('User not found');
  });
});
