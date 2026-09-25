/// <reference types="jest" />
import { BadRequestException } from '@nestjs/common';
import { AnnouncementService, dataUrlByteSize } from './announcement.service';
import { AnnouncementController } from './announcement.controller';

function createPrisma() {
  return {
    announcement: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }: { data: object }) =>
        Promise.resolve({ id: 'a-1', ...data }),
      ),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'u-1' }, { id: 'u-2' }, { id: 'u-3' }]),
    },
    notification: { create: jest.fn() },
  };
}
let prisma: ReturnType<typeof createPrisma>;
let service: AnnouncementService;
beforeEach(() => {
  prisma = createPrisma();
  service = new AnnouncementService(prisma as never);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('AnnouncementService', () => {
  it('lists newest first, with an optional limit', async () => {
    await service.findAll();
    expect(prisma.announcement.findMany).toHaveBeenLastCalledWith({
      orderBy: { createdAt: 'desc' },
    });
    await service.findAll(2);
    expect(prisma.announcement.findMany).toHaveBeenLastCalledWith({
      orderBy: { createdAt: 'desc' },
      take: 2,
    });
  });

  it('create saves the announcement and notifies every user once', async () => {
    const out = await service.create({
      title: 'ปิดปรับปรุงระบบ',
      subtitle: 'คืนวันศุกร์',
      isImportant: true,
    });
    expect(out).toEqual(
      expect.objectContaining({ id: 'a-1', title: 'ปิดปรับปรุงระบบ' }),
    );
    expect(prisma.notification.create).toHaveBeenCalledTimes(3);
    for (const id of ['u-1', 'u-2', 'u-3'])
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: id,
          title: 'ประกาศใหม่จาก HR',
          message: 'ปิดปรับปรุงระบบ: คืนวันศุกร์',
          type: 'SYSTEM',
          redirectUrl: '/dashboard/user/page',
        },
      });
  });

  it('without a subtitle the notice carries only the title', async () => {
    await service.create({
      title: 'หยุดยาว',
      subtitle: '',
      isImportant: false,
    });
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ message: 'หยุดยาว' }) as unknown,
      }),
    );
  });

  it('a notification failure does not undo or fail the announcement', async () => {
    prisma.notification.create.mockRejectedValue(new Error('db'));
    await expect(
      service.create({ title: 't', subtitle: '', isImportant: false }),
    ).resolves.toEqual(expect.objectContaining({ id: 'a-1' }));
  });

  it('a failed announcement insert notifies nobody', async () => {
    prisma.announcement.create.mockRejectedValue(new Error('db'));
    await expect(
      service.create({ title: 't', subtitle: '', isImportant: false }),
    ).rejects.toThrow('db');
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('update and delete target the given id', async () => {
    await service.update('a-9', { title: 'x' });
    expect(prisma.announcement.update).toHaveBeenCalledWith({
      where: { id: 'a-9' },
      data: { title: 'x' },
    });
    await service.delete('a-9');
    expect(prisma.announcement.delete).toHaveBeenCalledWith({
      where: { id: 'a-9' },
    });
  });
});

describe('AnnouncementController (error envelope)', () => {
  it('turns service errors into { success: false } instead of throwing', async () => {
    prisma.announcement.delete.mockRejectedValue(new Error('not found'));
    const ctrl = new AnnouncementController(service);
    await expect(ctrl.deleteAnnouncement('missing')).resolves.toEqual({
      success: false,
      message: 'Failed to delete announcement',
    });
  });

  it('parses the limit query', async () => {
    const ctrl = new AnnouncementController(service);
    await ctrl.getAnnouncements('3');
    expect(prisma.announcement.findMany).toHaveBeenLastCalledWith({
      orderBy: { createdAt: 'desc' },
      take: 3,
    });
  });
});

describe('Business rule — announcement attachments are at most 5 MB', () => {
  const MB = 1024 * 1024;
  /** A data URL whose decoded file is exactly `bytes` long. */
  const dataUrl = (bytes: number) =>
    `data:application/pdf;base64,${Buffer.alloc(bytes, 1).toString('base64')}`;

  it('measures the real file size behind a data URL', () => {
    for (const n of [0, 1, 2, 3, 1000, 5 * MB]) {
      expect(dataUrlByteSize(dataUrl(n))).toBe(n);
    }
  });

  it.each([
    ['exactly 5 MB', 5 * MB],
    ['a small PDF', 200 * 1024],
  ])('create with %s is accepted', async (_n, bytes) => {
    await service.create({
      title: 't',
      subtitle: '',
      isImportant: false,
      attachmentData: dataUrl(bytes),
      attachmentName: 'a.pdf',
    });
    expect(prisma.announcement.create).toHaveBeenCalled();
  });

  it('create with 5 MB + 1 byte is refused; nothing saved, nobody notified', async () => {
    await expect(
      service.create({
        title: 't',
        subtitle: '',
        isImportant: false,
        attachmentData: dataUrl(5 * MB + 1),
        attachmentName: 'big.pdf',
      }),
    ).rejects.toThrow('ไฟล์แนบของประกาศต้องมีขนาดไม่เกิน 5 MB');
    expect(prisma.announcement.create).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('update with an oversized attachment is refused and nothing is written', async () => {
    await expect(
      service.update('a-1', { attachmentData: dataUrl(6 * MB) }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.announcement.update).not.toHaveBeenCalled();
  });

  it('the controller passes the size error through (not a generic "failed")', async () => {
    const ctrl = new AnnouncementController(service);
    await expect(
      ctrl.createAnnouncement({
        title: 't',
        subtitle: '',
        isImportant: false,
        attachmentData: dataUrl(6 * MB),
      }),
    ).rejects.toThrow('ไฟล์แนบของประกาศต้องมีขนาดไม่เกิน 5 MB');
  });

  it('no attachment, or removing it (empty), is fine', async () => {
    await service.update('a-1', { attachmentData: '', attachmentName: '' });
    expect(prisma.announcement.update).toHaveBeenCalled();
  });
});

describe('Security — announcement attachments are limited to document/image types', () => {
  const b64 = Buffer.from('file').toString('base64');
  it.each([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream',
  ])('%s is accepted', async (type) => {
    await service.update('a-1', {
      attachmentData: `data:${type};base64,${b64}`,
    });
    expect(prisma.announcement.update).toHaveBeenCalled();
  });

  it.each([
    ['HTML', `data:text/html;base64,${b64}`],
    ['SVG', `data:image/svg+xml;base64,${b64}`],
    ['JavaScript', `data:application/javascript;base64,${b64}`],
    ['not a data URL', 'javascript:alert(1)'],
    ['markup in the type', `data:image/png" onerror="x;base64,${b64}`],
  ])('%s is refused and nothing is written', async (_n, value) => {
    await expect(
      service.update('a-1', { attachmentData: value }),
    ).rejects.toThrow(
      'ไฟล์แนบของประกาศต้องเป็น PDF, Word, Excel หรือรูปภาพ (PNG, JPG) เท่านั้น',
    );
    expect(prisma.announcement.update).not.toHaveBeenCalled();
  });
});
