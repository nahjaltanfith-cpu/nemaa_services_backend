// PM2 process for the API on the VPS. First time: `pm2 start ecosystem.config.cjs && pm2 save`;
// deployments then run `pm2 reload nemaa-backend` (see .github/workflows/deploy.yml).
// Settings (DB, JWT, SMTP, CORS …) come from the .env file next to server.js, which is never in git.
module.exports = {
    apps: [
        {
            name: 'nemaa-backend',
            script: 'server.js',
            cwd: __dirname,
            // One process: Socket.io rooms live in memory, so several instances would need a shared adapter.
            instances: 1,
            exec_mode: 'fork',
            env: { NODE_ENV: 'production' },
            max_memory_restart: '512M',
            time: true,
        },
    ],
};
