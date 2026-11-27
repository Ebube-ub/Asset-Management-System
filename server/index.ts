import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { initDb } from './db/index.js';
import { api } from './routes.js';
import { errorHandler, notFound } from './lib/http.js';
import { attachUser } from './lib/auth.js';
import { seedIfEmpty } from './db/seed.js';
import { applyMigrations } from './db/migrations.js';

const PORT = Number(process.env.PORT) || 4000;

async function main() {
  await initDb();
  // Demo/first-run data first, then the incremental migrations so that a fresh
  // database and an upgraded one follow exactly the same code path.
  await seedIfEmpty();
  const migrated = await applyMigrations();
  if (migrated.length) console.log(`Applied ${migrated.length} migration(s): ${migrated.join(', ')}`);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(attachUser);

  app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads'), { fallthrough: true }));
  app.use('/api', api);
  app.use('/api', notFound);

  const clientDist = path.resolve(process.cwd(), 'dist', 'client');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(errorHandler);

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`I4nnova API listening on http://127.0.0.1:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start I4nnova:', err);
  process.exit(1);
});
