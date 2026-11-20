setsid nohup npm run dev -- -H 0.0.0.0 -p 3000 >/dev/null 2>&1 &

# Seed or promote a super admin (run once per account)
npm run auth:bootstrap-admin

## Production setup

Run from the project directory as the server account:

```bash
./setup-production.sh
```

The script asks for a port and SQLite directory, installs dependencies, runs migrations and tests, builds and starts Next.js in production mode, and finally asks for the super-admin email and password.

It uses `PORT` and `EXAM_DB_DIR` environment variables as defaults. It requires `sudo` only when the selected SQLite directory is outside the server account's writable directories.