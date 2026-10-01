import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as svgCaptcha from 'svg-captcha';
import {
  LoginDto,
  ResetPasswordDto,
  UpdateProfileDto,
  VerifyCaptchaDto,
} from './dto/auth.dto';
import { NotificationService } from '../notification/notification.service';
import type { StringValue } from 'ms';

/** A real bcrypt hash of a random string, compared against for unknown users. */
let dummyHashPromise: Promise<string> | null = null;
function dummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= bcrypt.hash(`unused-${Math.random()}`, 10);
  return dummyHashPromise;
}

const RESET_PURPOSE = 'password-reset';
interface ResetTokenPayload {
  sub: string;
  purpose: string;
  tokenVersion: number;
}

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

    const captcha = svgCaptcha.create({
      size: 5,
      noise: 1,
      width: 150,
      height: 50,
    });

    let svgData = captcha.data.replace(
      /<path\b([^>]*)>/g,
      (_match: string, attrs: string) => {
        // Extract the 'd' attribute (the shape data)
        const dMatch = attrs.match(/d=['"]([^'"]+)['"]/);
        const d = dMatch ? dMatch[1] : '';

        // If it's a noise line (usually has fill="none")
        if (attrs.includes('fill="none"') || attrs.includes("fill='none'")) {
          return `<path d="${d}" fill="none" stroke="${noiseColor}" stroke-width="1"/>`;
        }
        // Otherwise, it's a text path
        return `<path d="${d}" fill="${textColor}" stroke="${textColor}" stroke-width="1.5" stroke-linejoin="round"/>`;
      },
    );

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

    // Security (2026-09-24): an unknown user, a wrong password and a locked
    // account all get the SAME message, so nobody can probe which usernames
    // exist or whose account is locked. The lockout policy is global (not
    // per user), so stating it reveals nothing.
    const [maxFailedSetting, lockoutDurationSetting] = await Promise.all([
      this.prisma.adminSetting.findUnique({
        where: { key: 'MAX_FAILED_LOGINS' },
      }),
      this.prisma.adminSetting.findUnique({
        where: { key: 'LOCKOUT_DURATION_MINUTES' },
      }),
    ]);
    const maxAttempts = maxFailedSetting?.value
      ? parseInt(maxFailedSetting.value, 10)
      : 5;
    const lockoutMinutes = lockoutDurationSetting?.value
      ? parseInt(lockoutDurationSetting.value, 10)
      : 15;
    const failed = () =>
      new UnauthorizedException(
        `ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (หากใส่รหัสผ่านผิดติดต่อกัน ${maxAttempts} ครั้ง ระบบจะระงับการเข้าสู่ระบบชั่วคราว ${lockoutMinutes} นาที)`,
      );

    if (!user) {
      // Spend the same bcrypt time as a real check, so response timing does
      // not reveal that the username does not exist.
      await bcrypt.compare(loginDto.password ?? '', await dummyPasswordHash());
      throw failed();
    }

    // A locked account answers exactly like a wrong password, and the password
    // is not even checked (no password oracle during the lockout).
    if (user.lockedUntil) {
      if (user.lockedUntil > new Date()) {
        throw failed();
      }
      // Lockout over: start counting again from 0.
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      const newAttempts = (user.failedLoginAttempts || 0) + 1;
      const lockedUntil =
        newAttempts >= maxAttempts
          ? new Date(Date.now() + lockoutMinutes * 60 * 1000)
          : null;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: newAttempts, lockedUntil },
      });
      throw failed();
    }

    // Only someone who knows the password learns that the account is suspended.
    if (user.isActive === false) {
      throw new UnauthorizedException(
        'บัญชีของคุณถูกระงับการใช้งาน กรุณาติดต่อฝ่ายบุคคล',
      );
    }

    // ล็อกอินสำเร็จ -> รีเซ็ตกลับเป็น 0
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ip,
      },
    });

    const tokens = await this.getTokens(
      user.id,
      user.email,
      user.role.name,
      user.tokenVersion,
    );
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

    const tokens = await this.getTokens(
      user.id,
      user.email,
      user.role.name,
      user.tokenVersion,
    );
    await this.updateRefreshToken(user.id, tokens.refreshToken);

    return tokens;
  }

  /**
   * Base URL for links in e-mails. Taken ONLY from server configuration —
   * never from request headers (Origin/Referer), which a caller can forge to
   * make the real reset e-mail point at their own site ("reset poisoning").
   * FRONTEND_URL first, then the first CORS origin, then local development.
   */
  private frontendBaseUrl(): string {
    const pick = (v?: string) =>
      v
        ?.split(',')
        .map((s) => s.trim())
        .find(Boolean);
    const url =
      pick(this.configService.get<string>('frontendUrl')) ??
      pick(this.configService.get<string>('corsOrigins')) ??
      'http://localhost:3000';
    return url.replace(/\/+$/, '');
  }

  // Forgot/Reset Password: the reset link is e-mailed to the account's own address.
  async forgotPassword(username: string) {
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

    // Reset token: own signing key and purpose (never interchangeable with an
    // access token), bound to the current tokenVersion so it works only once.
    const payload: ResetTokenPayload = {
      sub: user.id,
      purpose: RESET_PURPOSE,
      tokenVersion: user.tokenVersion,
    };
    const resetToken = this.jwtService.sign(payload, {
      secret: this.resetTokenSecret(),
      expiresIn: '15m',
    });

    const resetUrl = `${this.frontendBaseUrl()}/reset-password?token=${resetToken}`;

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
    const invalid = new BadRequestException('Invalid or expired token');

    let payload: ResetTokenPayload;
    try {
      payload = this.jwtService.verify<ResetTokenPayload>(resetDto.token, {
        secret: this.resetTokenSecret(),
      });
    } catch {
      throw invalid;
    }
    if (
      payload.purpose !== RESET_PURPOSE ||
      typeof payload.tokenVersion !== 'number'
    ) {
      throw invalid;
    }

    const hashedPassword = await bcrypt.hash(resetDto.newPassword, 10);
    // Atomic single use: only matches while the version the link was issued
    // for is still current; the increment then invalidates the link (and every
    // session) at once, so a replay — even a concurrent one — updates nothing.
    const result = await this.prisma.user.updateMany({
      where: { id: payload.sub, tokenVersion: payload.tokenVersion },
      data: {
        passwordHash: hashedPassword,
        passwordChangedAt: new Date(), // the user chose this password themselves
        refreshToken: null,
        tokenVersion: { increment: 1 },
      },
    });
    if (result.count === 0) throw invalid;

    return { message: 'Password reset successfully' };
  }

  private resetTokenSecret(): string {
    return `${this.configService.get<string>('jwt.secret')}:${RESET_PURPOSE}`;
  }

  /**
   * Business rule (2026-09-24): the first time a user changes their own
   * password no current password is asked; after that it is required.
   */
  async getPasswordStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordChangedAt: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return { requiresCurrentPassword: user.passwordChangedAt !== null };
  }

  async updateProfile(userId: string, updateDto: UpdateProfileDto) {
    const newPassword = updateDto.newPassword ?? updateDto.password;

    // Tokens for the caller's own session when the password changes (see below).
    let sessionTokens: { accessToken: string; refreshToken: string } | null =
      null;

    // Check the password rule before writing anything, so a refused password
    // change never half-applies the rest of the profile.
    if (newPassword) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          passwordHash: true,
          passwordChangedAt: true,
          email: true,
          tokenVersion: true,
          role: { select: { name: true } },
        },
      });
      if (!user) throw new UnauthorizedException('User not found');

      if (user.passwordChangedAt !== null) {
        if (!updateDto.currentPassword) {
          throw new BadRequestException('กรุณากรอกรหัสผ่านปัจจุบัน');
        }
        const matches = await bcrypt.compare(
          updateDto.currentPassword,
          user.passwordHash,
        );
        if (!matches) {
          throw new BadRequestException('รหัสผ่านปัจจุบันไม่ถูกต้อง');
        }
      }

      // Business rule (2026-09-24): changing your own password signs out every
      // OTHER device but keeps this one. Bumping tokenVersion invalidates all
      // existing access tokens (JwtStrategy compares it) and replacing the
      // stored refresh hash kills every other refresh token; the caller gets a
      // fresh pair for the new version. Everything is written in one update.
      const nextVersion = user.tokenVersion + 1;
      sessionTokens = await this.getTokens(
        userId,
        user.email,
        user.role.name,
        nextVersion,
      );
      const [passwordHash, refreshHash] = await Promise.all([
        bcrypt.hash(newPassword, 10),
        bcrypt.hash(sessionTokens.refreshToken, 10),
      ]);
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          tokenVersion: nextVersion,
          refreshToken: refreshHash,
        },
      });
    }

    // Only the phone number is self-editable (names are changed by HR).
    if (updateDto.phone) {
      const employee = await this.prisma.employee.findUnique({
        where: { userId },
      });

      if (employee) {
        await this.prisma.employee.update({
          where: { id: employee.id },
          data: { phone: updateDto.phone },
        });
      }
    }

    return {
      success: true,
      message: 'Profile updated successfully',
      // Present only after a password change: the client must switch to these.
      ...(sessionTokens ?? {}),
    };
  }

  async getPublicConfig() {
    const setting = await this.prisma.adminSetting.findUnique({
      where: { key: 'IDLE_TIMEOUT_MINUTES' },
    });
    return {
      idleTimeoutMinutes: setting ? parseInt(setting.value, 10) : 60, // default 60 mins
    };
  }

  private async getTokens(
    userId: string,
    email: string,
    role: string,
    tokenVersion: number = 0,
  ) {
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
        expiresIn: jwtExpiration as StringValue,
      }),
      this.jwtService.signAsync(jwtPayload, {
        secret:
          this.configService.get<string>('jwt.refreshSecret') ||
          'defaultRefresh',
        expiresIn: (this.configService.get<string>('jwt.refreshExpiration') ||
          '8h') as StringValue,
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
