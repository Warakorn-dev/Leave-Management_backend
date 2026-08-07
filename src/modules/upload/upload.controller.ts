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
      throw new BadRequestException('File is required');
    }
    if (!leaveRequestId) {
      throw new BadRequestException('leaveRequestId is required');
    }

    // Delete existing attachments to prevent orphaned files
    await this.prisma.leaveAttachment.deleteMany({
      where: {
        leaveRequestId,
      },
    });

    let base64Data = '';
    if (file.buffer) {
      base64Data = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    } else if (file.path && fs.existsSync(file.path)) {
      const fileBuffer = fs.readFileSync(file.path);
      base64Data = `data:${file.mimetype};base64,${fileBuffer.toString('base64')}`;
      try { fs.unlinkSync(file.path); } catch (e) {}
    }

    const attachment = await this.prisma.leaveAttachment.create({
      data: {
        leaveRequestId,
        filePath: base64Data || `/${file.path.replace(/\\/g, '/')}`,
        fileType: file.mimetype,
      }
    });

    return {
      message: 'File uploaded and saved to database successfully',
      attachment
    };
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
