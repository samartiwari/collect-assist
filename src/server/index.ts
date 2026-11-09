import path from 'node:path';
import { openDb, isEmpty } from './db';
import { createApp } from './app';
import { seed } from './seed';

const isProd = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET ?? (isProd ? '' : 'dev-only-secret-change-me');
if (!jwtSecret || jwtSecret.length < 16) {
  console.error('JWT_SECRET must be set (at least 16 characters).');
  process.exit(1);
}

const dbPath = process.env.DATABASE_PATH ?? './data/collect.db';
const db = openDb(dbPath);
if (isEmpty(db)) {
  console.log('Empty database: loading demo data…');
  seed(db, { now: new Date() });
}

const app = createApp(db, {
  jwtSecret,
  secureCookies: isProd,
  demoMode: (process.env.DEMO_MODE ?? 'true') === 'true',
  staticDir: isProd ? path.resolve('dist') : undefined,
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`CollectAssist API listening on http://localhost:${port}`));
