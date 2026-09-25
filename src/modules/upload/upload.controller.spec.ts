/// <reference types="jest" />
import {
  BadRequestException,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';
import * as fs from 'fs';
import { UploadController, detectFileType } from './upload.controller';

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: jest.fn(actual.existsSync),
    unlinkSync: jest.fn(actual.unlinkSync),
    readFileSync: jest.fn(actual.readFileSync),
  };
});
const actualFs = jest.requireActual<typeof import('fs')>('fs');

const PDF = Buffer.from('%PDF-1.7 test');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const GIF = Buffer.from('GIF89a....');
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);

const me = { id: 'u-1', email: 'a@nid.test', role: 'Employee' };
const file = (
  buffer: Buffer | undefined,
  mimetype = 'application/pdf',
  path?: string,
) =>
  ({
    buffer,
    mimetype,
    path,
    originalname: 'x',
  }) as unknown as Express.Multer.File;

interface AttachmentRow {
  id: string;
  leaveRequestId: string;
  filePath: string;
}

/** Attachment rows live in `attachments`; $transaction rolls them back on error like the real DB. */
function createPrisma() {
  const attachments: AttachmentRow[] = [];
  let seq = 0;
  const prisma = {
    attachments,
    leaveRequest: { findUnique: jest.fn() },
    leaveAttachment: {
      deleteMany: jest.fn(
        ({ where }: { where: { leaveRequestId: string } }) => {
          const keep = attachments.filter(
            (a) => a.leaveRequestId !== where.leaveRequestId,
          );
          const count = attachments.length - keep.length;
          attachments.splice(0, attachments.length, ...keep);
          return Promise.resolve({ count });
        },
      ),
      create: jest.fn(({ data }: { data: Omit<AttachmentRow, 'id'> }) => {
        const row = { id: `att-${++seq}`, ...data };
        attachments.push(row);
        return Promise.resolve(row);
      }),
    },
    user: { update: jest.fn() },
  };
  return Object.assign(prisma, {
    $transaction: jest.fn(async (fn: (tx: typeof prisma) => unknown) => {
      const snapshot = [...attachments];
      try {
        return await fn(prisma);
      } catch (e) {
        attachments.splice(0, attachments.length, ...snapshot);
        throw e;
      }
    }),
  });
}
const OLD = {
  id: 'att-old',
  leaveRequestId: 'leave-1',
  filePath: 'data:application/pdf;base64,OLD',
};
let prisma: ReturnType<typeof createPrisma>;
let ctrl: UploadController;
const exists = fs.existsSync as unknown as jest.Mock;
const unlink = fs.unlinkSync as unknown as jest.Mock;
const read = fs.readFileSync as unknown as jest.Mock;

beforeEach(() => {
  prisma = createPrisma();
  ctrl = new UploadController(prisma as never);
  prisma.leaveRequest.findUnique.mockResolvedValue({
    id: 'leave-1',
    employee: { userId: 'u-1' },
  });
  exists.mockReset().mockReturnValue(true);
  unlink.mockReset().mockImplementation(() => undefined);
  read.mockReset().mockImplementation(actualFs.readFileSync);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  exists.mockImplementation(actualFs.existsSync);
  unlink.mockImplementation(actualFs.unlinkSync);
});

describe('Replacing an attachment never loses the existing one (BUG #6)', () => {
  beforeEach(() => prisma.attachments.push({ ...OLD }));

  it.each([
    ['an executable', EXE],
    ['a GIF', GIF],
    ['a too-short file', Buffer.from([0x25, 0x50])],
  ])(
    'uploading %s is rejected and the previous attachment is kept',
    async (_n, buf) => {
      await expect(ctrl.uploadFile(file(buf), 'leave-1', me)).rejects.toThrow(
        'ประเภทไฟล์ไม่ถูกต้องหรือไฟล์อาจแฝงอันตราย',
      );
      expect(prisma.attachments).toEqual([OLD]);
      expect(prisma.leaveAttachment.deleteMany).not.toHaveBeenCalled();
    },
  );

  it('an unreadable file is rejected and the previous attachment is kept', async () => {
    exists.mockReturnValue(false);
    await expect(
      ctrl.uploadFile(
        file(undefined, 'application/pdf', 'uploads/gone'),
        'leave-1',
        me,
      ),
    ).rejects.toThrow('ไม่สามารถอ่านไฟล์ได้');
    expect(prisma.attachments).toEqual([OLD]);
  });

  it('if saving the new file fails, the delete is rolled back and the old one is kept', async () => {
    prisma.leaveAttachment.create.mockRejectedValueOnce({
      code: 'P2000',
      message: 'too long',
    });
    await expect(ctrl.uploadFile(file(PDF), 'leave-1', me)).rejects.toThrow(
      PayloadTooLargeException,
    );
    expect(prisma.leaveAttachment.deleteMany).toHaveBeenCalled();
    expect(prisma.attachments).toEqual([OLD]);
  });

  it('a valid file replaces the old one inside a single transaction', async () => {
    await ctrl.uploadFile(file(PNG, 'image/png'), 'leave-1', me);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.attachments).toEqual([
      expect.objectContaining({
        leaveRequestId: 'leave-1',
        filePath: `data:image/png;base64,${PNG.toString('base64')}`,
      }),
    ]);
  });

  it('other leave requests’ attachments are never touched', async () => {
    prisma.attachments.push({
      id: 'att-other',
      leaveRequestId: 'leave-9',
      filePath: 'x',
    });
    await ctrl.uploadFile(file(PDF), 'leave-1', me);
    expect(prisma.attachments.map((a) => a.leaveRequestId).sort()).toEqual([
      'leave-1',
      'leave-9',
    ]);
  });
});

