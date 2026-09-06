import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  BadRequestException,
  ForbiddenException,
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
import * as fs from 'fs';

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
    @CurrentUser() user: any,
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
      // Delete existing attachments to prevent orphaned data
      await this.prisma.leaveAttachment.deleteMany({
        where: { leaveRequestId },
      });

      let base64Data = '';
      let fileBuffer: Buffer | null = null;

      if (file.buffer) {
        // memoryStorage: file content is in buffer
        fileBuffer = file.buffer;
        base64Data = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
      } else if (file.path && fs.existsSync(file.path)) {
        // diskStorage: file content is on disk
        fileBuffer = fs.readFileSync(file.path);
        base64Data = `data:${file.mimetype};base64,${fileBuffer.toString('base64')}`;
        // Clean up temp file after reading
        try {
          fs.unlinkSync(file.path);
        } catch (error) {
          console.warn('Failed to delete temp file:', error);
        }
      }

      if (!base64Data || !fileBuffer) {
        throw new BadRequestException(
          'ไม่สามารถอ่านไฟล์ได้ กรุณาลองใหม่อีกครั้ง',
        );
      }

      // Security: Magic Bytes Check to prevent fake extensions
      const isSafe = (() => {
        if (fileBuffer.length < 4) return false;
        // PDF: 25 50 44 46
        if (
          fileBuffer[0] === 0x25 &&
          fileBuffer[1] === 0x50 &&
          fileBuffer[2] === 0x44 &&
          fileBuffer[3] === 0x46
        )
          return true;
        // JPEG: FF D8 FF
        if (
          fileBuffer[0] === 0xff &&
          fileBuffer[1] === 0xd8 &&
          fileBuffer[2] === 0xff
        )
          return true;
        // PNG: 89 50 4E 47
        if (
          fileBuffer[0] === 0x89 &&
          fileBuffer[1] === 0x50 &&
          fileBuffer[2] === 0x4e &&
          fileBuffer[3] === 0x47
        )
          return true;
        // ZIP/DOCX: 50 4B 03 04
        if (
          fileBuffer[0] === 0x50 &&
          fileBuffer[1] === 0x4b &&
          fileBuffer[2] === 0x03 &&
          fileBuffer[3] === 0x04
        )
          return true;
        // DOC: D0 CF 11 E0
        if (
          fileBuffer[0] === 0xd0 &&
          fileBuffer[1] === 0xcf &&
          fileBuffer[2] === 0x11 &&
          fileBuffer[3] === 0xe0
        )
          return true;
        return false;
      })();

      if (!isSafe) {
        throw new BadRequestException(
          'ประเภทไฟล์ไม่ถูกต้องหรือไฟล์อาจแฝงอันตราย (Invalid Magic Bytes)',
        );
      }

      const attachment = await this.prisma.leaveAttachment.create({
        data: {
          leaveRequestId,
          filePath: base64Data,
          fileType: file.mimetype,
        },
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
      throw new BadRequestException(
        `เกิดข้อผิดพลาดในการอัปโหลดไฟล์: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
    @CurrentUser() user: any,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    let avatarUrl = '';
    let fileBuffer: Buffer | null = null;

    if (file.buffer) {
      fileBuffer = file.buffer;
      avatarUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    } else if (file.path && fs.existsSync(file.path)) {
      fileBuffer = fs.readFileSync(file.path);
      avatarUrl = `data:${file.mimetype};base64,${fileBuffer.toString('base64')}`;
      try {
        fs.unlinkSync(file.path);
      } catch (error) {
        console.warn('Failed to delete temp file:', error);
      }
    }

    if (!fileBuffer) {
      throw new BadRequestException('ไม่สามารถอ่านไฟล์ภาพได้');
    }

    const isSafe = (() => {
      if (fileBuffer.length < 4) return false;
      if (
        fileBuffer[0] === 0xff &&
        fileBuffer[1] === 0xd8 &&
        fileBuffer[2] === 0xff
      )
        return true; // JPEG
      if (
        fileBuffer[0] === 0x89 &&
        fileBuffer[1] === 0x50 &&
        fileBuffer[2] === 0x4e &&
        fileBuffer[3] === 0x47
      )
        return true; // PNG
      return false;
    })();

    if (!isSafe) {
      throw new BadRequestException(
        'รูปภาพโปรไฟล์ต้องเป็นไฟล์ JPEG หรือ PNG เท่านั้น (Invalid Magic Bytes)',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: avatarUrl || `/${file.path.replace(/\\/g, '/')}` },
    });

    return {
      message: 'Avatar uploaded and saved to database successfully',
      avatarUrl,
    };
  }
}
