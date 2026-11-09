import { Router } from 'express';
import type { DB } from '../db';
import type { SyncResponse, TodayResponse } from '../../shared/types';
import { istDate } from '../../shared/time';
import { requireRole } from '../auth';
import { now } from '../clock';
import { parse, route } from '../http';
import { officerList } from '../services/loans';
import { processBatch, syncSchema } from '../services/sync';

export function officerRoutes(db: DB): Router {
  const r = Router();

  r.get(
    '/officer/today',
    route((req): TodayResponse => {
      const user = requireRole(req, 'officer');
      const t = now(db);
      return {
        generatedAt: t.toISOString(),
        date: istDate(t),
        officer: { id: user.id, name: user.name },
        loans: officerList(db, t, user.id),
      };
    }),
  );

  // Always 200 with a result per item, so the phone can clear what was handled.
  r.post(
    '/sync/attempts',
    route((req): SyncResponse => {
      const user = requireRole(req, 'officer');
      const { items } = parse(syncSchema, req.body);
      return { results: processBatch(db, user, items, now(db)) };
    }),
  );

  return r;
}
