import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { EncryptionUtil } from '../utils/encryption.util';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();

    // Soft delete middleware
    this.$use(async (params, next) => {
      if (params.model === 'Employee' || params.model === 'User') {
        if (params.action === 'delete') {
          params.action = 'update';
          const timestamp = Date.now();
          params.args['data'] = { deletedAt: new Date() };
          if (params.model === 'User') {
            params.args['data'].isActive = false;
            // Prevent unique constraint violations for re-registered users
            if (params.args.where && params.args.where.email) params.args['data'].email = `deleted_${timestamp}_${params.args.where.email}`;
            if (params.args.where && params.args.where.username) params.args['data'].username = `deleted_${timestamp}_${params.args.where.username}`;
          }
          if (params.model === 'Employee') {
            // Employee has unique employeeCode and userId
            if (params.args.where && params.args.where.employeeCode) params.args['data'].employeeCode = `deleted_${timestamp}_${params.args.where.employeeCode}`;
            if (params.args.where && params.args.where.userId) params.args['data'].userId = `deleted_${timestamp}_${params.args.where.userId}`;
          }
        }
        if (params.action === 'deleteMany') {
          params.action = 'updateMany';
          if (params.args.data != undefined) {
            params.args.data['deletedAt'] = new Date();
            if (params.model === 'User') params.args.data['isActive'] = false;
          } else {
            params.args['data'] = { deletedAt: new Date() };
            if (params.model === 'User') params.args['data'].isActive = false;
          }
        }
        if (params.action === 'findUnique' || params.action === 'findFirst') {
          params.action = 'findFirst';
          if (!params.args) params.args = {};
          if (!params.args.where) params.args.where = {};
          if (params.args.where.deletedAt == undefined) {
            params.args.where['deletedAt'] = null;
          }
        }
        if (params.action === 'findMany') {
          if (params.args.where) {
            if (params.args.where.deletedAt == undefined) {
              params.args.where['deletedAt'] = null;
            }
          } else {
            params.args['where'] = { deletedAt: null };
          }
        }
        if (params.action === 'count') {
          if (!params.args) params.args = { where: {} };
          if (!params.args.where) params.args.where = {};
          if (params.args.where.deletedAt == undefined) {
            params.args.where['deletedAt'] = null;
          }
        }
      }

      // ENCRYPTION MIDDLEWARE (Before DB action)
      if (params.model === 'Employee') {
        if (params.action === 'create' || params.action === 'update' || params.action === 'upsert') {
          if (params.args.data && params.args.data.idCardNumber && typeof params.args.data.idCardNumber === 'string') {
            params.args.data.idCardNumber = EncryptionUtil.encrypt(params.args.data.idCardNumber);
          }
        }
        if (params.action === 'createMany' || params.action === 'updateMany') {
          if (params.args.data) {
            if (Array.isArray(params.args.data)) {
              params.args.data.forEach(emp => {
                if (emp.idCardNumber && typeof emp.idCardNumber === 'string') {
                  emp.idCardNumber = EncryptionUtil.encrypt(emp.idCardNumber);
                }
              });
            } else {
              if (params.args.data.idCardNumber && typeof params.args.data.idCardNumber === 'string') {
                params.args.data.idCardNumber = EncryptionUtil.encrypt(params.args.data.idCardNumber);
              }
            }
          }
        }
      }

      const result = await next(params);

      // DECRYPTION MIDDLEWARE (After DB action)
      if (params.model === 'Employee' && result) {
        if (params.action === 'findUnique' || params.action === 'findFirst' || params.action === 'create' || params.action === 'update' || params.action === 'upsert') {
          if (result.idCardNumber) {
            result.idCardNumber = EncryptionUtil.decrypt(result.idCardNumber);
          }
        }
        if (params.action === 'findMany') {
          if (Array.isArray(result)) {
            result.forEach(emp => {
              if (emp.idCardNumber) {
                emp.idCardNumber = EncryptionUtil.decrypt(emp.idCardNumber);
              }
            });
          }
        }
      }

      return result;
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
// Trigger restart after prisma downgrade
