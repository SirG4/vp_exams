# Project Commands

Run these commands from the project root:

```bash
cd /mnt/secrets/Desktop/Vit_Server/exams/vp_exams
```

## Development

```bash
npm install
npm run dev
npm run dev -- -H 0.0.0.0 -p 3000
```

Development server is normally available at:

- `http://localhost:3000`
- `http://localhost:3000/admin`

## Production Setup and Server

Run the complete setup, tests, build, and server startup:

```bash
./setup-production.sh
```

The setup script uses `.next-production.pid` to manage the server process and writes logs to `production.log`.

## Restart the Production Server

Default setup port is `3035`, but the currently running server may use another port such as `3030`.

Read the PID recorded by the setup script:

```bash
cat .next-production.pid
```

Stop the recorded server:

```bash
PID=$(cat .next-production.pid)
kill "$PID"
```

Wait briefly and force-stop only if necessary:

```bash
kill -TERM "$PID"
```

Start the production server on port `3030`:

```bash
export EXAM_DB_PATH="/var/lib/vp-exams/exams.db"
setsid env EXAM_DB_PATH="$EXAM_DB_PATH" NODE_ENV=production npm run start -- -H 0.0.0.0 -p 3030 >> production.log 2>&1 < /dev/null &
echo $! > .next-production.pid
```

Start the production server on port `3035`:

```bash
export EXAM_DB_PATH="/var/lib/vp-exams/exams.db"
setsid env EXAM_DB_PATH="$EXAM_DB_PATH" NODE_ENV=production npm run start -- -H 0.0.0.0 -p 3035 >> production.log 2>&1 < /dev/null &
echo $! > .next-production.pid
```

After stopping or changing the server, rebuild before restart when source code or environment values changed:

```bash
npm run build
```

If the configured database is the workspace fallback database instead of `/var/lib/vp-exams/exams.db`, start with:

```bash
export EXAM_DB_PATH="$PWD/.data/exams.db"
setsid env EXAM_DB_PATH="$EXAM_DB_PATH" NODE_ENV=production npm run start -- -H 0.0.0.0 -p 3030 >> production.log 2>&1 < /dev/null &
echo $! > .next-production.pid
```

Only use one database consistently. Do not migrate or bootstrap accounts against one database and then serve another.

## Check Server Status

Check the recorded process:

```bash
PID=$(cat .next-production.pid)
ps -p "$PID" -o pid,user,stat,lstart,cmd
```

Check listening ports:

```bash
ss -ltnp | grep -E ':(3000|3030|3035)\b'
```

Health check:

```bash
curl -fsS http://127.0.0.1:3030/api/server-time
curl -fsS http://127.0.0.1:3035/api/server-time
```

View setup and server logs:

```bash
tail -n 100 production.log
```

Follow logs while the server runs:

```bash
tail -n 100 -f production.log
```

Find all Next.js processes:

```bash
ps -eo pid,cmd | grep -E 'next (dev|start)|next-server|npm run (dev|start)' | grep -v grep
```

## Stop a Production Server

Using the setup PID file:

```bash
PID=$(cat .next-production.pid)
kill "$PID"
```

Stop by port only if the PID file is missing:

```bash
PID=$(ss -ltnp 'sport = :3030' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -n 1)
if [ -n "$PID" ]; then kill "$PID"; fi
```

## Build and Test

```bash
npm run lint
npm run db:test
npm run auth:test
npm run batch:test
npm run azure:test
npm run build
```

Run every automated test suite:

```bash
npm run db:test && npm run auth:test && npm run batch:test && npm run azure:test
```

## SQLite Database

Run metadata migrations:

```bash
npm run db:migrate
```

Run migrations against a specific database:

```bash
node scripts/migrate-exams.mjs /absolute/path/to/exams.db
```

Open the configured database interactively only if the `sqlite3` client is installed:

```bash
sqlite3 /var/lib/vp-exams/exams.db
```

Back up SQLite safely:

```bash
mkdir -p backups
sqlite3 /var/lib/vp-exams/exams.db ".backup backups/exams-$(date -u +%Y%m%dT%H%M%SZ).db"
```

Inspect the SQLite users without exposing password hashes:

```bash
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/var/lib/vp-exams/exams.db', { readOnly: true }); console.table(db.prepare('SELECT id,email,role,status,created_at FROM users ORDER BY id').all()); db.close();"
```

Workspace fallback database inspection:

```bash
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('.data/exams.db', { readOnly: true }); console.table(db.prepare('SELECT id,email,role,status,created_at FROM users ORDER BY id').all()); db.close();"
```

## Super Admin Accounts

Create or reset a super admin:

```bash
npm run auth:bootstrap-admin
```

For a specific database:

```bash
EXAM_DB_PATH=/var/lib/vp-exams/exams.db npm run auth:bootstrap-admin
```

For the workspace fallback database:

```bash
EXAM_DB_PATH="$PWD/.data/exams.db" npm run auth:bootstrap-admin
```

## Azure and Blob Migration

```bash
npm run db:migrate-blobs
npm run azure:test
```

Never print `.env.local`, connection strings, account keys, SAS tokens, or Azure credentials to shared terminals or logs.

## Batch Template

Generate or refresh the Excel batch template:

```bash
npm run create:batch-template
```

## Troubleshooting

Check that the login page and API return successfully:

```bash
curl -fsSI http://localhost:3030/login
curl -fsSI http://localhost:3030/api/server-time
```

Check recent setup and server errors:

```bash
tail -n 200 production.log | grep -E '\[ERROR\]|\[WARN\]|Error|failed|EADDRINUSE'
```

Check process and environment details:

```bash
node --version
npm --version
printf 'EXAM_DB_PATH=%s\n' "${EXAM_DB_PATH:-<not set>}"
ss -ltnp | grep -E ':(3000|3030|3035)\b'
```

If port `3030` or `3035` is already in use, stop the matching Next.js process and restart with the required port. Do not run development and production servers simultaneously if they share the same database and port state.
