import { Router, type Request, type Response } from 'express';
import {
  requireAdminAuth,
  verifyAdminPassword,
  generateAdminToken,
  isValidAdminToken,
  revokeAdminToken,
  getAdminTokenFromRequest,
} from '../auth.ts';
import {
  db,
  getActiveDay,
  getIssuingPaused,
  getMaxWaitMinutes,
  setMaxWaitMinutes,
  setIssuingPaused,
  getMeetingLeadMinutes,
  setMeetingLeadMinutes,
} from '../db.ts';
import { broadcastUpdate } from '../sse.ts';

export const adminRouter = Router();

// ==========================================
// 管理者認証 API (ログイン & トークン検証)
// ==========================================
adminRouter.post('/api/admin/login', (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    if (verifyAdminPassword(password)) {
      const token = generateAdminToken();
      res.json({ success: true, token, message: '管理者認証に成功しました' });
    } else {
      res.status(401).json({ success: false, message: 'パスワードが正しくありません' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

const handleVerify = (req: Request, res: Response) => {
  try {
    const token = getAdminTokenFromRequest(req);
    if (isValidAdminToken(token)) {
      res.json({ success: true, valid: true });
    } else {
      res.status(401).json({ success: false, valid: false, code: 'UNAUTHORIZED', message: 'トークンが無効または期限切れです' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

adminRouter.get('/api/admin/verify', handleVerify);
adminRouter.post('/api/admin/verify', handleVerify);

adminRouter.post('/api/admin/logout', (req: Request, res: Response) => {
  try {
    const token = getAdminTokenFromRequest(req);
    revokeAdminToken(token);
    res.json({ success: true, message: 'ログアウトしました' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// 設定 API (日程 & 最大許容待ち時間 & 集合時間)
// ==========================================
adminRouter.get('/api/settings', (_req: Request, res: Response) => {
  try {
    const activeDay = getActiveDay();
    const maxWaitMinutes = getMaxWaitMinutes();
    const meetingLeadMinutes = getMeetingLeadMinutes();
    res.json({ success: true, activeDay, maxWaitMinutes, meetingLeadMinutes, issuingPaused: getIssuingPaused() });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

adminRouter.post('/api/settings/issuing-pause', requireAdminAuth, (req: Request, res: Response) => {
  try {
    if (typeof req.body.paused !== 'boolean') {
      res.status(400).json({ success: false, message: 'paused must be a boolean' });
      return;
    }
    setIssuingPaused(req.body.paused);
    broadcastUpdate({ reason: 'issuing_pause_updated', issuingPaused: req.body.paused });
    res.json({
      success: true,
      issuingPaused: req.body.paused,
      message: req.body.paused ? '発券を一時停止しました' : '発券を再開しました',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

adminRouter.post('/api/settings/max-wait', requireAdminAuth, (req: Request, res: Response) => {
  try {
    const { maxWaitMinutes } = req.body;
    if (maxWaitMinutes === undefined || maxWaitMinutes === null) {
      res.status(400).json({ success: false, message: 'maxWaitMinutes is required' });
      return;
    }
    const mins = Math.max(0, parseInt(String(maxWaitMinutes), 10) || 0);
    setMaxWaitMinutes(mins);
    broadcastUpdate({ reason: 'settings_updated', maxWaitMinutes: mins });
    res.json({ success: true, maxWaitMinutes: mins, message: `最大許容待ち時間を ${mins > 0 ? `${mins}分` : '無制限'} に設定しました` });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

adminRouter.get('/api/settings/meeting-lead', (_req: Request, res: Response) => {
  try {
    const meetingLeadMinutes = getMeetingLeadMinutes();
    res.json({ success: true, meetingLeadMinutes });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

adminRouter.post('/api/settings/meeting-lead', requireAdminAuth, (req: Request, res: Response) => {
  try {
    const { meetingLeadMinutes } = req.body;
    if (meetingLeadMinutes === undefined || meetingLeadMinutes === null) {
      res.status(400).json({ success: false, message: 'meetingLeadMinutes is required' });
      return;
    }
    const mins = Math.max(0, parseInt(String(meetingLeadMinutes), 10) || 0);
    setMeetingLeadMinutes(mins);
    broadcastUpdate({ reason: 'settings_updated', meetingLeadMinutes: mins });
    res.json({ success: true, meetingLeadMinutes: mins, message: `集合時間を体験枠の ${mins}分前 に設定しました` });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// 整理券フルリセット API (管理者専用)
// ==========================================
adminRouter.post('/api/admin/reset-tickets', requireAdminAuth, (req: Request, res: Response) => {
  try {
    const activeDay = getActiveDay();
    const day = req.body.day ? parseInt(String(req.body.day), 10) : activeDay;
    const isAllDays = req.body.allDays === true;

    db.transaction(() => {
      if (isAllDays) {
        db.prepare('DELETE FROM tickets').run();
        db.prepare('DELETE FROM late_queue').run();
        db.prepare(`
          UPDATE seat_reservations 
          SET status = 'empty',
              is_assigned = 0,
              ticket_number = NULL,
              assigned_ticket_code = NULL,
              game_id = NULL,
              note = NULL,
              priority_level = 0,
              updated_at = CURRENT_TIMESTAMP
          WHERE is_maintenance = 0
        `).run();
        db.prepare(`
          UPDATE seat_reservations 
          SET ticket_number = NULL,
              assigned_ticket_code = NULL,
              game_id = NULL,
              note = NULL,
              priority_level = 0,
              updated_at = CURRENT_TIMESTAMP
          WHERE is_maintenance = 1
        `).run();
      } else {
        db.prepare('DELETE FROM tickets WHERE day_id = ?').run(day);
        db.prepare('DELETE FROM late_queue WHERE day_id = ?').run(day);
        db.prepare(`
          UPDATE seat_reservations 
          SET status = 'empty',
              is_assigned = 0,
              ticket_number = NULL,
              assigned_ticket_code = NULL,
              game_id = NULL,
              note = NULL,
              priority_level = 0,
              updated_at = CURRENT_TIMESTAMP
          WHERE slot_id IN (SELECT id FROM slots WHERE day_id = ?)
            AND is_maintenance = 0
        `).run(day);
        db.prepare(`
          UPDATE seat_reservations 
          SET ticket_number = NULL,
              assigned_ticket_code = NULL,
              game_id = NULL,
              note = NULL,
              priority_level = 0,
              updated_at = CURRENT_TIMESTAMP
          WHERE slot_id IN (SELECT id FROM slots WHERE day_id = ?)
            AND is_maintenance = 1
        `).run(day);
      }
    })();

    broadcastUpdate({ reason: 'tickets_reset', dayId: isAllDays ? activeDay : day });

    res.json({
      success: true,
      message: isAllDays
        ? '全日程の整理券・配席データをフルリセットしました'
        : `Day ${day} の整理券・配席データをフルリセットしました`,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});
