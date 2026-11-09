import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import type { DB } from './db';
import { sessionMiddleware } from './auth';
import { errorHandler } from './http';
import { commonRoutes, type AppConfig } from './routes/common';
import { officerRoutes } from './routes/officer';
import { managerRoutes } from './routes/manager';

export function createApp(db: DB, cfg: AppConfig & { staticDir?: string }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Basic security headers (no extra dependency).
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    next();
  });

  app.use(express.json({ limit: '2.5mb' }));
  app.use(cookieParser());
  app.use(sessionMiddleware(db, cfg));

  // Session cookies are SameSite=Lax; also reject cross-site state-changing requests outright.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.get('origin');
      if (origin && new URL(origin).host !== req.get('host')) {
        res.status(403).json({ error: { code: 'bad_origin', message: 'Cross-site request blocked.' } });
        return;
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api', commonRoutes(db, cfg));
  app.use('/api', officerRoutes(db));
  app.use('/api', managerRoutes(db));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'No such endpoint.' } });
  });

  if (cfg.staticDir && fs.existsSync(cfg.staticDir)) {
    app.use(express.static(cfg.staticDir, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(cfg.staticDir!, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