describe('UploadController.uploadFile (leave attachment)', () => {
  it('missing file or leaveRequestId is refused before touching the database', async () => {
    await expect(
      ctrl.uploadFile(undefined as never, 'leave-1', me),
    ).rejects.toThrow('กรุณาเลือกไฟล์ก่อนอัปโหลด');
    await expect(ctrl.uploadFile(file(PDF), '', me)).rejects.toThrow(
      'ไม่พบรหัสคำขอลา (leaveRequestId)',
    );
    expect(prisma.leaveRequest.findUnique).not.toHaveBeenCalled();
  });

  it('unknown leave request: refused and the temp file is removed', async () => {
    prisma.leaveRequest.findUnique.mockResolvedValue(null);
    await expect(
      ctrl.uploadFile(
        file(undefined, 'application/pdf', 'uploads/tmp-1'),
        'nope',
        me,
      ),
    ).rejects.toThrow('ไม่พบคำขอลาที่ต้องการแนบไฟล์');
    expect(unlink).toHaveBeenCalledWith('uploads/tmp-1');
    expect(prisma.leaveAttachment.create).not.toHaveBeenCalled();
  });

  it('IDOR: attaching to another user’s leave is forbidden, temp file removed, nothing written', async () => {
    prisma.leaveRequest.findUnique.mockResolvedValue({
      id: 'leave-2',
      employee: { userId: 'u-OTHER' },
    });
    await expect(
      ctrl.uploadFile(
        file(undefined, 'application/pdf', 'uploads/tmp-2'),
        'leave-2',
        me,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(unlink).toHaveBeenCalledWith('uploads/tmp-2');
    expect(prisma.leaveAttachment.deleteMany).not.toHaveBeenCalled();
    expect(prisma.leaveAttachment.create).not.toHaveBeenCalled();
  });

  it.each([
    ['PDF', PDF, 'application/pdf'],
    ['PNG', PNG, 'image/png'],
    ['JPEG', JPG, 'image/jpeg'],
  ])(
    'a real %s is stored as a data URL and replaces older attachments',
    async (_n, buf, mime) => {
      const out = await ctrl.uploadFile(file(buf, mime), 'leave-1', me);
      expect(prisma.leaveAttachment.deleteMany).toHaveBeenCalledWith({
        where: { leaveRequestId: 'leave-1' },
      });
      expect(prisma.leaveAttachment.create).toHaveBeenCalledWith({
        data: {
          leaveRequestId: 'leave-1',
          filePath: `data:${mime};base64,${buf.toString('base64')}`,
          fileType: mime,
        },
      });
      expect(out.message).toBe('อัปโหลดไฟล์สำเร็จ');
    },
  );

  it('a disk-stored upload is read, stored, and its temp file deleted', async () => {
    read.mockReturnValue(PDF);
    await ctrl.uploadFile(
      file(undefined, 'application/pdf', 'uploads/tmp-3'),
      'leave-1',
      me,
    );
    expect(read).toHaveBeenCalledWith('uploads/tmp-3');
    expect(unlink).toHaveBeenCalledWith('uploads/tmp-3');
    expect(prisma.leaveAttachment.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an executable renamed to .pdf', EXE],
    ['a GIF', GIF],
    ['a file shorter than 4 bytes', Buffer.from([0x25, 0x50])],
  ])(
    '%s is rejected by the content (magic bytes) check and no attachment is created',
    async (_n, buf) => {
      await expect(ctrl.uploadFile(file(buf), 'leave-1', me)).rejects.toThrow(
        'ประเภทไฟล์ไม่ถูกต้องหรือไฟล์อาจแฝงอันตราย',
      );
      expect(prisma.leaveAttachment.create).not.toHaveBeenCalled();
    },
  );

  it('a file that cannot be read is refused', async () => {
    exists.mockReturnValue(false);
    await expect(
      ctrl.uploadFile(
        file(undefined, 'application/pdf', 'uploads/gone'),
        'leave-1',
        me,
      ),
    ).rejects.toThrow('ไม่สามารถอ่านไฟล์ได้ กรุณาลองใหม่อีกครั้ง');
  });

  it('a database "too long" error becomes 413 Payload Too Large', async () => {
    prisma.leaveAttachment.create.mockRejectedValue({
      code: 'P2000',
      message: 'too long',
    });
    await expect(ctrl.uploadFile(file(PDF), 'leave-1', me)).rejects.toThrow(
      PayloadTooLargeException,
    );
  });

  it('any other database error becomes a generic 400, without leaking details', async () => {
    prisma.leaveAttachment.create.mockRejectedValue(
      new Error('ECONNRESET secret-host:3306'),
    );
    const err = await ctrl
      .uploadFile(file(PDF), 'leave-1', me)
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe(
      'เกิดข้อผิดพลาดในการอัปโหลดไฟล์ กรุณาลองใหม่อีกครั้ง',
    );
  });
});

describe('UploadController.uploadAvatar', () => {
  it('stores a PNG or JPEG on the caller’s own user row only', async () => {
    await ctrl.uploadAvatar(file(PNG, 'image/png'), me);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { avatarUrl: `data:image/png;base64,${PNG.toString('base64')}` },
    });
  });

  it.each([
    ['PDF', PDF],
    ['GIF', GIF],
    ['executable', EXE],
  ])('a %s avatar is rejected and nothing is saved', async (_n, buf) => {
    await expect(ctrl.uploadAvatar(file(buf, 'image/png'), me)).rejects.toThrow(
      'รูปภาพโปรไฟล์ต้องเป็นไฟล์ JPEG หรือ PNG เท่านั้น',
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('missing file is refused', async () => {
    await expect(ctrl.uploadAvatar(undefined as never, me)).rejects.toThrow(
      'File is required',
    );
  });

  it('oversized image rejected by the database becomes 413', async () => {
    prisma.user.update.mockRejectedValue({ message: 'packet too large' });
    await expect(
      ctrl.uploadAvatar(file(JPG, 'image/jpeg'), me),
    ).rejects.toThrow(PayloadTooLargeException);
  });
});

describe('Security — the stored type comes from the file content, never the client header', () => {
  it('a forged Content-Type with markup is ignored for attachments', async () => {
    await ctrl.uploadFile(
      file(PNG, 'image/png" onerror="alert(1)'),
      'leave-1',
      me,
    );
    expect(prisma.leaveAttachment.create).toHaveBeenCalledWith({
      data: {
        leaveRequestId: 'leave-1',
        filePath: `data:image/png;base64,${PNG.toString('base64')}`,
        fileType: 'image/png',
      },
    });
  });

  it('a PDF sent as "text/html" is stored as application/pdf', async () => {
    await ctrl.uploadFile(file(PDF, 'text/html'), 'leave-1', me);
    const { data } = (
      prisma.leaveAttachment.create.mock.calls as unknown[][]
    )[0][0] as { data: { filePath: string; fileType: string } };
    expect(data.fileType).toBe('application/pdf');
    expect(data.filePath.startsWith('data:application/pdf;base64,')).toBe(true);
  });

  it('avatars too: a JPEG sent as "image/svg+xml" is stored as image/jpeg', async () => {
    await ctrl.uploadAvatar(file(JPG, 'image/svg+xml'), me);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { avatarUrl: `data:image/jpeg;base64,${JPG.toString('base64')}` },
    });
  });

  it.each([
    [PDF, 'application/pdf'],
    [PNG, 'image/png'],
    [JPG, 'image/jpeg'],
    [Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'application/zip'],
    [Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), 'application/msword'],
    [GIF, null],
    [EXE, null],
    [Buffer.from([0x25]), null],
  ])('detectFileType(case %#) → %p', (buf, type) => {
    expect(detectFileType(buf)).toBe(type);
  });
});
