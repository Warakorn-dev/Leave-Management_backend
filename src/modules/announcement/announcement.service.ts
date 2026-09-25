import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Announcement attachments are stored as base64 data URLs (business rule 2026-09-24: max 5 MB). */
export const ANNOUNCEMENT_MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const ANNOUNCEMENT_ATTACHMENT_TOO_LARGE =
  'ไฟล์แนบของประกาศต้องมีขนาดไม่เกิน 5 MB';

type AnnouncementInput = {
  title?: string;
  subtitle?: string;
  isImportant?: boolean;
  attachmentData?: string | null;
  attachmentName?: string | null;
};

/** Size of the original file behind a base64 data URL (or bare base64). */
export function dataUrlByteSize(dataUrl: string): number {
  const b64 = dataUrl.includes(',')
    ? dataUrl.slice(dataUrl.indexOf(',') + 1)
    : dataUrl;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/**
 * Types the HR page offers (PDF, Word, Excel, images). octet-stream covers
 * browsers that do not know a Word/Excel type. HTML, SVG, scripts etc. are
 * refused: the data URL is shown/downloaded in other people's browsers.
 */
const ALLOWED_ATTACHMENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
];
export const ANNOUNCEMENT_ATTACHMENT_BAD_TYPE =
  'ไฟล์แนบของประกาศต้องเป็น PDF, Word, Excel หรือรูปภาพ (PNG, JPG) เท่านั้น';
const DATA_URL = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,[A-Za-z0-9+/=]*$/i;

function assertAttachmentSize(data: AnnouncementInput): void {
  if (!data.attachmentData) return;
  const type = DATA_URL.exec(data.attachmentData)?.[1]?.toLowerCase();
  if (!type || !ALLOWED_ATTACHMENT_TYPES.includes(type)) {
    throw new BadRequestException(ANNOUNCEMENT_ATTACHMENT_BAD_TYPE);
  }
  if (
    dataUrlByteSize(data.attachmentData) > ANNOUNCEMENT_MAX_ATTACHMENT_BYTES
  ) {
    throw new BadRequestException(ANNOUNCEMENT_ATTACHMENT_TOO_LARGE);
  }
}

@Injectable()
export class AnnouncementService {
  constructor(private prisma: PrismaService) {}

  findAll(limit?: number) {
    const query: Prisma.AnnouncementFindManyArgs = {
      orderBy: { createdAt: 'desc' },
    };
    if (limit) {
      query.take = limit;
    }
    return this.prisma.announcement.findMany(query);
  }

  async create(
    data: AnnouncementInput & {
      title: string;
      subtitle: string;
      isImportant: boolean;
    },
  ) {
    assertAttachmentSize(data);
    const item = await this.prisma.announcement.create({
      data,
    });

    try {
      const allUsers = await this.prisma.user.findMany({
        select: { id: true },
      });
      for (const u of allUsers) {
        await this.prisma.notification.create({
          data: {
            userId: u.id,
            title: 'ประกาศใหม่จาก HR',
            message: data.title + (data.subtitle ? `: ${data.subtitle}` : ''),
            type: 'SYSTEM',
            redirectUrl: '/dashboard/user/page',
          },
        });
      }
    } catch (err) {
      console.error('Failed to notify users about HR announcement', err);
    }

    return item;
  }

  async update(id: string, data: AnnouncementInput) {
    assertAttachmentSize(data);
    return this.prisma.announcement.update({
      where: { id },
      data,
    });
  }

  delete(id: string) {
    return this.prisma.announcement.delete({
      where: { id },
    });
  }
}
