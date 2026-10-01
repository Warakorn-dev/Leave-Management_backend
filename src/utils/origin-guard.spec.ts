import express from 'express';
import request from 'supertest';
import {
  createOriginGuard,
  isOriginAllowed,
  normalizeOrigin,
} from './origin-guard';

describe('isOriginAllowed', () => {
  const allowed = ['https://leave.example.co.th'];

  it('allows requests without an Origin header', () => {
    expect(isOriginAllowed(undefined, 'x', allowed)).toBe(true);
  });

  it('allows listed origins regardless of case or trailing slash', () => {
    expect(
      isOriginAllowed('https://leave.example.co.th', undefined, allowed),
    ).toBe(true);
    expect(
      isOriginAllowed(
        'https://LEAVE.example.co.th',
        undefined,
        ['https://leave.example.co.th/'].map(normalizeOrigin),
      ),
    ).toBe(true);
  });

  it('allows same-origin requests whose host is not listed (e.g. opened by IP)', () => {
    expect(isOriginAllowed('https://10.0.0.5', '10.0.0.5', allowed)).toBe(true);
    expect(isOriginAllowed('http://localhost:3000', 'localhost:3000', [])).toBe(
      true,
    );
  });

  it('treats default ports as equal', () => {
    expect(isOriginAllowed('https://site.local', 'site.local:443', [])).toBe(
      true,
    );
  });

  it('rejects another site', () => {
    expect(
      isOriginAllowed('https://evil.com', 'leave.example.co.th', allowed),
    ).toBe(false);
    expect(isOriginAllowed('http://localhost:3001', 'localhost:3000', [])).toBe(
      false,
    );
    expect(isOriginAllowed('https://evil.com', undefined, allowed)).toBe(false);
  });

  it('rejects malformed origins', () => {
    expect(isOriginAllowed('null', 'site', [])).toBe(false);
  });
});

describe('createOriginGuard behind the frontend proxy', () => {
  const buildApp = () => {
    const app = express();
    app.set('trust proxy', 'loopback');
    app.use(createOriginGuard(['https://leave.example.co.th']));
    app.post('/api/auth/login', (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  };

  it('passes a same-origin POST forwarded by the proxy even when the host is not in CORS_ORIGINS', async () => {
    await request(buildApp())
      .post('/api/auth/login')
      .set('Origin', 'https://leave-server')
      .set('X-Forwarded-Host', 'leave-server')
      .expect(200);
  });

  it('answers a cross-site POST with 403 JSON instead of a 500', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login')
      .set('Origin', 'https://evil.com')
      .set('X-Forwarded-Host', 'leave.example.co.th')
      .expect(403);
    expect(res.body).toMatchObject({ success: false });
  });
});
