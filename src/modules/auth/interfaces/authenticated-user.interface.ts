export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
  refreshToken?: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}
