import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import {
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  UpdateProfileDto,
  VerifyCaptchaDto,
} from './dto/auth.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type {
  CurrentUser as CurrentUserPayload,
  RefreshTokenUser,
} from './types/current-user.type';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Put('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user profile (name, phone, password)' })
  updateProfile(
    @CurrentUser() user: CurrentUserPayload,
    @Body() updateDto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(user.id, updateDto);
  }

  @Get('password-status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Whether changing the password requires the current password',
  })
  getPasswordStatus(@CurrentUser() user: CurrentUserPayload) {
    return this.authService.getPasswordStatus(user.id);
  }

  @Get('config')
  @ApiOperation({ summary: 'Get public configuration settings' })
  getConfig() {
    return this.authService.getPublicConfig();
  }

  @Get('captcha')
  @ApiOperation({ summary: 'Generate SVG Captcha' })
  getCaptcha(@Query('theme') theme?: string) {
    return this.authService.generateCaptcha(theme);
  }

  @Post('captcha/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify CAPTCHA' })
  verifyCaptcha(@Body() verifyDto: VerifyCaptchaDto) {
    return this.authService.verifyCaptcha(verifyDto);
  }

  @Post('login')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login to get JWT tokens' })
  login(@Body() loginDto: LoginDto, @Req() req: Request) {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    return this.authService.login(
      loginDto,
      typeof ip === 'string' ? ip : ip[0],
    );
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and invalidate refresh token' })
  logout(@CurrentUser() user: CurrentUserPayload) {
    return this.authService.logout(user.id);
  }

  @Post('refresh')
  @UseGuards(AuthGuard('jwt-refresh'))
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh JWT tokens using refresh token' })
  refreshTokens(@CurrentUser() user: RefreshTokenUser) {
    if (!user.refreshToken) {
      throw new UnauthorizedException('Refresh token is missing');
    }
    return this.authService.refreshTokens(user.id, user.refreshToken);
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset email' })
  forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    // The link's site comes from server config (FRONTEND_URL), never from the
    // request's Origin/Referer headers, which a caller can forge.
    return this.authService.forgotPassword(forgotPasswordDto.username);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using token' })
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }
}
