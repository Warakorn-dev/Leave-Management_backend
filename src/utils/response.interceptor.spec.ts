/// <reference types="jest" />
import { of, lastValueFrom } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

const run = (value: unknown) =>
  lastValueFrom(
    new ResponseInterceptor().intercept({} as never, {
      handle: () => of(value),
    }),
  );

describe('ResponseInterceptor envelope', () => {
  it('wraps a plain result as { success, message, data }', async () => {
    await expect(run({ a: 1 })).resolves.toEqual({
      success: true,
      message: 'Request successful',
      data: { a: 1 },
    });
  });

  it('lifts { message, data } out of the handler result', async () => {
    await expect(run({ message: 'ok', data: [1] })).resolves.toEqual({
      success: true,
      message: 'ok',
      data: [1],
    });
  });

  it('password change: the new session tokens reach the client at body.data (what ChangePasswordCard reads)', async () => {
    const body = (await run({
      success: true,
      message: 'Profile updated successfully',
      accessToken: 'A',
      refreshToken: 'R',
    })) as { data: { accessToken: string; refreshToken: string } };
    expect(body.data.accessToken).toBe('A');
    expect(body.data.refreshToken).toBe('R');
  });

  it('token refresh: tokens are at body.data, NOT at the top level', async () => {
    const body = (await run({
      accessToken: 'A',
      refreshToken: 'R',
    })) as unknown as Record<string, unknown>;
    expect(body).not.toHaveProperty('accessToken');
    expect(body.data).toEqual({ accessToken: 'A', refreshToken: 'R' });
  });
});
