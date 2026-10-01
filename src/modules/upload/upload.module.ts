import { BadRequestException, Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { UploadController } from './upload.controller';
import { extname } from 'path';
import * as fs from 'fs';

@Module({
  imports: [
    MulterModule.register({
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = './uploads';
          if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
          }
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(
            null,
            file.fieldname + '-' + uniqueSuffix + extname(file.originalname),
          );
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.originalname.match(/\.(pdf|png|jpeg|jpg)$/i)) {
          return cb(
            // HttpException → 400 with this message (a plain Error would be a generic 500)
            new BadRequestException(
              'ไม่รองรับประเภทไฟล์นี้ (รองรับเฉพาะ PDF, PNG, JPG)',
            ),
            false,
          );
        }
        cb(null, true);
      },
      limits: {
        fileSize: 2 * 1024 * 1024, // 2 MB — keep in sync with MAX_UPLOAD_LABEL in http-exception.filter.ts and the frontend checks
      },
    }),
  ],
  controllers: [UploadController],
})
export class UploadModule {}
