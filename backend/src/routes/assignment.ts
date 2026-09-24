import { Router, type Request, type Response } from 'express';
import { db, getActiveDay, getMeetingLeadMinutes } from '../db.ts';
import { broadcastUpdate } from '../sse.ts';
import { getBufferSummary } from '../services/waitStatus.ts';

export const assignmentRouter = Router();

// ==========================================
// 全スロットの確定状況と「割当予定」プレビュー取得
// ==========================================
assignmentRouter.get('/api/assignment/status', (req: Request, res: Response) => {
  try {
    const activeDay = getActiveDay();
    const dayId = req.query.day ? parseInt(String(req.query.day), 10) : activeDay;

    const rows = db.prepare(`
      SELECT 
        s.id AS slot_id,
        s.day_id,
        s.order_idx,
        s.slot_time,
        s.lane,
        s.duration_minutes,
        s.play_duration,
        s.cleanup_duration,
        s.is_buffer,
        s.is_maintenance,
        s.is_closed,
        r.id AS reservation_id,
        r.seat_no,
        r.ticket_code,
        r.ticket_number,
        CASE 
          WHEN r.ticket_number IS NOT NULL THEN 'No. ' || r.ticket_number
          WHEN r.assigned_ticket_code IS NOT NULL THEN r.assigned_ticket_code
          ELSE r.ticket_code
        END AS display_ticket_code,
        r.note,
        r.status,
        r.is_assigned,
        r.game_id,
        g.name AS game_name,
        g.command AS game_command
      FROM slots s
      LEFT JOIN seat_reservations r ON s.id = r.slot_id
      LEFT JOIN games g ON r.game_id = g.id
      WHERE s.day_id = ?
      ORDER BY s.order_idx ASC, r.seat_no ASC
    `).all(dayId) as any[];

    const slotsMap = new Map<number, any>();
    for (const row of rows) {
      if (!slotsMap.has(row.slot_id)) {
        slotsMap.set(row.slot_id, {
          id: row.slot_id,
          day_id: row.day_id,
          order_idx: row.order_idx,
          slot_time: row.slot_time,
          lane: row.lane,
          duration_minutes: row.duration_minutes || 3,
          play_duration: row.play_duration || 5,
          cleanup_duration: row.cleanup_duration ?? 2,
          is_buffer: row.is_buffer === 1,
          is_maintenance: row.is_maintenance === 1,
          is_closed: row.is_closed === 1,
          seats: [],
          plannedSeats: [],
          canFill: false,
        });
      }
      if (row.reservation_id) {
        slotsMap.get(row.slot_id).seats.push({
          id: row.reservation_id,
          seat_no: row.seat_no,
          ticket_code: row.ticket_code,
          ticket_number: row.ticket_number,
          display_ticket_code: row.display_ticket_code,
          note: row.note,
          status: row.status,
          is_assigned: row.is_assigned === 1,
          game_id: row.game_id,
          game_name: row.game_name,
          game_command: row.game_command,
        });
      }
    }

    const slotList = Array.from(slotsMap.values());
    const meetingLeadMinutes = getMeetingLeadMinutes();

    // 現在時刻（シミュレーション時刻対応）
    let nowMins: number;
    const simulatedTimeStr = (req.query.simulatedTime as string) || null;
    if (simulatedTimeStr && /^\d{1,2}:\d{2}$/.test(simulatedTimeStr)) {
      const [sH = 0, sM = 0] = simulatedTimeStr.split(':').map(Number);
      nowMins = sH * 60 + sM;
    } else {
      const now = new Date();
      nowMins = now.getHours() * 60 + now.getMinutes();
    }

    // 到着済み（checked_in）でまだ枠に割り当てられていないチケットを昇順で取得
    const unassignedCheckedIn = db.prepare(`
      SELECT t.*, g.name AS game_name, g.command AS game_command
      FROM tickets t
      LEFT JOIN games g ON t.game_id = g.id
      WHERE t.day_id = ? AND t.status = 'checked_in' AND t.assigned_slot_id IS NULL
      ORDER BY t.ticket_number ASC
    `).all(dayId) as any[];

    // 各スロットの集合時間と初期化
    const openSlots: any[] = [];
    for (const slot of slotList) {
      const [sH, sM] = slot.slot_time.split(':').map(Number);
      const slotMins = sH * 60 + sM;
      const meetingTotalMins = (slotMins - meetingLeadMinutes + 1440) % 1440;
      const mH = Math.floor(meetingTotalMins / 60);
      const mM = meetingTotalMins % 60;
      slot.meeting_time = `${String(mH).padStart(2, '0')}:${String(mM).padStart(2, '0')}`;
      slot.meeting_lead_minutes = meetingLeadMinutes;
      slot.is_meeting_reached = nowMins >= (slotMins - meetingLeadMinutes);
      slot.canFill = !slot.is_maintenance;

      if (!slot.is_closed) {
        openSlots.push(slot);
      }
    }

    // スコアリング優先度による枠割当アルゴリズム:
    // 優先度1: 当該スロットのオンタイム予定客（expected_slot_id === slot.id）
    // 優先度2: 遅延者（予定枠が閉鎖済み、または予定時刻がスロット時刻より前）
    // 優先度3: 未来枠からの前倒し客（手前の空席に前詰め）
    // ※調整枠（is_buffer = 1）は遅延者を優先吸収、早着客も挿入可
    // ※メンテナンス枠（is_maintenance = 1）は客を一切割り当てない
    const closedSlotIds = new Set(
      slotList.filter((s: any) => s.is_closed).map((s: any) => s.id)
    );
    const assignedTicketIds = new Set<number>();

    for (const slot of openSlots) {
      if (slot.is_maintenance) {
        slot.canFill = false;
        slot.plannedSeats = [];
        continue;
      }

      const emptySeats = slot.seats.filter((s: any) => !s.is_assigned && s.status === 'empty');
      if (emptySeats.length === 0) continue;

      const [sH, sM] = slot.slot_time.split(':').map(Number);
      const slotMins = sH * 60 + sM;

      const candidates = unassignedCheckedIn
        .filter((t) => !assignedTicketIds.has(t.id))
        .map((t) => {
          let score = 99;
          let type: 'on_time' | 'delayed' | 'advanced' | 'buffer' | 'fill' = 'fill';

          const isClosedOriginal = t.expected_slot_id && closedSlotIds.has(t.expected_slot_id);
          let expMins: number | null = null;
          if (t.expected_slot_time) {
            const [eH, eM] = t.expected_slot_time.split(':').map(Number);
            expMins = eH * 60 + eM;
          }

          const isDelayed = isClosedOriginal || (expMins !== null && expMins < slotMins);
          const isCurrentSlot = t.expected_slot_id === slot.id || (expMins !== null && expMins === slotMins);
          const isAdvance = expMins !== null && expMins > slotMins;

          if (slot.is_buffer) {
            if (isDelayed) {
              score = 2;
              type = 'buffer';
            } else if (isAdvance) {
              score = 3;
              type = 'advanced';
            } else {
              score = 4;
              type = 'fill';
            }
          } else {
            if (isCurrentSlot) {
              score = 1;
              type = 'on_time';
            } else if (isDelayed) {
              score = 2;
              type = 'delayed';
            } else if (isAdvance) {
              score = 3;
              type = 'advanced';
            } else {
              score = 4;
              type = 'fill';
            }
          }

          return { ticket: t, score, type };
        })
        .filter((c) => c.score < 99)
        .sort((a, b) => {
          if (a.score !== b.score) return a.score - b.score;
          // 遅刻者（score === 2）または早着者（score === 3）同士の場合、早く到着した順（checked_in_at 昇順）にする
          if ((a.score === 2 || a.score === 3) && a.score === b.score) {
            const timeA = a.ticket.checked_in_at ? new Date(a.ticket.checked_in_at).getTime() : 0;
            const timeB = b.ticket.checked_in_at ? new Date(b.ticket.checked_in_at).getTime() : 0;
            if (timeA !== timeB) {
              return timeA - timeB;
            }
          }
          return a.ticket.ticket_number - b.ticket.ticket_number;
        });

      for (let i = 0; i < emptySeats.length && i < candidates.length; i++) {
        const cand = candidates[i];
        const seat = emptySeats[i];
        if (!cand || !seat) continue;
        const { ticket: t, type } = cand;
        assignedTicketIds.add(t.id);

        slot.plannedSeats.push({
          seatNo: seat.seat_no,
          ticketId: t.id,
          ticketNumber: t.ticket_number,
          displayTicketNumber: `No. ${t.ticket_number}`,
          gameName: t.game_name,
          gameId: t.game_id,
          expectedSlotId: t.expected_slot_id,
          expectedSlotTime: t.expected_slot_time,
          assignmentType: type,
        });
      }
    }

    const bufferSummary = getBufferSummary(dayId, nowMins);

    res.json({
      success: true,
      dayId,
      slots: slotList,
      meetingLeadMinutes,
      totalUnassignedCheckedIn: unassignedCheckedIn.length,
      bufferSummary,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// 「枠に割当」確定API（割当予定のチケットを一括確定）
// ==========================================
assignmentRouter.post('/api/assignment/fill-slot', (req: Request, res: Response) => {
  try {
    const { slotId } = req.body;
    if (!slotId) {
      res.status(400).json({ success: false, message: 'slotId is required' });
      return;
    }

    const activeDay = getActiveDay();
    const targetSlot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slotId) as any;
    if (!targetSlot) {
      res.status(404).json({ success: false, message: 'スロットが見つかりません' });
      return;
    }

    if (targetSlot.is_closed === 1) {
      res.status(400).json({ success: false, message: 'このスロットは既に確定・閉鎖済みです' });
      return;
    }

    if (targetSlot.is_maintenance === 1) {
      res.status(400).json({ success: false, message: 'このスロットはメンテナンス枠のため割当できません' });
      return;
    }

    const fillTx = db.transaction(() => {
      const emptySeats = db.prepare(`
        SELECT * FROM seat_reservations
        WHERE slot_id = ? AND (is_assigned = 0 OR status = 'empty')
        ORDER BY seat_no ASC
      `).all(slotId) as any[];

      const [sH, sM] = targetSlot.slot_time.split(':').map(Number);
      const slotMins = sH * 60 + sM;

      const closedSlots = db.prepare('SELECT id FROM slots WHERE day_id = ? AND is_closed = 1').all(activeDay) as any[];
      const closedSlotIds = new Set(closedSlots.map((s) => s.id));

      const unassignedTickets = db.prepare(`
        SELECT * FROM tickets
        WHERE day_id = ? AND status = 'checked_in' AND assigned_slot_id IS NULL
        ORDER BY ticket_number ASC
      `).all(activeDay) as any[];

      const candidates = unassignedTickets
        .map((t) => {
          let score = 99;
          const isClosedOriginal = t.expected_slot_id && closedSlotIds.has(t.expected_slot_id);
          let expMins: number | null = null;
          if (t.expected_slot_time) {
            const [eH, eM] = t.expected_slot_time.split(':').map(Number);
            expMins = eH * 60 + eM;
          }

          const isDelayed = isClosedOriginal || (expMins !== null && expMins < slotMins);
          const isCurrentSlot = t.expected_slot_id === slotId || (expMins !== null && expMins === slotMins);
          const isAdvance = expMins !== null && expMins > slotMins;

          if (targetSlot.is_buffer === 1) {
            if (isDelayed) score = 2;
            else if (isAdvance) score = 3;
            else score = 4;
          } else {
            if (isCurrentSlot) score = 1;
            else if (isDelayed) score = 2;
            else if (isAdvance) score = 3;
            else score = 4;
          }

          return { ticket: t, score };
        })
        .filter((c) => c.score < 99)
        .sort((a, b) => {
          if (a.score !== b.score) return a.score - b.score;
          // 遅刻者（score === 2）または早着者（score === 3）同士の場合、早く到着した順（checked_in_at 昇順）にする
          if ((a.score === 2 || a.score === 3) && a.score === b.score) {
            const timeA = a.ticket.checked_in_at ? new Date(a.ticket.checked_in_at).getTime() : 0;
            const timeB = b.ticket.checked_in_at ? new Date(b.ticket.checked_in_at).getTime() : 0;
            if (timeA !== timeB) {
              return timeA - timeB;
            }
          }
          return a.ticket.ticket_number - b.ticket.ticket_number;
        });

      const waitingTickets = candidates.slice(0, emptySeats.length).map((c) => c.ticket);

      const updateSeat = db.prepare(`
        UPDATE seat_reservations
        SET status = 'checked_in', is_assigned = 1, ticket_number = ?, game_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      const updateTicket = db.prepare(`
        UPDATE tickets
        SET status = 'assigned', assigned_slot_id = ?, assigned_seat_no = ?, assigned_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      for (let i = 0; i < waitingTickets.length; i++) {
        const t = waitingTickets[i];
        const s = emptySeats[i];
        updateSeat.run(t.ticket_number, t.game_id, s.id);
        updateTicket.run(slotId, s.seat_no, t.id);
      }

      db.prepare('UPDATE slots SET is_closed = 1 WHERE id = ?').run(slotId);

      const assignedSeats = db.prepare(`
        SELECT r.*, g.name AS game_name, g.command AS game_command
        FROM seat_reservations r
        LEFT JOIN games g ON r.game_id = g.id
        WHERE r.slot_id = ?
        ORDER BY r.seat_no ASC
      `).all(slotId);

      return { slot: targetSlot, seats: assignedSeats, assignedCount: waitingTickets.length };
    });

    const result = fillTx();

    broadcastUpdate({
      reason: 'slot_filled',
      slotId: targetSlot.id,
      dayId: activeDay,
    });

    res.json({
      success: true,
      assignedCount: result.assignedCount,
      message: `【${targetSlot.lane}組 ${targetSlot.slot_time}】に ${result.assignedCount} 名を割り当てました`,
      data: result,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// スロットの割当解除API（誤操作時の取消）
// ==========================================
assignmentRouter.post('/api/assignment/unfill-slot', (req: Request, res: Response) => {
  try {
    const { slotId } = req.body;
    if (!slotId) {
      res.status(400).json({ success: false, message: 'slotId is required' });
      return;
    }

    const activeDay = getActiveDay();
    const unfillTx = db.transaction(() => {
      db.prepare(`
        UPDATE tickets
        SET status = 'checked_in', assigned_slot_id = NULL, assigned_seat_no = NULL, assigned_at = NULL
        WHERE assigned_slot_id = ?
      `).run(slotId);

      db.prepare(`
        UPDATE seat_reservations
        SET status = 'empty', is_assigned = 0, ticket_number = NULL, game_id = NULL, note = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE slot_id = ?
      `).run(slotId);

      db.prepare('UPDATE slots SET is_closed = 0 WHERE id = ?').run(slotId);
    });

    unfillTx();

    broadcastUpdate({
      reason: 'slot_unfilled',
      slotId,
      dayId: activeDay,
    });

    res.json({ success: true, message: 'スロットの割当を解除しました' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// 座席振替 API
// ==========================================
assignmentRouter.post('/api/assignment/reassign', (req: Request, res: Response) => {
  try {
    const { sourceReservationId, targetReservationId } = req.body;
    if (!sourceReservationId || !targetReservationId) {
      res.status(400).json({ success: false, message: 'sourceReservationId and targetReservationId are required' });
      return;
    }

    const activeDay = getActiveDay();
    const reassignTx = db.transaction(() => {
      const sourceSeat = db.prepare('SELECT * FROM seat_reservations WHERE id = ?').get(sourceReservationId) as any;
      const targetSeat = db.prepare('SELECT * FROM seat_reservations WHERE id = ?').get(targetReservationId) as any;

      if (!sourceSeat || !targetSeat) {
        throw new Error('指定された座席が見つかりません');
      }

      if (targetSeat.is_assigned && targetSeat.status !== 'empty') {
        throw new Error('振替先の座席は既に埋まっています');
      }

      // 元の席の情報を移動
      db.prepare(`
        UPDATE seat_reservations
        SET status = 'checked_in',
            is_assigned = 1,
            ticket_number = ?,
            game_id = ?,
            assigned_ticket_code = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        sourceSeat.ticket_number,
        sourceSeat.game_id,
        sourceSeat.assigned_ticket_code || sourceSeat.ticket_code,
        targetSeat.id
      );

      // 元の席を空席に戻す
      db.prepare(`
        UPDATE seat_reservations
        SET status = 'empty',
            is_assigned = 0,
            ticket_number = NULL,
            game_id = NULL,
            assigned_ticket_code = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(sourceSeat.id);

      // チケットの assigned_slot_id, assigned_seat_no を更新
      if (sourceSeat.ticket_number) {
        const targetSlot = db.prepare('SELECT id FROM slots WHERE id = ?').get(targetSeat.slot_id) as any;
        db.prepare(`
          UPDATE tickets
          SET assigned_slot_id = ?, assigned_seat_no = ?
          WHERE day_id = ? AND ticket_number = ?
        `).run(targetSlot.id, targetSeat.seat_no, activeDay, sourceSeat.ticket_number);
      }
    });

    reassignTx();

    broadcastUpdate({
      reason: 'seat_reassigned',
      sourceReservationId,
      targetReservationId,
      dayId: activeDay,
    });

    res.json({ success: true, message: '座席の振替が完了しました' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// 座席キャンセル（欠席処理）API
// ==========================================
assignmentRouter.post('/api/assignment/cancel-reservation', (req: Request, res: Response) => {
  try {
    const { reservationId } = req.body;
    if (!reservationId) {
      res.status(400).json({ success: false, message: 'reservationId is required' });
      return;
    }

    const activeDay = getActiveDay();
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
          assigned_ticket_code = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(reservationId);

    broadcastUpdate({ reason: 'reservation_cancelled', reservationId, dayId: activeDay });
    res.json({ success: true, message: '座席の割当をキャンセルし、空席に戻しました' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// 室内準備モニター / 各席体験PC用監視 API
// ==========================================
assignmentRouter.get('/api/seat-status', (req: Request, res: Response) => {
  try {
    const lane = req.query.lane ? String(req.query.lane).toUpperCase() : null;
    const seat = req.query.seat ? parseInt(String(req.query.seat), 10) : null;
    const activeDay = getActiveDay();

    if (!lane || !seat) {
      res.status(400).json({ success: false, message: 'lane and seat query parameters are required' });
      return;
    }

    const targetSeat = db.prepare(`
      SELECT 
        r.id AS reservation_id,
        r.status,
        r.seat_no,
        r.ticket_number,
        r.ticket_code,
        s.slot_time,
        s.lane,
        g.name AS game_name,
        g.command AS game_command
      FROM seat_reservations r
      JOIN slots s ON r.slot_id = s.id
      LEFT JOIN games g ON r.game_id = g.id
      WHERE s.day_id = ? AND s.lane = ? AND r.seat_no = ? AND (s.is_closed = 1 OR r.is_assigned = 1) AND r.status != 'empty'
      ORDER BY s.order_idx DESC
      LIMIT 1
    `).get(activeDay, lane, seat) as any;

    if (targetSeat) {
      const displayCode = targetSeat.ticket_number ? `No. ${targetSeat.ticket_number}` : targetSeat.ticket_code;
      res.json({
        success: true,
        hasReservation: true,
        day: activeDay,
        lane: targetSeat.lane,
        seat: targetSeat.seat_no,
        slot_time: targetSeat.slot_time,
        ticket_code: displayCode,
        ticket_number: targetSeat.ticket_number || null,
        status: targetSeat.status,
        game_name: targetSeat.game_name || '未設定',
        game_command: targetSeat.game_command || '',
      });
      return;
    }

    res.json({
      success: true,
      hasReservation: false,
      day: activeDay,
      lane,
      seat,
      status: 'idle',
      game_name: '待機中',
      game_command: '',
      slot_time: '',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

