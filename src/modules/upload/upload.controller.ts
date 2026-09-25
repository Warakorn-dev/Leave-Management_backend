import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  PayloadTooLargeException,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from 'src/prisma/prisma.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUser as CurrentUserPayload } from '../auth/types/current-user.type';
import * as fs from 'fs';

/**
 * The real type of an uploaded file, from its first bytes ("magic bytes").
 * Returns null for anything that is not an accepted document/image type.
 */
export function detectFileType(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  const [a, b, c, d] = buf;
  if (a === 0x25 && b === 0x50 && c === 0x44 && d === 0x46)
    return 'application/pdf'; // %PDF
  if (a === 0xff && b === 0xd8 && c === 0xff) return 'image/jpeg';
  if (a === 0x89 && b === 0x50 && c === 0x4e && d === 0x47) return 'image/png';
  if (a === 0x50 && b === 0x4b && c === 0x03 && d === 0x04)
    return 'application/zip'; // DOCX/XLSX containers
  if (a === 0xd0 && b === 0xcf && c === 0x11 && d === 0xe0)
    return 'application/msword'; // legacy DOC/XLS
  return null;
}

/** File content from memory or disk storage; the temp file is removed after reading. */
function readUploadedFile(file: Express.Multer.File): Buffer | null {
  if (file.buffer) return file.buffer;
  if (file.path && fs.existsSync(file.path)) {
    const buf = fs.readFileSync(file.path);
    try {
      fs.unlinkSync(file.path);
    } catch (error) {
      console.warn('Failed to delete temp file:', error);
    }
    return buf;
  }
  return null;
}

@ApiTags('Upload Module')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('upload')
export class UploadController {
  constructor(private prisma: PrismaService) {}

  @Post()
  @ApiOperation({ summary: 'Upload file for leave request attachment' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        leaveRequestId: {
          type: 'string',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('leaveRequestId') leaveRequestId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    if (!file) {
      throw new BadRequestException('กรุณาเลือกไฟล์ก่อนอัปโหลด');
    }
    if (!leaveRequestId) {
      throw new BadRequestException('ไม่พบรหัสคำขอลา (leaveRequestId)');
    }

    // Verify leave request exists
    const leaveRequest = await this.prisma.leaveRequest.findUnique({
      where: { id: leaveRequestId },
      include: { employee: { include: { user: true } } },
    });
    if (!leaveRequest) {
      // Clean up uploaded temp file
      if (file.path && fs.existsSync(file.path)) {
        try {
          fs.unlinkSync(file.path);
        } catch (error) {
          console.warn('Failed to delete temp file:', error);
        }
      }
      throw new BadRequestException('ไม่พบคำขอลาที่ต้องการแนบไฟล์');
    }

    if (leaveRequest.employee.userId !== user.id) {
      // Clean up uploaded temp file
      if (file.path && fs.existsSync(file.path)) {
        try {
          fs.unlinkSync(file.path);
        } catch (error) {
          console.warn('Failed to delete temp file:', error);
        }
      }
      throw new ForbiddenException('ไม่มีสิทธิ์แนบไฟล์ในคำขอลานี้');
    }

    try {
      const fileBuffer = readUploadedFile(file);
      if (!fileBuffer) {
        throw new BadRequestException(
          'ไม่สามารถอ่านไฟล์ได้ กรุณาลองใหม่อีกครั้ง',
        );
      }

      // Security: the type comes from the file's magic bytes, never from the
      // client's Content-Type (which is free text and could inject markup
      // into the data URL the browsers later embed).
      const detectedType = detectFileType(fileBuffer);
      if (!detectedType) {
        throw new BadRequestException(
          'ประเภทไฟล์ไม่ถูกต้องหรือไฟล์อาจแฝงอันตราย',
        );
      }
      const base64Data = `data:${detectedType};base64,${fileBuffer.toString('base64')}`;

      // Replace the old attachment only after the new file passed every check,
      // and atomically: if saving the new one fails, the old one is kept.
      const attachment = await this.prisma.$transaction(async (tx) => {
        await tx.leaveAttachment.deleteMany({ where: { leaveRequestId } });
        return tx.leaveAttachment.create({
          data: {
            leaveRequestId,
            filePath: base64Data,
            fileType: detectedType,
          },
        });
      });

      return {
        message: 'อัปโหลดไฟล์สำเร็จ',
        attachment,
      };
    } catch (error) {
      // Clean up temp file on error
      if (file.path && fs.existsSync(file.path)) {
        try {
          fs.unlinkSync(file.path);
        } catch (error) {
          console.warn('Failed to delete temp file:', error);
        }
      }

      // Re-throw if it's already an HttpException (BadRequestException etc.)
      if (error instanceof BadRequestException) {
        throw error;
      }

      console.error('Upload error:', error);
      const err = error as { message?: string; code?: string };
      if (
        err.message?.includes('Server has closed the connection') ||
        err.code === 'P2000' ||
        err.message?.includes('too long') ||
        err.message?.includes('packet')
      ) {
        throw new PayloadTooLargeException(
          'ขนาดไฟล์ใหญ่เกินกว่าที่ฐานข้อมูลจะรองรับได้ กรุณาติดต่อผู้ดูแลระบบหรือลองไฟล์ที่มีขนาดเล็กลง',
        );
      }
      throw new BadRequestException(
        'เกิดข้อผิดพลาดในการอัปโหลดไฟล์ กรุณาลองใหม่อีกครั้ง',
      );
    }
  }

  @Post('avatar')
  @ApiOperation({ summary: 'Upload user avatar' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const fileBuffer = readUploadedFile(file);
    if (!fileBuffer) {
      throw new BadRequestException('ไม่สามารถอ่านไฟล์ภาพได้');
    }

    // Type from the magic bytes only (never the client's Content-Type).
    const detectedType = detectFileType(fileBuffer);
    if (detectedType !== 'image/jpeg' && detectedType !== 'image/png') {
      throw new BadRequestException(
        'รูปภาพโปรไฟล์ต้องเป็นไฟล์ JPEG หรือ PNG เท่านั้น',
      );
    }
    const avatarUrl = `data:${detectedType};base64,${fileBuffer.toString('base64')}`;

    try {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { avatarUrl },
      });
    } catch (error) {
      console.error('Avatar upload error:', error);
      const err = error as { message?: string; code?: string };
      if (
        err.message?.includes('Server has closed the connection') ||
        err.code === 'P2000' ||
        err.message?.includes('too long') ||
        err.message?.includes('packet')
      ) {
        throw new PayloadTooLargeException(
          'ขนาดไฟล์รูปภาพใหญ่เกินกว่าที่ฐานข้อมูลจะรองรับได้ (แนะนำขนาดไม่เกิน 2 MB)',
        );
      }
      throw new BadRequestException(
        'เกิดข้อผิดพลาดในการอัปโหลดรูปภาพ กรุณาลองใหม่อีกครั้ง',
      );
    }

    return {
      message: 'Avatar uploaded and saved to database successfully',
      avatarUrl,
    };
  }
}
