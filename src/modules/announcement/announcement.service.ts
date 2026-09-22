import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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

  async create(data: {
    title: string;
    subtitle: string;
    isImportant: boolean;
  }) {
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

  update(
    id: string,
    data: { title?: string; subtitle?: string; isImportant?: boolean },
  ) {
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
