export interface CurrentUser {
  id: string;
  email: string;
  role: string;
}

export interface RefreshTokenUser extends CurrentUser {
  refreshToken?: string;
}
