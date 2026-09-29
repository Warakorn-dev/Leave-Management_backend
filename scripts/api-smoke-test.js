/**
 * Read-only API smoke test — sends GET requests only, never changes data.
 *
 *   npm run test:smoke                     (backend must be running)
 *   API_URL=http://host:8000/api npm run test:smoke
 *
 * For each role it asks for a username/password and opens the CAPTCHA image
 * in the browser so you can type the code (press Enter on the username to
 * skip a role). Alternatively pass tokens via env: TOKEN_HR=eyJ... etc.
 *
 * Result per endpoint: PASS = 2xx, WARN = 4xx, FAIL = 5xx / unreachable.
 * Exit code is 1 when anything FAILs.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { exec } = require('child_process');

const BASE = (process.env.API_URL || 'http://localhost:8000/api').replace(/\/$/, '');
const ROLES = ['EMPLOYEE', 'MANAGER', 'HR', 'CEO', 'ADMIN'];
const year = new Date().getFullYear();
const today = new Date().toISOString().slice(0, 10);

// [role that must call it (null = public, ANY = any logged-in user), path]
const CASES = [
  [null, '/health'],
  [null, '/auth/config'],
  [null, '/auth/captcha'],
  ['ANY', '/auth/password-status'],
  ['ANY', '/notifications'],
  ['ANY', '/announcement?limit=5'],
  ['EMPLOYEE', `/leave/dashboard?year=${year}`],
  ['EMPLOYEE', '/leave/types'],
  ['EMPLOYEE', '/leave/holidays'],
  ['EMPLOYEE', `/leave/day-availability?startDate=${today}&endDate=${today}`],
  ['EMPLOYEE', '/leave/history'],
  ['EMPLOYEE', '/leave/all-leaves'],
  ['EMPLOYEE', '/leave/department'],
  ['EMPLOYEE', '/leave/me'],
  ['EMPLOYEE', '/leave/balance'],
  ['MANAGER', `/manager/dashboard?year=${year}`],
  ['MANAGER', '/manager/pending'],
  ['MANAGER', '/manager/history'],
  ['HR', `/hr/dashboard?year=${year}`],
  ['HR', '/hr/leave-summary'],
  ['HR', '/hr/departments'],
  ['HR', '/hr/roles'],
  ['HR', '/hr/positions'],
  ['HR', '/hr/leave-types'],
  ['HR', '/hr/employees'],
  ['HR', '/hr/employees/:employeeId'],
  ['HR', '/hr/leaves'],
  ['HR', '/hr/leaves/pending-verify'],
  ['HR', '/hr/holidays'],
  ['HR', '/export/excel'],
  ['HR', '/export/pdf'],
  ['CEO', `/ceo/dashboard?year=${year}`],
  ['CEO', '/ceo/report/company'],
  ['CEO', '/ceo/report/stats'],
  ['CEO', '/ceo/report/department?id=:departmentId'],
  ['CEO', '/ceo/pending'],
  ['CEO', '/ceo/employees'],
  ['ADMIN', '/admin/overview'],
  ['ADMIN', '/admin/users'],
  ['ADMIN', '/admin/users/all'],
  ['ADMIN', '/admin/audit-logs'],
  ['ADMIN', '/admin/settings'],
  ['ADMIN', '/admin/system-health'],
  ['ADMIN', '/admin/audit-logs/export'],
  ['ADMIN', '/admin/captcha/stats'],
  ['ADMIN', '/admin/roles'],
];

// Roles to try, in order, when the primary role has no token (mirrors @Roles).
const FALLBACK = {
  EMPLOYEE: ['EMPLOYEE', 'MANAGER', 'HR', 'CEO'],
  MANAGER: ['MANAGER', 'HR'],
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();
let muted = false;
const writeToOutput = rl._writeToOutput;
rl._writeToOutput = (s) => writeToOutput.call(rl, muted && s !== '\r\n' && s !== '\n' ? '' : s);

async function ask(question, { hidden = false } = {}) {
  process.stdout.write(question);
  muted = hidden;
  const { value, done } = await lines.next();
  muted = false;
  return done ? '' : value;
}

async function request(method, urlPath, { token, body } = {}) {
  const started = Date.now();
  const res = await fetch(BASE + urlPath, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = res.headers.get('content-type') || '';
  const json = contentType.includes('json') ? await res.json().catch(() => null) : null;
  if (!json) await res.arrayBuffer();
  return { code: res.status, ms: Date.now() - started, json, contentType };
}

function openCaptcha(dataUri) {
  const file = path.join(os.tmpdir(), 'leave-smoke-captcha.html');
  fs.writeFileSync(
    file,
    `<body style="margin:40px;background:#fff"><img src="${dataUri}" style="width:360px"></body>`,
  );
  const cmd =
    process.platform === 'win32' ? `start "" "${file}"` : process.platform === 'darwin' ? `open "${file}"` : `xdg-open "${file}"`;
  exec(cmd);
  return file;
}

async function login(role) {
  const username = (await ask(`\n[${role}] username/email (Enter = ข้าม): `)).trim();
  if (!username) return null;
  const password = await ask(`[${role}] password: `, { hidden: true });

  for (let attempt = 1; attempt <= 3; attempt++) {
    const captcha = await request('GET', '/auth/captcha');
    const { captcha_id: captchaId, captcha_image: image } = captcha.json?.data ?? {};
    if (!captchaId) {
      console.log(`  ขอ CAPTCHA ไม่สำเร็จ (HTTP ${captcha.code})`);
      return null;
    }
    const file = openCaptcha(image);
    const captchaInput = (await ask(`  พิมพ์รหัส CAPTCHA ที่เห็นในเบราว์เซอร์ (${file}): `)).trim();

    const res = await request('POST', '/auth/login', {
      body: { username, password, captchaId, captchaInput },
    });
    const data = res.json?.data;
    if (res.code < 300 && data?.accessToken) {
      console.log(`  ✓ login สำเร็จ (role: ${data.user?.role})`);
      return data.accessToken;
    }
    const message = res.json?.message ?? `HTTP ${res.code}`;
    console.log(`  ✗ login ไม่สำเร็จ: ${message}`);
    // Only a wrong CAPTCHA is worth retrying; a wrong password would just
    // count towards the account lockout.
    if (!/captcha/i.test(String(message))) return null;
  }
  return null;
}

const listOf = (data) =>
  Array.isArray(data) ? data : [data?.data, data?.items, data?.employees, data?.departments].find(Array.isArray);

(async () => {
  console.log(`API: ${BASE}`);
  const health = await request('GET', '/health').catch(() => null);
  if (!health || health.code >= 500) {
    console.log('✗ ต่อ backend ไม่ได้ — เปิด `npm run start:dev` และ MySQL ก่อน');
    process.exit(1);
  }

  const tokens = {};
  for (const role of ROLES) {
    tokens[role] = process.env[`TOKEN_${role}`] || (await login(role));
  }
  rl.close();

  const anyToken = Object.values(tokens).find(Boolean);
  const ids = {};
  const rows = [];

  for (const [role, rawPath] of CASES) {
    // Fall back to another role the endpoint's @Roles also allows.
    const usedRole = role === null || role === 'ANY' ? role : (FALLBACK[role] || [role]).find((r) => tokens[r]);
    const token = role === null ? null : role === 'ANY' ? anyToken : tokens[usedRole];
    if (role !== null && !token) {
      rows.push(['SKIP', '', '', rawPath, role === 'ANY' ? 'ต้อง login อย่างน้อย 1 role' : `ไม่มี token ของ ${role}`]);
      continue;
    }
    const missing = (rawPath.match(/:(\w+)/g) || []).map((p) => p.slice(1)).find((k) => !ids[k]);
    if (missing) {
      rows.push(['SKIP', '', '', rawPath, `ไม่มี ${missing} ให้ใช้`]);
      continue;
    }
    const urlPath = rawPath.replace(/:(\w+)/g, (_, k) => ids[k]);

    try {
      const res = await request('GET', urlPath, { token });
      if (rawPath === '/hr/employees') ids.employeeId = listOf(res.json?.data)?.[0]?.id;
      if (rawPath === '/hr/departments') ids.departmentId = listOf(res.json?.data)?.[0]?.id;

      const status = res.code >= 500 ? 'FAIL' : res.code < 300 ? 'PASS' : 'WARN';
      const note =
        res.code >= 300 ? String(res.json?.message ?? '').slice(0, 80) : res.json ? '' : res.contentType.split(';')[0];
      const via = usedRole && usedRole !== role && role !== 'ANY' ? `(ใช้ token ${usedRole}) ` : '';
      rows.push([status, res.code, `${res.ms}ms`, rawPath, via + note]);
    } catch (e) {
      rows.push(['FAIL', 'ERR', '', rawPath, e.message]);
    }
    await new Promise((r) => setTimeout(r, 150)); // stay well under the 100 req/min throttle
  }

  const icon = { PASS: '✓', WARN: '!', FAIL: '✗', SKIP: '-' };
  console.log('\n' + '='.repeat(90));
  for (const [status, code, ms, p, note] of rows) {
    console.log(`${icon[status]} ${status.padEnd(4)} ${String(code).padEnd(4)} ${ms.padStart(7)}  ${p.padEnd(48)} ${note}`);
  }
  const count = (s) => rows.filter((r) => r[0] === s).length;
  console.log('='.repeat(90));
  console.log(`PASS ${count('PASS')}  WARN ${count('WARN')}  FAIL ${count('FAIL')}  SKIP ${count('SKIP')}  (ทั้งหมด ${rows.length})`);
  process.exit(count('FAIL') ? 1 : 0);
})();
