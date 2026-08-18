import { Controller, Post, UseInterceptors, UploadedFile, UseGuards, BadRequestException, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from 'src/prisma/prisma.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import * as fs from 'fs';
import * as path from 'path';

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
        }
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: Express.Multer.File, @Body('leaveRequestId') leaveRequestId: string) {
    if (!file) {
      throw new BadRequestException('กรุณาเลือกไฟล์ก่อนอัปโหลด');
    }
    if (!leaveRequestId) {
      throw new BadRequestException('ไม่พบรหัสคำขอลา (leaveRequestId)');
    }

    // Verify leave request exists
    const leaveRequest = await this.prisma.leaveRequest.findUnique({
      where: { id: leaveRequestId },
    });
    if (!leaveRequest) {
      // Clean up uploaded temp file
      if (file.path && fs.existsSync(file.path)) {
        try { fs.unlinkSync(file.path); } catch (e) {}
      }
      throw new BadRequestException('ไม่พบคำขอลาที่ต้องการแนบไฟล์');
    }

    try {
      // Delete existing attachments to prevent orphaned data
      await this.prisma.leaveAttachment.deleteMany({
        where: { leaveRequestId },
      });

      let base64Data = '';

      if (file.buffer) {
        // memoryStorage: file content is in buffer
        base64Data = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
      } else if (file.path && fs.existsSync(file.path)) {
        // diskStorage: file content is on disk
        const fileBuffer = fs.readFileSync(file.path);
        base64Data = `data:${file.mimetype};base64,${fileBuffer.toString('base64')}`;
        // Clean up temp file after reading
        try { fs.unlinkSync(file.path); } catch (e) {}
      }

      if (!base64Data) {
        throw new BadRequestException('ไม่สามารถอ่านไฟล์ได้ กรุณาลองใหม่อีกครั้ง');
      }

      const attachment = await this.prisma.leaveAttachment.create({
        data: {
          leaveRequestId,
          filePath: base64Data,
          fileType: file.mimetype,
        }
      });

      return {
        message: 'อัปโหลดไฟล์สำเร็จ',
        attachment
      };
    } catch (error) {
      // Clean up temp file on error
      if (file.path && fs.existsSync(file.path)) {
        try { fs.unlinkSync(file.path); } catch (e) {}
      }

      // Re-throw if it's already an HttpException (BadRequestException etc.)
      if (error instanceof BadRequestException) {
        throw error;
      }

      console.error('Upload error:', error);
      throw new BadRequestException('เกิดข้อผิดพลาดในการอัปโหลดไฟล์ กรุณาลองใหม่อีกครั้ง');
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
  async uploadAvatar(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: any) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    
    let avatarUrl = '';
    if (file.buffer) {
      avatarUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    } else if (file.path && fs.existsSync(file.path)) {
      const fileBuffer = fs.readFileSync(file.path);
      avatarUrl = `data:${file.mimetype};base64,${fileBuffer.toString('base64')}`;
      try { fs.unlinkSync(file.path); } catch (e) {}
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: avatarUrl || `/${file.path.replace(/\\/g, '/')}` },
    });

    return {
      message: 'Avatar uploaded and saved to database successfully',
      avatarUrl
    };
  }
}
