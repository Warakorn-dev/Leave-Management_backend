/// <reference types="jest" />
import * as fs from 'fs';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { EmployeeQueryService } from './employee-query.service';

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: jest.fn(() => true),
    unlinkSync: jest.fn(),
  };
});
const unlink = fs.unlinkSync as unknown as jest.Mock;

const PNG_URL = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')}`;

function serviceWithOldAvatar(old: string | null) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'u-1', avatarUrl: old }),
      update: jest.fn(({ data }: { data: { avatarUrl: string | null } }) =>
        Promise.resolve({ id: 'u-1', avatarUrl: data.avatarUrl }),
      ),
    },
  };
  return { prisma, svc: new EmployeeQueryService(prisma as never) };
}

beforeEach(() => unlink.mockClear());

describe('Security — PATCH /leave/me/avatar (was: arbitrary file deletion)', () => {
  it.each([
    ['a path traversal', '../.env'],
    ['a server file', 'dist/main.js'],
    ['an absolute path', '/etc/passwd'],
    ['an SVG (can carry script)', 'data:image/svg+xml;base64,PHN2Zz4='],
    ['HTML', 'data:text/html;base64,PGgxPg=='],
    ['javascript:', 'javascript:alert(1)'],
  ])('%s is refused and nothing is stored', async (_n, value) => {
    const { prisma, svc } = serviceWithOldAvatar(null);
    await expect(svc.updateAvatar('u-1', value)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });

  it.each(['png', 'jpeg', 'webp', 'gif'])(
    'a %s data URL is accepted',
    async (t) => {
      const { prisma, svc } = serviceWithOldAvatar(null);
      const url = `data:image/${t};base64,AAAA`;
      await svc.updateAvatar('u-1', url);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { avatarUrl: url },
      });
    },
  );

  it('removing the photo (null) is allowed', async () => {
    const { prisma, svc } = serviceWithOldAvatar(PNG_URL);
    await svc.updateAvatar('u-1', null);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { avatarUrl: null },
    });
  });

  it.each([
    ['../.env'],
    ['../../outside/file.txt'],
    ['dist/main.js'],
    ['/etc/passwd'],
    ['uploads/../.env'],
  ])(
    'an old stored path %p is NEVER deleted (outside ./uploads)',
    async (old) => {
      const { svc } = serviceWithOldAvatar(old);
      await svc.updateAvatar('u-1', PNG_URL);
      expect(unlink).not.toHaveBeenCalled();
    },
  );

  it('a legacy avatar file inside ./uploads is still cleaned up', async () => {
    const { svc } = serviceWithOldAvatar('/uploads/avatar-123.png');
    await svc.updateAvatar('u-1', PNG_URL);
    expect(unlink).toHaveBeenCalledWith(
      path.resolve(process.cwd(), 'uploads/avatar-123.png'),
    );
  });
});
