import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AnnouncementService {
  constructor(private prisma: PrismaService) {}

  async findAll(limit?: number) {
    // using 'any' to bypass TS error until Prisma client is regenerated
    const query: any = {
      orderBy: { createdAt: 'desc' },
    };
    if (limit) {
      query.take = limit;
    }
    return (this.prisma as any).announcement.findMany(query);
  }

  async create(data: { title: string; subtitle: string; isImportant: boolean }) {
    const item = await (this.prisma as any).announcement.create({
      data,
    });

    try {
      const allUsers = await this.prisma.user.findMany({ select: { id: true } });
      for (const u of allUsers) {
        await this.prisma.notification.create({
          data: {
            userId: u.id,
            title: 'ประกาศใหม่จาก HR',
            message: data.title + (data.subtitle ? `: ${data.subtitle}` : ''),
            type: 'SYSTEM',
            redirectUrl: '/dashboard/user/page',
          }
        });
      }
    } catch (err) {
      console.error('Failed to notify users about HR announcement', err);
    }

    return item;
  }

  async update(id: string, data: { title?: string; subtitle?: string; isImportant?: boolean }) {
    return (this.prisma as any).announcement.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    return (this.prisma as any).announcement.delete({
      where: { id },
    });
  }
}
