import { Router, type Request, type Response } from 'express';
import { requireAdminAuth } from '../auth.ts';
import { getActiveDay, setActiveDay } from '../db.ts';
import { broadcastUpdate } from '../sse.ts';

export const daysRouter = Router();

// ==========================================
// 日程管理 (Day 1 / Day 2) API
// ==========================================
daysRouter.get('/api/day/current', (_req: Request, res: Response) => {
  try {
    const activeDay = getActiveDay();
    res.json({ success: true, activeDay });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

daysRouter.post('/api/day/switch', requireAdminAuth, (req: Request, res: Response) => {
  try {
    const { day } = req.body;
    const dayNum = parseInt(String(day), 10);
    if (dayNum !== 1 && dayNum !== 2) {
      res.status(400).json({ success: false, message: 'day must be 1 or 2' });
      return;
    }
    setActiveDay(dayNum);
    broadcastUpdate({ reason: 'day_switched', activeDay: dayNum });
    res.json({ success: true, activeDay: dayNum, message: `Day ${dayNum} に切り替えました` });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

