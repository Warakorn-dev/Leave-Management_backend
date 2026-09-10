import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import {
  LoginDto,
  ResetPasswordDto,
  UpdateProfileDto,
  VerifyCaptchaDto,
} from './dto/auth.dto';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private notificationService: NotificationService,
  ) {}

  async generateCaptcha(theme?: string) {
    const isLight = theme === 'gray' || theme === 'light';
    const textColor = isLight ? '#ffffffff' : '#000000ff';
    const bgFill = isLight ? '#000000' : '#ffffff';
    const noiseColor = isLight ? '#444444' : '#cccccc';

    const svgCaptcha = require('svg-captcha');
    const captcha = svgCaptcha.create({
      size: 5,
      noise: 1,
      width: 150,
      height: 50,
    });

    let svgData = captcha.data.replace(/<path\b([^>]*)>/g, (match, attrs) => {
      // Extract the 'd' attribute (the shape data)
      const dMatch = attrs.match(/d=['"]([^'"]+)['"]/);
      const d = dMatch ? dMatch[1] : '';

      // If it's a noise line (usually has fill="none")
      if (attrs.includes('fill="none"') || attrs.includes("fill='none'")) {
        return `<path d="${d}" fill="none" stroke="${noiseColor}" stroke-width="1"/>`;
      }
      // Otherwise, it's a text path
      return `<path d="${d}" fill="${textColor}" stroke="${textColor}" stroke-width="1.5" stroke-linejoin="round"/>`;
    });

    svgData = svgData.replace(
      '>',
      `><rect width="100%" height="100%" fill="${bgFill}"/>`,
    );

    const expiredAt = new Date();
    expiredAt.setMinutes(expiredAt.getMinutes() + 10);

    const newCaptcha = await this.prisma.captcha.create({
      data: {
        captchaCode: captcha.text,
        isUsed: false,
        expiredAt: expiredAt,
      },
    });

    return {
      captcha_id: newCaptcha.id,
      captcha_image: `data:image/svg+xml;base64,${Buffer.from(svgData).toString('base64')}`,
    };
  }

  async verifyCaptcha(verifyDto: VerifyCaptchaDto) {
    const { captchaId, captchaCode } = verifyDto;

    // 1. Atomic update to claim the CAPTCHA and prevent Race Conditions
    const updateResult = await this.prisma.captcha.updateMany({
      where: {
        id: captchaId,
        isUsed: false,
      },
      data: { isUsed: true },
    });

    if (updateResult.count === 0) {
      // Check if it exists but was already used, or if it doesn't exist at all
      const exists = await this.prisma.captcha.findUnique({
        where: { id: captchaId },
      });
      if (!exists) {
        throw new BadRequestException(
          'รหัส CAPTCHA ไม่ถูกต้องหรือไม่มีอยู่ในระบบ',
        );
      }
      throw new BadRequestException('รหัส CAPTCHA ถูกใช้งานไปแล้ว กรุณาขอใหม่');
    }

    // 2. Fetch the newly claimed record to check expiration and code
    const captchaRecord = await this.prisma.captcha.findUnique({
      where: { id: captchaId },
    });

    // We can assume captchaRecord exists here because we just updated it, but TypeScript might want a check
    if (!captchaRecord) {
      throw new BadRequestException('เกิดข้อผิดพลาดในการตรวจสอบ CAPTCHA');
    }

    if (new Date() > captchaRecord.expiredAt) {
      throw new BadRequestException('รหัส CAPTCHA หมดอายุ กรุณาขอใหม่');
    }

    if (captchaRecord.captchaCode.toLowerCase() !== captchaCode.toLowerCase()) {
      throw new BadRequestException('รหัส CAPTCHA ไม่ถูกต้อง');
    }

    return { success: true };
  }

  async login(loginDto: LoginDto, ip: string = 'unknown') {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: loginDto.username }, { email: loginDto.username }],
      },
      include: {
        role: true,
        employee: {
          include: {
            department: true,
            position: true,
          },
        },
      },
    });

    if (!loginDto.captchaId || !loginDto.captchaInput) {
      throw new BadRequestException('กรุณากรอกรหัส CAPTCHA');
    }

    // Use verifyCaptcha logic internally
    await this.verifyCaptcha({
      captchaId: loginDto.captchaId,
      captchaCode: loginDto.captchaInput,
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.isActive === false) {
      throw new UnauthorizedException('user ของคุณโดนระงับการใช้งานไปแล้ว');
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remainingTime = Math.ceil(
        (user.lockedUntil.getTime() - Date.now()) / 60000,
      );
      throw new UnauthorizedException(
        `บัญชีถูกล็อคเนื่องจากใส่รหัสผ่านผิดหลายครั้ง กรุณาลองใหม่ในอีก ${remainingTime} นาที`,
      );
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      // Increment failed attempts
      const newAttempts = (user.failedLoginAttempts || 0) + 1;
      let lockedUntil: Date | null = null;

      // Lock account after 5 failed attempts
      if (newAttempts >= 5) {
        lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // Lock for 15 minutes
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: newAttempts,
          lockedUntil,
        },
      });

      if (lockedUntil) {
        throw new UnauthorizedException(
          'บัญชีถูกล็อคเนื่องจากใส่รหัสผ่านผิดเกิน 5 ครั้ง กรุณาลองใหม่ในอีก 15 นาที',
        );
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    // Successful login, reset failed attempts and update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ip,
      },
    });

    const tokens = await this.getTokens(user.id, user.email, user.role.name, user.tokenVersion);
    await this.updateRefreshToken(user.id, tokens.refreshToken);

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role.name,
        profilePic: user.avatarUrl,
        firstName: user.employee?.firstName,
        lastName: user.employee?.lastName,
        employeeCode: user.employee?.employeeCode || null,
        departmentName: user.employee?.department?.name,
        positionName: user.employee?.position?.name,
      },
      ...tokens,
    };
  }

  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null, tokenVersion: { increment: 1 } },
    });
    return { message: 'Logged out successfully' };
  }

  async refreshTokens(userId: string, refreshToken: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user || !user.refreshToken) {
      throw new UnauthorizedException('Access Denied');
    }

    if (user.isActive === false) {
      throw new UnauthorizedException('ACCOUNT_SUSPENDED');
    }

    const refreshTokenMatches = await bcrypt.compare(
      refreshToken,
      user.refreshToken,
    );
    if (!refreshTokenMatches) {
      throw new UnauthorizedException('Access Denied');
    }

    const tokens = await this.getTokens(user.id, user.email, user.role.name, user.tokenVersion);
    await this.updateRefreshToken(user.id, tokens.refreshToken);

    return tokens;
  }

  // Simplified Forgot/Reset Password (usually involves email with JWT token)
  async forgotPassword(username: string, baseUrl: string) {
    const genericMessage =
      'หากบัญชีนี้มีอยู่ในระบบ ลิงก์สำหรับรีเซ็ตรหัสผ่านจะถูกส่งไปยังอีเมลของคุณ';

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: username }, { username: username }],
      },
    });

    // Prevent User Enumeration
    if (!user) {
      return { message: genericMessage };
    }

    // Generate reset token
    const resetToken = this.jwtService.sign(
      { sub: user.id },
      { secret: this.configService.get('jwt.secret'), expiresIn: '15m' },
    );

    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

    // Send email via Notification Module
    await this.notificationService.sendEmail(
      user.email,
      'Reset Your Password - Leave Management System',
      `Please click the following link to reset your password: ${resetUrl}`,
      `<p>Hello ${user.username},</p><p>Please click the link below to reset your password:</p><p><a href="${resetUrl}">Reset Password</a></p><p>If you didn't request this, you can ignore this email.</p>`,
    );

    // Prevent Token Leakage (do not return token)
    return { message: genericMessage };
  }

  async resetPassword(resetDto: ResetPasswordDto) {
    try {
      const payload = this.jwtService.verify(resetDto.token, {
        secret: this.configService.get('jwt.secret'),
      });
      const hashedPassword = await bcrypt.hash(resetDto.newPassword, 10);
      await this.prisma.user.update({
        where: { id: payload.sub },
        data: { passwordHash: hashedPassword, refreshToken: null, tokenVersion: { increment: 1 } },
      });
      return { message: 'Password reset successfully' };
    } catch (e) {
      throw new BadRequestException('Invalid or expired token');
    }
  }

  async updateProfile(userId: string, updateDto: UpdateProfileDto) {
    if (updateDto.password) {
      const passwordHash = await bcrypt.hash(updateDto.password, 10);
      await this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      });
    }

    if (updateDto.firstName || updateDto.lastName || updateDto.phone) {
      // Find employee associated with this user
      const employee = await this.prisma.employee.findUnique({
        where: { userId },
      });

      if (employee) {
        await this.prisma.employee.update({
          where: { id: employee.id },
          data: {
            ...(updateDto.firstName && { firstName: updateDto.firstName }),
            ...(updateDto.lastName && { lastName: updateDto.lastName }),
            ...(updateDto.phone && { phone: updateDto.phone }),
          },
        });
      }
    }

    return { success: true, message: 'Profile updated successfully' };
  }

  async getPublicConfig() {
    const setting = await this.prisma.adminSetting.findUnique({
      where: { key: 'IDLE_TIMEOUT_MINUTES' },
    });
    return {
      idleTimeoutMinutes: setting ? parseInt(setting.value, 10) : 60, // default 60 mins
    };
  }

  private async getTokens(userId: string, email: string, role: string, tokenVersion: number = 0) {
    const jwtPayload = { sub: userId, email, role, tokenVersion };

    // Read JWT_EXPIRATION from DB (Admin Settings UI) if available; fallback to .env
    const dbJwtSetting = await this.prisma.adminSetting.findUnique({
      where: { key: 'JWT_EXPIRATION' },
    });
    const jwtExpiration =
      dbJwtSetting?.value ||
      this.configService.get<string>('jwt.expiration') ||
      '20m';

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(jwtPayload, {
        secret: this.configService.get<string>('jwt.secret') || 'defaultSecret',
        expiresIn: jwtExpiration as any,
      }),
      this.jwtService.signAsync(jwtPayload, {
        secret:
          this.configService.get<string>('jwt.refreshSecret') ||
          'defaultRefresh',
        expiresIn: (this.configService.get<string>('jwt.refreshExpiration') ||
          '8h') as any,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async updateRefreshToken(userId: string, refreshToken: string) {
    const hashedRefreshToken = await bcrypt.hash(refreshToken, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashedRefreshToken },
    });
  }
}
