import { Router, type Request, type Response } from 'express';
import { db, getActiveDay, getMeetingLeadMinutes } from '../db.ts';
import { broadcastUpdate } from '../sse.ts';
import { confirmLateTickets, getBufferSummary, recomputeLatestTicketTimes } from '../services/waitStatus.ts';

export const assignmentRouter = Router();

// ==========================================
// 全スロットの確定状況と「割当予定」プレビュー取得
// ==========================================
assignmentRouter.get('/api/assignment/status', (req: Request, res: Response) => {
  try {
    const activeDay = getActiveDay();
    const dayId = req.query.day ? parseInt(String(req.query.day), 10) : activeDay;
    recomputeLatestTicketTimes(dayId);
    confirmLateTickets(dayId);
    recomputeLatestTicketTimes(dayId);

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
        s.is_maintenance AS slot_is_maintenance,
        s.is_closed,
        r.id AS reservation_id,
        r.seat_no,
        r.ticket_code,
        r.ticket_number,
        t.display_number,
        CASE 
          WHEN r.ticket_number IS NOT NULL AND r.priority_level = 2 THEN 'I' || printf('%03d', COALESCE(t.display_number, r.ticket_number))
          WHEN r.ticket_number IS NOT NULL AND r.priority_level = 1 THEN 'P' || printf('%03d', COALESCE(t.display_number, r.ticket_number))
          WHEN r.ticket_number IS NOT NULL THEN printf('No. %03d', COALESCE(t.display_number, r.ticket_number))
          WHEN r.assigned_ticket_code IS NOT NULL THEN r.assigned_ticket_code
          ELSE r.ticket_code
        END AS display_ticket_code,
        r.note,
        r.status,
        r.is_assigned,
        r.is_maintenance,
        r.priority_level,
        r.game_id,
        g.name AS game_name,
        g.command AS game_command
      FROM slots s
      LEFT JOIN seat_reservations r ON s.id = r.slot_id
      LEFT JOIN games g ON r.game_id = g.id
      LEFT JOIN tickets t ON t.day_id = s.day_id AND t.ticket_number = r.ticket_number
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
          is_maintenance: row.slot_is_maintenance === 1,
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
          is_maintenance: row.is_maintenance === 1,
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
    // ※調整枠（is_buffer = 1）は遅刻者を優先吸収する。
    //   前倒しが許可された早着者も調整枠へ割り当てる。
    // ※メンテナンス枠（is_maintenance = 1）は客を一切割り当てない
    const assignedTicketIds = new Set<number>();

    for (const slot of openSlots) {
      if (slot.is_maintenance) {
        slot.canFill = false;
        slot.plannedSeats = [];
        continue;
      }

      const emptySeats = slot.seats.filter((s: any) => !s.is_assigned && s.status === 'empty' && !s.is_maintenance);
      if (emptySeats.length === 0) continue;

      const [sH, sM] = slot.slot_time.split(':').map(Number);
      const slotMins = sH * 60 + sM;

      const candidates = unassignedCheckedIn
        .filter((t) => !assignedTicketIds.has(t.id))
        .map((t) => {
          let score = 99;
          let type: 'on_time' | 'delayed' | 'advanced' | 'buffer' | 'fill' = 'fill';

          let expMins: number | null = null;
          if (t.expected_slot_time) {
            const [eH, eM] = t.expected_slot_time.split(':').map(Number);
            expMins = eH * 60 + eM;
          }

          const isDelayed = t.is_late === 1;
          const isCurrentSlot = t.is_late !== 1 && (t.expected_slot_id === slot.id || (expMins !== null && expMins === slotMins));
          const earlyAcceptanceLimit = slotMins + (slot.duration_minutes || 0);
          const isAcceptedEarly = expMins !== null
            && expMins > slotMins
            && expMins <= earlyAcceptanceLimit;

          if (t.priority_level === 2 && !isDelayed && !slot.is_buffer) {
            score = 0;
            type = 'on_time';
          } else if (!slot.is_buffer && isCurrentSlot) {
            score = 1;
            type = 'on_time';
          } else if (slot.is_buffer) {
            if (isDelayed) {
              score = 2;
              type = 'delayed';
            } else if (isAcceptedEarly) {
              score = 3;
              type = 'advanced';
            } else {
              score = 99;
            }
          } else {
            if (isDelayed) {
              score = 2;
              type = 'delayed';
            } else if (isAcceptedEarly) {
              score = 3;
              type = 'advanced';
            } else {
              score = 99;
            }
          }

          return { ticket: t, score, type };
        })
        .filter((c) => c.score < 99)
        .sort((a, b) => {
          if (a.score !== b.score) return a.score - b.score;
          // 同じ優先度の候補は早く到着した順（checked_in_at 昇順）にする
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
          displayTicketNumber: t.priority_level === 2
            ? `I${String(t.display_number ?? t.ticket_number).padStart(3, '0')}`
            : t.priority_level === 1
              ? `P${String(t.display_number ?? t.ticket_number).padStart(3, '0')}`
              : `No. ${String(t.display_number ?? t.ticket_number).padStart(3, '0')}`,
          gameName: t.game_name,
          gameId: t.game_id,
          expectedSlotId: t.expected_slot_id,
          expectedSlotTime: t.expected_slot_time,
          originalExpectedSlotId: t.original_expected_slot_id,
          originalExpectedSlotTime: t.original_expected_slot_time,
          assignmentType: type,
          priorityLevel: t.priority_level || 0,
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
      db.prepare('UPDATE slots SET is_closed = 1 WHERE id = ?').run(slotId);
      broadcastUpdate({
        reason: 'maintenance_slot_closed',
        slotId: targetSlot.id,
        dayId: activeDay,
      });
      res.json({
        success: true,
        assignedCount: 0,
        message: `【${targetSlot.lane}組 ${targetSlot.slot_time}】をメンテナンス完了にしました`,
        data: { slot: targetSlot, seats: [], assignedCount: 0 },
      });
      return;
    }

    const fillTx = db.transaction(() => {
      const emptySeats = db.prepare(`
        SELECT * FROM seat_reservations
        WHERE slot_id = ? AND is_maintenance = 0 AND (is_assigned = 0 OR status = 'empty')
        ORDER BY seat_no ASC
      `).all(slotId) as any[];

      const [sH, sM] = targetSlot.slot_time.split(':').map(Number);
      const slotMins = sH * 60 + sM;

      // 枠を確定した時点で、最新の定刻がこの枠だった未到着者を遅刻確定する。
      // 本来時刻と最新時刻が同じ場合も、この対象に含める。
      db.prepare(`
        UPDATE tickets
        SET is_late = 1
        WHERE day_id = ? AND status = 'issued'
          AND assigned_slot_id IS NULL
          AND is_late = 0
          AND expected_slot_id = ?
      `).run(activeDay, slotId);

      const unassignedTickets = db.prepare(`
        SELECT * FROM tickets
        WHERE day_id = ? AND status = 'checked_in' AND assigned_slot_id IS NULL
        ORDER BY ticket_number ASC
      `).all(activeDay) as any[];

      const candidates = unassignedTickets
        .map((t) => {
          let score = 99;
          let expMins: number | null = null;
          if (t.expected_slot_time) {
            const [eH, eM] = t.expected_slot_time.split(':').map(Number);
            expMins = eH * 60 + eM;
          }

          const isDelayed = t.is_late === 1;
          const isCurrentSlot = t.is_late !== 1 && (t.expected_slot_id === slotId || (expMins !== null && expMins === slotMins));
          const earlyAcceptanceLimit = slotMins + (targetSlot.duration_minutes || 0);
          const isAcceptedEarly = expMins !== null
            && expMins > slotMins
            && expMins <= earlyAcceptanceLimit;

          if (t.priority_level === 2 && !isDelayed && targetSlot.is_buffer === 0) {
            score = 0;
          } else if (targetSlot.is_buffer === 1) {
            if (isDelayed) score = 2;
            else if (isAcceptedEarly) score = 3;
            else score = 99;
          } else {
            if (isCurrentSlot) score = 1;
            else if (isDelayed) score = 2;
            else if (isAcceptedEarly) score = 3;
            else score = 99;
          }

          return { ticket: t, score };
        })
        .filter((c) => c.score < 99)
        .sort((a, b) => {
          if (a.score !== b.score) return a.score - b.score;
          // 同じ優先度の候補は早く到着した順（checked_in_at 昇順）にする
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
        SET status = 'checked_in', is_assigned = 1, ticket_number = ?, priority_level = ?, game_id = ?, updated_at = CURRENT_TIMESTAMP
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
        updateSeat.run(t.ticket_number, t.priority_level || 0, t.game_id, s.id);
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
      WHERE s.day_id = ? AND s.lane = ? AND r.seat_no = ? AND r.is_maintenance = 0 AND (s.is_closed = 1 OR r.is_assigned = 1) AND r.status != 'empty'
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
