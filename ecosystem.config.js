// PM2 config for the backend server (เครื่อง 2).
// Build first (npm ci && npx prisma generate && npm run build), then:
//   pm2 start ecosystem.config.js && pm2 save
//
// Keep a single fork-mode instance: the daily 09:00 reminder cron runs inside
// the process, so cluster mode / multiple instances would send duplicate emails.
// Settings (DB, JWT, SMTP, ...) come from .env in this folder via @nestjs/config.
module.exports = {
  apps: [
    {
      name: 'leave-backend',
      cwd: __dirname,
      script: 'dist/main.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '1500M',
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Bangkok',
      },
      time: true,
      out_file: 'logs/backend-out.log',
      error_file: 'logs/backend-error.log',
    },
  ],
};
