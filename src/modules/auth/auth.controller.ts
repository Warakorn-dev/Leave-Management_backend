import { Controller, Get, Post, Put, Body, UseGuards, HttpCode, HttpStatus, Headers, Query } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, ForgotPasswordDto, ResetPasswordDto, UpdateProfileDto, VerifyCaptchaDto } from './dto/auth.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthGuard } from '@nestjs/passport';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Put('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user profile (name, phone, password)' })
  updateProfile(@CurrentUser() user: any, @Body() updateDto: UpdateProfileDto) {
    return this.authService.updateProfile(user.id, updateDto);
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
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login to get JWT tokens' })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and invalidate refresh token' })
  logout(@CurrentUser() user: any) {
    return this.authService.logout(user.id);
  }

  @Post('refresh')
  @UseGuards(AuthGuard('jwt-refresh'))
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh JWT tokens using refresh token' })
  refreshTokens(@CurrentUser() user: any) {
    return this.authService.refreshTokens(user.id, user.refreshToken);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset email' })
  forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto, @Headers('origin') origin: string, @Headers('referer') referer: string) {
    let baseUrl = origin || 'http://localhost:3000';
    if (!origin && referer) {
      const url = new URL(referer);
      baseUrl = `${url.protocol}//${url.host}`;
    }
    return this.authService.forgotPassword(forgotPasswordDto.username, baseUrl);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using token' })
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }
}
