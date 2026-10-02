import { Router, type Request, type Response } from 'express';
import { db, getActiveDay, getMeetingLeadMinutes } from '../db.ts';
import { broadcastUpdate } from '../sse.ts';
import { requireAdminAuth } from '../auth.ts';
import { getIssueWaitStatus, getBufferSummary, isLateTicket, recomputeLatestTicketTimes } from '../services/waitStatus.ts';

export const ticketsRouter = Router();

function formatTicketNumber(ticketNumber: number) {
  return String(ticketNumber).padStart(3, '0');
}

function getTicketCode(ticketNumber: number, priorityLevel = 0) {
  const prefix = priorityLevel === 2 ? 'I' : priorityLevel === 1 ? 'P' : '';
  return `${prefix}${formatTicketNumber(ticketNumber)}`;
}

function getNextDisplayNumber(dayId: number, priorityLevel: number) {
  const row = db.prepare(`
    SELECT MAX(display_number) AS max_num
    FROM tickets
    WHERE day_id = ? AND priority_level = ?
  `).get(dayId, priorityLevel) as any;
  return (row?.max_num || 0) + 1;
}

function getMeetingTime(slotTime: string | null): string | null {
  if (!slotTime) return null;
  const parts = slotTime.split(':').map(Number);
  const hours = parts[0];
  const minutes = parts[1];
  if (hours === undefined || minutes === undefined || !Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  const totalMinutes = hours * 60 + minutes - getMeetingLeadMinutes();
  const normalized = (totalMinutes + 24 * 60) % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

// ==========================================
// 発券状況・待ち時間確認 API
// ==========================================
ticketsRouter.get('/api/issue/status', (req: Request, res: Response) => {
  try {
    const activeDay = getActiveDay();
    const simulatedTime = (req.query.simulatedTime as string) || null;
    const status = getIssueWaitStatus(activeDay, simulatedTime);
    res.json({ success: true, activeDay, ...status });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// 整理券発券 API（単なる通し数字の発行・枠事前割当なし）
// ==========================================
ticketsRouter.post('/api/issue', (req: Request, res: Response) => {
  try {
    const { gameId, simulatedTime } = req.body;
    if (!gameId) {
      res.status(400).json({ success: false, message: 'gameId is required' });
      return;
    }

    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as any;
    if (!game) {
      res.status(404).json({ success: false, message: `ゲームID [${gameId}] がマスタに見つかりません` });
      return;
    }

    const activeDay = req.body.day ? parseInt(String(req.body.day), 10) : getActiveDay();
    recomputeLatestTicketTimes(activeDay);

    // 違法予約の遮断（満席・待ち時間オーバー・スロット未生成等）
    const waitStatus = getIssueWaitStatus(activeDay, simulatedTime);
    if (!waitStatus.canIssue) {
      res.status(400).json({
        success: false,
        code: waitStatus.reason,
        reason: waitStatus.reason,
        message: waitStatus.message,
        maxWaitMinutes: waitStatus.maxWaitMinutes,
        currentWaitMinutes: waitStatus.currentWaitMinutes,
        resumeTime: waitStatus.resumeTime,
      });
      return;
    }

    const issueTransaction = db.transaction(() => {
      const maxRow = db.prepare(`
        SELECT MAX(ticket_number) AS max_num FROM tickets WHERE day_id = ?
      `).get(activeDay) as any;
      const nextNum = (maxRow?.max_num || 0) + 1;
      const displayNumber = getNextDisplayNumber(activeDay, 0);

      // 予測体験枠（目安時刻）の算定
      // ★ 調整枠（is_buffer = 1）およびメンテナンス枠（is_maintenance = 1）は発券予約の目安枠からは除外
      const availableSeats = db.prepare(`
        SELECT 
          r.id AS reservation_id,
          s.id AS slot_id,
          s.slot_time,
          s.lane,
          s.order_idx
        FROM seat_reservations r
        JOIN slots s ON r.slot_id = s.id
        WHERE s.day_id = ? AND s.is_closed = 0 AND s.is_buffer = 0 AND s.is_maintenance = 0 AND r.is_maintenance = 0 AND (r.is_assigned = 0 OR r.status = 'empty')
        ORDER BY s.order_idx ASC, r.seat_no ASC
      `).all(activeDay) as any[];

      // 現在待機中（未割当: issued または checked_in）の人数
      const waitRowBefore = db.prepare(`
        SELECT COUNT(*) AS cnt FROM tickets
        WHERE day_id = ? AND status IN ('issued', 'checked_in') AND assigned_slot_id IS NULL
      `).get(activeDay) as any;
      const waitingCount = waitRowBefore?.cnt || 0;

      const expectedSeat = availableSeats[waitingCount];
      const expectedSlotId = expectedSeat ? expectedSeat.slot_id : null;
      const expectedSlotTime = expectedSeat ? expectedSeat.slot_time : null;
      const expectedLane = expectedSeat ? expectedSeat.lane : null;

      db.prepare(`
        INSERT INTO tickets (
          day_id, ticket_number, display_number, game_id, status,
          priority_level,
          expected_slot_id, expected_slot_time,
          original_expected_slot_id, original_expected_slot_time
        )
        VALUES (?, ?, ?, ?, 'issued', 0, ?, ?, ?, ?)
      `).run(
        activeDay, nextNum, displayNumber, game.id, expectedSlotId, expectedSlotTime,
        expectedSlotId, expectedSlotTime
      );

      const waitRow = db.prepare(`
        SELECT COUNT(*) AS cnt FROM tickets
        WHERE day_id = ? AND status IN ('issued', 'checked_in') AND assigned_slot_id IS NULL
      `).get(activeDay) as any;

      return {
        id: Number((db.prepare('SELECT last_insert_rowid() AS id').get() as any).id),
        ticket_number: nextNum,
        display_number: displayNumber,
        priority_level: 0,
        ticket_code: getTicketCode(displayNumber),
        display_ticket_code: getTicketCode(displayNumber),
        game_id: game.id,
        game_name: game.name,
        waiting_count: waitRow?.cnt || 1,
        expected_slot_id: expectedSlotId,
        expected_slot_time: expectedSlotTime,
        original_expected_slot_id: expectedSlotId,
        original_expected_slot_time: expectedSlotTime,
        expected_lane: expectedLane,
        meeting_time: getMeetingTime(expectedSlotTime),
        day_id: activeDay,
        status: 'issued',
        created_at: new Date().toISOString(),
      };
    });

    const issued = issueTransaction();

    broadcastUpdate({ reason: 'ticket_issued', ticket: issued, dayId: activeDay });
    res.json({ success: true, ticket: issued });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

ticketsRouter.post('/api/admin/issue-priority', requireAdminAuth, (req: Request, res: Response) => {
  try {
    const { gameId, priorityLevel } = req.body;
    const level = Number(priorityLevel);
    if (!gameId || ![1, 2].includes(level)) {
      res.status(400).json({ success: false, message: 'gameId and priorityLevel (1 or 2) are required' });
      return;
    }
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as any;
    if (!game) {
      res.status(404).json({ success: false, message: 'ゲームが見つかりません' });
      return;
    }
    const dayId = req.body.day ? parseInt(String(req.body.day), 10) : getActiveDay();
    const ticket = db.transaction(() => {
      const maxRow = db.prepare('SELECT MAX(ticket_number) AS max_num FROM tickets WHERE day_id = ?').get(dayId) as any;
      const ticketNumber = (maxRow?.max_num || 0) + 1;
      const displayNumber = getNextDisplayNumber(dayId, level);
      const seat = db.prepare(`
        SELECT r.id AS reservation_id, s.id AS slot_id, s.slot_time, s.lane
        FROM seat_reservations r JOIN slots s ON s.id = r.slot_id
        WHERE s.day_id = ? AND s.is_closed = 0 AND s.is_buffer = 0
          AND s.is_maintenance = 0 AND r.is_maintenance = 0
          AND (r.is_assigned = 0 OR r.status = 'empty')
        ORDER BY s.order_idx ASC, r.seat_no ASC LIMIT 1
      `).get(dayId) as any;
      db.prepare(`
        INSERT INTO tickets (
          day_id, ticket_number, display_number, game_id, status, priority_level,
          expected_slot_id, expected_slot_time,
          original_expected_slot_id, original_expected_slot_time
        ) VALUES (?, ?, ?, ?, 'issued', ?, ?, ?, ?, ?)
      `).run(
        dayId, ticketNumber, displayNumber, game.id, level,
        seat?.slot_id ?? null, seat?.slot_time ?? null,
        seat?.slot_id ?? null, seat?.slot_time ?? null
      );
      return {
        id: Number((db.prepare('SELECT last_insert_rowid() AS id').get() as any).id),
        ticket_number: ticketNumber,
        ticket_code: getTicketCode(displayNumber, level),
        display_ticket_code: getTicketCode(displayNumber, level),
        display_number: displayNumber,
        game_id: game.id,
        game_name: game.name,
        priority_level: level,
        expected_slot_id: seat?.slot_id ?? null,
        expected_slot_time: seat?.slot_time ?? null,
        expected_lane: seat?.lane ?? null,
        meeting_time: getMeetingTime(seat?.slot_time ?? null),
        day_id: dayId,
        status: 'issued',
      };
    })();
    broadcastUpdate({ reason: 'priority_ticket_issued', ticket, dayId });
    res.json({ success: true, ticket });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// 遅刻・保留キュー API (現在のアクティブDay対象)
// ==========================================
ticketsRouter.get('/api/late-queue', (req: Request, res: Response) => {
  try {
    const activeDay = getActiveDay();
    const dayId = req.query.day ? parseInt(String(req.query.day), 10) : activeDay;

    const list = db.prepare(`
      SELECT l.*, g.name AS game_name
      FROM late_queue l
      LEFT JOIN games g ON l.game_id = g.id
      WHERE l.day_id = ? AND l.status = 'waiting'
      ORDER BY l.created_at ASC
    `).all(dayId);
    res.json({ success: true, activeDay, list });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

ticketsRouter.post('/api/late-queue/reassign', (req: Request, res: Response) => {
  try {
    const { lateId, reservationId } = req.body;
    if (!lateId) {
      res.status(400).json({ success: false, message: 'lateId is required' });
      return;
    }

    const activeDay = getActiveDay();
    const lateItem = db.prepare("SELECT * FROM late_queue WHERE id = ? AND status = 'waiting'").get(lateId) as any;
    if (!lateItem) {
      res.status(404).json({ success: false, message: 'Late queue item not found' });
      return;
    }

    const reassignTransaction = db.transaction(() => {
      let targetSeat: any = null;

      if (reservationId) {
        targetSeat = db.prepare(`
          SELECT r.*, s.slot_time, s.lane 
          FROM seat_reservations r 
          JOIN slots s ON r.slot_id = s.id 
          WHERE s.day_id = ? AND r.id = ? AND r.status = 'empty'
        `).get(activeDay, reservationId);
      } else {
        targetSeat = db.prepare(`
          SELECT r.*, s.slot_time, s.lane 
          FROM seat_reservations r 
          JOIN slots s ON r.slot_id = s.id 
          WHERE s.day_id = ? AND r.status = 'empty' AND s.is_closed = 0
          ORDER BY s.order_idx ASC, r.seat_no ASC 
          LIMIT 1
        `).get(activeDay);
      }

      if (!targetSeat) {
        return null;
      }

      db.prepare(`
        UPDATE seat_reservations
        SET status = 'checked_in', game_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(lateItem.game_id, targetSeat.id);

      db.prepare(`
        UPDATE late_queue
        SET status = 'reassigned', reassigned_reservation_id = ?
        WHERE id = ?
      `).run(targetSeat.id, lateId);

      return {
        ticketCode: targetSeat.ticket_code,
        slotTime: targetSeat.slot_time,
        lane: targetSeat.lane,
        seatNo: targetSeat.seat_no,
      };
    });

    const result = reassignTransaction();
    if (!result) {
      res.status(409).json({ success: false, message: '現在割り当て可能な空き席がありません' });
      return;
    }

    broadcastUpdate({ reason: 'late_reassigned', lateId, result, dayId: activeDay });
    res.json({ success: true, result });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

ticketsRouter.post('/api/late-queue/cancel', (req: Request, res: Response) => {
  try {
    const { lateId } = req.body;
    db.prepare("UPDATE late_queue SET status = 'cancelled' WHERE id = ?").run(lateId);
    broadcastUpdate({ reason: 'late_cancelled', lateId });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// 整理券一覧取得（受付担当専用: 整理番号・希望ゲーム・到着状況のみ）
// ==========================================
ticketsRouter.get('/api/checkin/list', (req: Request, res: Response) => {
  try {
    const activeDay = getActiveDay();
    const dayId = req.query.day ? parseInt(String(req.query.day), 10) : activeDay;

    let nowMins: number;
    const simulatedTimeStr = (req.query.simulatedTime as string) || null;
    if (simulatedTimeStr && /^\d{1,2}:\d{2}$/.test(simulatedTimeStr)) {
      const [sH = 0, sM = 0] = simulatedTimeStr.split(':').map(Number);
      nowMins = sH * 60 + sM;
    } else {
      const now = new Date();
      nowMins = now.getHours() * 60 + now.getMinutes();
    }

    const rawTickets = db.prepare(`
      SELECT 
        t.id,
        t.day_id,
        t.ticket_number,
        t.display_number,
        t.game_id,
        t.priority_level,
        t.is_late,
        t.status,
        t.assigned_slot_id,
        t.assigned_seat_no,
        t.expected_slot_id,
        t.expected_slot_time,
        t.original_expected_slot_id,
        t.original_expected_slot_time,
        s.lane AS expected_lane,
        s.is_closed AS expected_slot_is_closed,
        t.created_at,
        t.checked_in_at,
        g.name AS game_name,
        g.command AS game_command
      FROM tickets t
      LEFT JOIN games g ON t.game_id = g.id
      LEFT JOIN slots s ON t.expected_slot_id = s.id
      WHERE t.day_id = ? AND t.status != 'cancelled'
      ORDER BY t.ticket_number ASC
    `).all(dayId) as any[];

    const tickets = rawTickets.map((t) => {
      let isDelayed = false;
      if (t.status !== 'assigned') {
        isDelayed = isLateTicket(t);
      }
      return {
        ...t,
        display_ticket_code: getTicketCode(t.display_number ?? t.ticket_number, t.priority_level),
        is_delayed: isDelayed,
      };
    });

    const bufferSummary = getBufferSummary(dayId, nowMins);

    res.json({ success: true, dayId, tickets, bufferSummary });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// 到着ステータス更新（「到着」/「未到着に戻す」）
// ==========================================
ticketsRouter.post('/api/checkin/mark', (req: Request, res: Response) => {
  try {
    const { ticketNumber, ticketCode, ticketId, status } = req.body;
    const activeDay = getActiveDay();

    let targetTicket: any = null;
    if (ticketId) {
      targetTicket = db.prepare(`
        SELECT t.*, g.name AS game_name 
        FROM tickets t 
        LEFT JOIN games g ON t.game_id = g.id 
        WHERE t.id = ?
      `).get(ticketId);
    } else if (ticketNumber || ticketCode) {
      const raw = String(ticketNumber || ticketCode || '').trim();
      const numMatch = raw.match(/\d+/);
      const prefix = raw.match(/^[IP]/i)?.[0].toUpperCase() || '';
      if (numMatch) {
        const num = parseInt(numMatch[0], 10);
        targetTicket = prefix
          ? db.prepare(`
              SELECT t.*, g.name AS game_name 
              FROM tickets t 
              LEFT JOIN games g ON t.game_id = g.id 
              WHERE t.day_id = ? AND t.display_number = ? AND t.priority_level = ?
            `).get(activeDay, num, prefix === 'I' ? 2 : 1)
          : db.prepare(`
              SELECT t.*, g.name AS game_name 
              FROM tickets t 
              LEFT JOIN games g ON t.game_id = g.id 
              WHERE t.day_id = ? AND t.display_number = ? AND t.priority_level = 0
            `).get(activeDay, num);
        if (!targetTicket && !prefix) {
          targetTicket = db.prepare(`
            SELECT t.*, g.name AS game_name
            FROM tickets t
            LEFT JOIN games g ON t.game_id = g.id
            WHERE t.day_id = ? AND t.ticket_number = ?
            ORDER BY t.priority_level ASC
            LIMIT 1
          `).get(activeDay, num);
        }
      }
    }

    if (!targetTicket) {
      res.status(404).json({ success: false, message: '整理券が見つかりません' });
      return;
    }

    if (targetTicket.status === 'assigned') {
      const displayCode = targetTicket.display_number !== undefined && targetTicket.display_number !== null
        ? getTicketCode(targetTicket.display_number, targetTicket.priority_level)
        : String(targetTicket.ticket_number).padStart(3, '0');
      res.status(400).json({ success: false, message: `${displayCode} は既に枠に割当・案内済みのため変更できません` });
      return;
    }

    const nextStatus = status || (targetTicket.status === 'checked_in' ? 'issued' : 'checked_in');
    const checkedInAt = nextStatus === 'checked_in' ? new Date().toISOString() : null;

    db.prepare(`
      UPDATE tickets
      SET status = ?, checked_in_at = ?
      WHERE id = ?
    `).run(nextStatus, checkedInAt, targetTicket.id);

    broadcastUpdate({
      reason: 'ticket_checkin',
      ticketId: targetTicket.id,
      ticketNumber: targetTicket.ticket_number,
      status: nextStatus,
      dayId: activeDay,
    });

    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const isDelayed = isLateTicket(targetTicket);

    const bufferSummary = getBufferSummary(activeDay);

    const displayCode = targetTicket.display_number !== undefined && targetTicket.display_number !== null
      ? getTicketCode(targetTicket.display_number, targetTicket.priority_level)
      : String(targetTicket.ticket_number).padStart(3, '0');

    let message = targetTicket.game_name
      ? `${displayCode} (${targetTicket.game_name}): ${nextStatus === 'checked_in' ? '到着済にしました' : '未到着に戻しました'}`
      : `${displayCode} を${nextStatus === 'checked_in' ? '到着済み' : '未到着'}に更新`;
    if (nextStatus === 'checked_in' && isDelayed) {
      if (bufferSummary.canAccommodate) {
        message = `${displayCode}（遅刻）を受付。調整枠（残${bufferSummary.remainingBufferSeats}席）にて確実に案内可能です`;
      } else {
        message = `${displayCode}（遅刻）を受付。調整枠残席${bufferSummary.remainingBufferSeats}席（空き枠または詰めで調整）`;
      }
    }

    res.json({
      success: true,
      ticketNumber: targetTicket.ticket_number,
      ticketCode: displayCode,
      gameName: targetTicket.game_name,
      status: nextStatus,
      checkedInAt,
      isDelayed,
      bufferSummary,
      message,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// 番号スキャンまたは入力による到着受付
// ==========================================
ticketsRouter.post('/api/checkin/by-ticket', (req: Request, res: Response) => {
  try {
    const { ticketCode, ticketNumber, ticketId, status } = req.body;
    const raw = String(ticketNumber || ticketCode || '').trim();
    if (!raw && !ticketId) {
      res.status(400).json({ success: false, message: '整理券番号を入力してください' });
      return;
    }

    const activeDay = getActiveDay();
    let targetTicket: any = null;

    if (ticketId) {
      targetTicket = db.prepare(`
        SELECT t.*, g.name AS game_name 
        FROM tickets t 
        LEFT JOIN games g ON t.game_id = g.id 
        WHERE t.id = ?
      `).get(ticketId);
    }

    if (!targetTicket && raw) {
      const numMatch = raw.match(/\d+/);
      const prefix = raw.match(/^[IP]/i)?.[0].toUpperCase() || '';

      if (numMatch) {
        const num = parseInt(numMatch[0], 10);
        targetTicket = db.prepare(`
          SELECT t.*, g.name AS game_name 
          FROM tickets t 
          LEFT JOIN games g ON t.game_id = g.id 
          WHERE t.day_id = ?
            AND t.display_number = ?
            AND t.priority_level = ?
        `).get(activeDay, num, prefix === 'I' ? 2 : prefix === 'P' ? 1 : 0);
        if (!targetTicket && !prefix) {
          targetTicket = db.prepare(`
            SELECT t.*, g.name AS game_name
            FROM tickets t
            LEFT JOIN games g ON t.game_id = g.id
            WHERE t.day_id = ? AND t.ticket_number = ?
            ORDER BY t.priority_level ASC
            LIMIT 1
          `).get(activeDay, num);
        }
      }
    }

    if (!targetTicket) {
      // 従来の席予約コードとの後方互換
      const reservation = db.prepare(`
        SELECT r.*, s.slot_time, s.lane, g.name AS game_name
        FROM seat_reservations r
        JOIN slots s ON r.slot_id = s.id
        LEFT JOIN games g ON r.game_id = g.id
        WHERE s.day_id = ? AND (UPPER(r.ticket_code) = ? OR UPPER(COALESCE(r.assigned_ticket_code, '')) = ?)
      `).get(activeDay, raw.toUpperCase(), raw.toUpperCase()) as any;

      if (reservation) {
        const nextSt = status || (reservation.status === 'checked_in' ? 'booked' : 'checked_in');
        db.prepare('UPDATE seat_reservations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(nextSt, reservation.id);
        broadcastUpdate({ reason: 'ticket_checkin', reservationId: reservation.id, nextStatus: nextSt, dayId: activeDay });
        res.json({
          success: true,
          ticketCode: reservation.ticket_code,
          status: nextSt,
          message: `整理券 [${reservation.ticket_code}] のステータスを更新しました`,
        });
        return;
      }

      res.status(404).json({ success: false, message: `Day ${activeDay} に整理番号 [${raw}] が見つかりません` });
      return;
    }

    const displayCode = targetTicket.display_number !== undefined && targetTicket.display_number !== null
      ? getTicketCode(targetTicket.display_number, targetTicket.priority_level)
      : String(targetTicket.ticket_number).padStart(3, '0');

    if (targetTicket.status === 'assigned') {
      res.status(400).json({
        success: false,
        message: `${displayCode} は既に枠（スロット）に割当・案内済みのため変更できません`,
      });
      return;
    }

    const nextStatus = status || (targetTicket.status === 'checked_in' ? 'issued' : 'checked_in');
    const checkedInAt = nextStatus === 'checked_in' ? new Date().toISOString() : null;

    db.prepare(`
      UPDATE tickets
      SET status = ?, checked_in_at = ?
      WHERE id = ?
    `).run(nextStatus, checkedInAt, targetTicket.id);

    broadcastUpdate({
      reason: 'ticket_checkin',
      ticketId: targetTicket.id,
      ticketNumber: targetTicket.ticket_number,
      status: nextStatus,
      dayId: activeDay,
    });

    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const isDelayed = isLateTicket(targetTicket);

    const bufferSummary = getBufferSummary(activeDay);

    let message = `${displayCode} (${targetTicket.game_name}): ${nextStatus === 'checked_in' ? '到着済にしました' : '未到着に戻しました'}`;
    if (nextStatus === 'checked_in' && isDelayed) {
      if (bufferSummary.canAccommodate) {
        message = `${displayCode}（遅刻）を受付。調整枠（残${bufferSummary.remainingBufferSeats}席）にて確実に案内可能です`;
      } else {
        message = `${displayCode}（遅刻）を受付。調整枠残席${bufferSummary.remainingBufferSeats}席（空き枠または詰めで調整）`;
      }
    }

    res.json({
      success: true,
      ticketNumber: targetTicket.ticket_number,
      ticketCode: displayCode,
      gameName: targetTicket.game_name,
      status: nextStatus,
      checkedInAt,
      isDelayed,
      bufferSummary,
      message,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// 整理券の取消（欠席・キャンセル）
// ==========================================
ticketsRouter.post('/api/checkin/cancel', (req: Request, res: Response) => {
  try {
    const { ticketNumber, ticketId } = req.body;
    const activeDay = getActiveDay();

    let targetTicket: any = null;
    if (ticketId) {
      targetTicket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    } else if (ticketNumber) {
      const raw = String(ticketNumber).trim();
      const num = parseInt(raw.replace(/[^0-9]/g, ''), 10);
      const prefix = raw.match(/^[IP]/i)?.[0].toUpperCase() || '';
      targetTicket = prefix
        ? db.prepare('SELECT * FROM tickets WHERE day_id = ? AND display_number = ? AND priority_level = ?')
          .get(activeDay, num, prefix === 'I' ? 2 : 1)
        : db.prepare('SELECT * FROM tickets WHERE day_id = ? AND display_number = ? AND priority_level = 0')
          .get(activeDay, num);
      if (!targetTicket && !prefix) {
        targetTicket = db.prepare(`
          SELECT * FROM tickets
          WHERE day_id = ? AND ticket_number = ?
          ORDER BY priority_level ASC
          LIMIT 1
        `).get(activeDay, num);
      }
    }

    if (!targetTicket) {
      res.status(404).json({ success: false, message: '整理券が見つかりません' });
      return;
    }

    db.transaction(() => {
      if (targetTicket.assigned_slot_id && targetTicket.assigned_seat_no) {
        db.prepare(`
          UPDATE seat_reservations
          SET status = 'empty', is_assigned = 0, ticket_number = NULL, game_id = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE slot_id = ? AND seat_no = ?
        `).run(targetTicket.assigned_slot_id, targetTicket.assigned_seat_no);
      }
      db.prepare("UPDATE tickets SET status = 'cancelled' WHERE id = ?").run(targetTicket.id);
    })();

    broadcastUpdate({ reason: 'ticket_cancelled', ticketNumber: targetTicket.ticket_number, dayId: activeDay });
    const cancelCode = targetTicket.display_number !== undefined && targetTicket.display_number !== null
      ? getTicketCode(targetTicket.display_number, targetTicket.priority_level)
      : String(targetTicket.ticket_number).padStart(3, '0');
    res.json({ success: true, message: `${cancelCode} を取消しました` });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// キャンセル（座席ID指定互換）
ticketsRouter.post('/api/cancel', (req: Request, res: Response) => {
  try {
    const { reservationId } = req.body;
    if (!reservationId) {
      res.status(400).json({ success: false, message: 'reservationId is required' });
      return;
    }

    const current = db.prepare('SELECT * FROM seat_reservations WHERE id = ?').get(reservationId) as any;
    if (current && current.ticket_number) {
      db.prepare("UPDATE tickets SET status = 'cancelled' WHERE day_id = (SELECT day_id FROM slots WHERE id = ?) AND ticket_number = ?")
        .run(current.slot_id, current.ticket_number);
    }

    db.prepare(`
      UPDATE seat_reservations
      SET status = 'empty',
          is_assigned = 0,
          ticket_number = NULL,
          game_id = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(reservationId);

    broadcastUpdate({ reason: 'reservation_cancelled', reservationId });
    res.json({ success: true, message: 'Reservation cancelled, seat is now empty' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});
