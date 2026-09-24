import { Router, type Request, type Response } from 'express';
import { requireAdminAuth } from '../auth.ts';
import { db } from '../db.ts';
import { broadcastUpdate } from '../sse.ts';

export const gamesRouter = Router();

// ==========================================
// ゲームマスタ API（2日間共通共有マスタ）
// ==========================================
gamesRouter.get('/api/games', (_req: Request, res: Response) => {
  try {
    const games = db.prepare('SELECT * FROM games ORDER BY id ASC').all();
    res.json({ success: true, games });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

gamesRouter.post('/api/games', requireAdminAuth, (req: Request, res: Response) => {
  try {
    const { id, name, command } = req.body;
    if (!id || !name) {
      res.status(400).json({ success: false, message: 'id and name are required' });
      return;
    }
    const stmt = db.prepare(`
      INSERT INTO games (id, name, command)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        command = excluded.command
    `);
    stmt.run(id.trim(), name.trim(), command ? command.trim() : '');
    broadcastUpdate({ reason: 'games_updated' });
    res.json({ success: true, message: 'Game saved successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

gamesRouter.post('/api/games/delete', requireAdminAuth, (req: Request, res: Response) => {
  try {
    const { id } = req.body;
    if (!id) {
      res.status(400).json({ success: false, message: 'id is required' });
      return;
    }
    const stmt = db.prepare('DELETE FROM games WHERE id = ?');
    stmt.run(id);
    broadcastUpdate({ reason: 'games_deleted' });
    res.json({ success: true, message: 'Game deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

