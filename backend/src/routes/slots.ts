import { Router, type Request, type Response } from 'express';
import { requireAdminAuth } from '../auth.ts';
import { db, getActiveDay } from '../db.ts';
import { broadcastUpdate } from '../sse.ts';

export const slotsRouter = Router();

// ==========================================
// スロット一括初期化生成（開始・終了時刻または枠数指定）
// ==========================================
slotsRouter.post('/api/slots/generate', requireAdminAuth, (req: Request, res: Response) => {
  try {
    const {
      day = null,
      startHour = 10,
      startMinute = 0,
      endHour = null,
      endMinute = null,
      count = null,
      seatsPerSlot = 6,
      bufferInterval = 0,
      bufferDuration = 3,
      // 任意レーン & 拘束/入替パラメータ
      lanes: inputLanes = null,
      playDuration = 5,
      cleanupDuration = 2,
      laneOffset = null,
      // 互換パラメータ
      pitchMinutes = 3,
      pitchMinutesA = null,
      pitchMinutesB = null,
    } = req.body;

    const dayId = day ? parseInt(String(day), 10) : getActiveDay();
    const interval = parseInt(String(bufferInterval), 10) || 0;
    const seats = parseInt(String(seatsPerSlot), 10) || 6;
    const bufDur = parseInt(String(bufferDuration), 10) || 3;

    // レーンリストの正規化
    let lanes: string[] = ['A', 'B'];
    if (Array.isArray(inputLanes) && inputLanes.length > 0) {
      lanes = inputLanes.map(l => String(l).trim().toUpperCase()).filter(Boolean);
    } else if (typeof inputLanes === 'string' && inputLanes.trim().length > 0) {
      lanes = inputLanes.split(',').map(l => l.trim().toUpperCase()).filter(Boolean);
    }
    if (lanes.length === 0) lanes = ['A', 'B'];

    const playDur = parseInt(String(playDuration), 10) || 5;
    const cleanDur = parseInt(String(cleanupDuration), 10) || 2;
    const laneCycle = playDur + cleanDur;

    const hasLegacyPitch = !inputLanes && (
      pitchMinutesA !== null ||
      pitchMinutesB !== null ||
      (pitchMinutes !== null && pitchMinutes !== undefined && pitchMinutes !== 3)
    );

    let offset: number;
    let isLegacyPitch = false;
    let durA = 3;
    let durB = 4;

    if (hasLegacyPitch) {
      isLegacyPitch = true;
      durA = pitchMinutesA !== null ? (parseInt(String(pitchMinutesA), 10) || 3) : (parseInt(String(pitchMinutes), 10) || 3);
      durB = pitchMinutesB !== null ? (parseInt(String(pitchMinutesB), 10) || 4) : 7 - durA;
      offset = durA;
    } else if (laneOffset !== null && laneOffset !== undefined && laneOffset !== '') {
      offset = parseInt(String(laneOffset), 10) || 0;
    } else {
      offset = Math.floor(laneCycle / lanes.length);
    }

    const avgDur = isLegacyPitch
      ? (durA + durB) / 2
      : (lanes.length > 1 ? laneCycle / lanes.length : laneCycle);

    const sH = Number(startHour);
    const sM = Number(startMinute);
    const startTotal = sH * 60 + sM;

    let slotCount = 10;
    if (endHour !== null && endMinute !== null && endHour !== '' && endMinute !== '') {
      const eH = Number(endHour);
      const eM = Number(endMinute);
      const endTotal = eH * 60 + eM;
      if (endTotal > startTotal) {
        slotCount = Math.floor((endTotal - startTotal) / avgDur);
      }
    } else if (count !== null && count !== '') {
      slotCount = parseInt(String(count), 10);
    }

    if (slotCount <= 0) slotCount = 1;

    const generateTransaction = db.transaction(() => {
      db.prepare('DELETE FROM slots WHERE day_id = ?').run(dayId);

      const insertSlot = db.prepare(`
        INSERT INTO slots (day_id, order_idx, slot_time, lane, duration_minutes, play_duration, cleanup_duration, is_buffer, is_closed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      `);

      const insertReservation = db.prepare(`
        INSERT INTO seat_reservations (slot_id, seat_no, ticket_code, status)
        VALUES (?, ?, ?, 'empty')
      `);

      let curMins = startTotal;
      const L = lanes.length;

      for (let i = 0; i < slotCount; i++) {
        const orderIdx = i;
        const lIdx = i % L;
        const lane = lanes[lIdx];

        const hours = Math.floor(curMins / 60) % 24;
        const mins = curMins % 60;
        const hh = String(hours).padStart(2, '0');
        const mm = String(mins).padStart(2, '0');
        const slotTime = `${hh}:${mm}`;

        const isBuffer = interval > 0 && (i + 1) % interval === 0 ? 1 : 0;
        let dur: number;
        if (isBuffer) {
          dur = bufDur;
        } else if (isLegacyPitch) {
          dur = lane === 'A' ? durA : durB;
        } else {
          dur = (L > 1 && lIdx < L - 1) ? offset : Math.max(1, laneCycle - (L - 1) * offset);
        }

        const result = insertSlot.run(dayId, orderIdx, slotTime, lane, dur, playDur, cleanDur, isBuffer);
        const slotId = result.lastInsertRowid;

        for (let seat = 1; seat <= seats; seat++) {
          const ticketCode = dayId > 1 ? `D${dayId}-${lane}${hh}${mm}-${seat}` : `${lane}${hh}${mm}-${seat}`;
          insertReservation.run(slotId, seat, ticketCode);
        }

        curMins += dur;
      }
    });

    generateTransaction();
    broadcastUpdate({ reason: 'slots_generated', dayId });
    res.json({ success: true, message: `Day ${dayId} にスロットを ${slotCount} 枠生成しました` });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// スロット再調整・追加生成 (Adjust)
// ==========================================
slotsRouter.post(['/api/slots/adjust', '/api/slots/adjust-from'], requireAdminAuth, (req: Request, res: Response) => {
  try {
    const {
      day = null,
      fromSlotId = null,
      appendOnly = false,
      startHour,
      startMinute,
      endHour = null,
      endMinute = null,
      count = null,
      seatsPerSlot = 6,
      bufferInterval = 0,
      bufferDuration = 3,
      lanes: inputLanes = null,
      playDuration = 5,
      cleanupDuration = 2,
      laneOffset = null,
      pitchMinutes = 3,
      pitchMinutesA = null,
      pitchMinutesB = null,
    } = req.body;

    const dayId = day ? parseInt(String(day), 10) : getActiveDay();
    const interval = parseInt(String(bufferInterval), 10) || 0;
    const seats = parseInt(String(seatsPerSlot), 10) || 6;
    const bufDur = parseInt(String(bufferDuration), 10) || 3;

    let lanes: string[] = ['A', 'B'];
    if (Array.isArray(inputLanes) && inputLanes.length > 0) {
      lanes = inputLanes.map(l => String(l).trim().toUpperCase()).filter(Boolean);
    } else if (typeof inputLanes === 'string' && inputLanes.trim().length > 0) {
      lanes = inputLanes.split(',').map(l => l.trim().toUpperCase()).filter(Boolean);
    }
    if (lanes.length === 0) lanes = ['A', 'B'];

    const playDur = parseInt(String(playDuration), 10) || 5;
    const cleanDur = parseInt(String(cleanupDuration), 10) || 2;
    const laneCycle = playDur + cleanDur;

    const hasLegacyPitch = !inputLanes && (
      pitchMinutesA !== null ||
      pitchMinutesB !== null ||
      (pitchMinutes !== null && pitchMinutes !== undefined && pitchMinutes !== 3)
    );

    let offset: number;
    let isLegacyPitch = false;
    let durA = 3;
    let durB = 4;

    if (hasLegacyPitch) {
      isLegacyPitch = true;
      durA = pitchMinutesA !== null ? (parseInt(String(pitchMinutesA), 10) || 3) : (parseInt(String(pitchMinutes), 10) || 3);
      durB = pitchMinutesB !== null ? (parseInt(String(pitchMinutesB), 10) || 4) : 7 - durA;
      offset = durA;
    } else if (laneOffset !== null && laneOffset !== undefined && laneOffset !== '') {
      offset = parseInt(String(laneOffset), 10) || 0;
    } else {
      offset = Math.floor(laneCycle / lanes.length);
    }

    const avgDur = isLegacyPitch
      ? (durA + durB) / 2
      : (lanes.length > 1 ? laneCycle / lanes.length : laneCycle);

    const adjustTransaction = db.transaction(() => {
      let baseOrderIdx = 0;
      let lastLaneIdx = -1;
      let currentTotalMinutes: number;

      if (fromSlotId && !appendOnly) {
        const baseSlot = db.prepare('SELECT * FROM slots WHERE id = ? AND day_id = ?').get(fromSlotId, dayId) as any;
        if (!baseSlot) {
          throw new Error('指定された起点スロットが見つかりません');
        }
        baseOrderIdx = baseSlot.order_idx;

        const prevSlot = db.prepare('SELECT lane FROM slots WHERE day_id = ? AND order_idx < ? ORDER BY order_idx DESC LIMIT 1').get(dayId, baseOrderIdx) as any;
        if (prevSlot) {
          lastLaneIdx = lanes.indexOf(prevSlot.lane);
        }

        db.prepare('DELETE FROM slots WHERE day_id = ? AND order_idx >= ?').run(dayId, baseOrderIdx);
      } else if (appendOnly) {
        const lastSlot = db.prepare('SELECT * FROM slots WHERE day_id = ? ORDER BY order_idx DESC LIMIT 1').get(dayId) as any;
        if (lastSlot) {
          baseOrderIdx = lastSlot.order_idx + 1;
          lastLaneIdx = lanes.indexOf(lastSlot.lane);
        }
      }

      if (startHour !== undefined && startMinute !== undefined && startHour !== '' && startMinute !== '') {
        currentTotalMinutes = Number(startHour) * 60 + Number(startMinute);
      } else {
        const prevSlot = db.prepare('SELECT slot_time, duration_minutes FROM slots WHERE day_id = ? ORDER BY order_idx DESC LIMIT 1').get(dayId) as any;
        if (prevSlot) {
          const [ph, pm] = prevSlot.slot_time.split(':').map(Number);
          const pDur = prevSlot.duration_minutes || 3;
          currentTotalMinutes = ph * 60 + pm + pDur;
        } else {
          currentTotalMinutes = 10 * 60;
        }
      }

      let slotCount = 10;
      if (endHour !== null && endMinute !== null && endHour !== '' && endMinute !== '') {
        const endTotal = Number(endHour) * 60 + Number(endMinute);
        if (endTotal > currentTotalMinutes) {
          slotCount = Math.floor((endTotal - currentTotalMinutes) / avgDur);
        }
      } else if (count !== null && count !== '') {
        slotCount = parseInt(String(count), 10);
      }

      if (slotCount <= 0) slotCount = 1;

      const insertSlot = db.prepare(`
        INSERT INTO slots (day_id, order_idx, slot_time, lane, duration_minutes, play_duration, cleanup_duration, is_buffer, is_closed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      `);

      const insertReservation = db.prepare(`
        INSERT INTO seat_reservations (slot_id, seat_no, ticket_code, status)
        VALUES (?, ?, ?, 'empty')
      `);

      let curMins = currentTotalMinutes;
      const L = lanes.length;

      for (let i = 0; i < slotCount; i++) {
        const orderIdx = baseOrderIdx + i;
        const lIdx = (lastLaneIdx + 1 + i) % L;
        const lane = lanes[lIdx];

        const hours = Math.floor(curMins / 60) % 24;
        const mins = curMins % 60;
        const hh = String(hours).padStart(2, '0');
        const mm = String(mins).padStart(2, '0');
        const slotTime = `${hh}:${mm}`;

        const isBuffer = interval > 0 && (i + 1) % interval === 0 ? 1 : 0;
        let dur: number;
        if (isBuffer) {
          dur = bufDur;
        } else if (isLegacyPitch) {
          dur = lane === 'A' ? durA : durB;
        } else {
          dur = (L > 1 && lIdx < L - 1) ? offset : Math.max(1, laneCycle - (L - 1) * offset);
        }

        const result = insertSlot.run(dayId, orderIdx, slotTime, lane, dur, playDur, cleanDur, isBuffer);
        const slotId = result.lastInsertRowid;

        for (let seat = 1; seat <= seats; seat++) {
          const ticketCode = dayId > 1 ? `D${dayId}-${lane}${hh}${mm}-${seat}` : `${lane}${hh}${mm}-${seat}`;
          insertReservation.run(slotId, seat, ticketCode);
        }

        curMins += dur;
      }
    });

    adjustTransaction();
    broadcastUpdate({ reason: 'slots_adjusted', dayId });
    res.json({ success: true, message: `Day ${dayId} のスロットを調整・生成しました` });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// スロット個別更新API（時間・所要時間・レーン変更）
// ==========================================
function handleUpdateSlot(req: Request, res: Response): void {
  try {
    const { slotId, durationMinutes, playDuration, cleanupDuration, lane, slotTime } = req.body;
    if (!slotId) {
      res.status(400).json({ success: false, message: 'slotId is required' });
      return;
    }

    const targetSlot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slotId) as any;
    if (!targetSlot) {
      res.status(404).json({ success: false, message: '指定されたスロットが見つかりません' });
      return;
    }

    const newDur = durationMinutes !== undefined ? (parseInt(String(durationMinutes), 10) || 3) : targetSlot.duration_minutes;
    const newPlayDur = playDuration !== undefined ? (parseInt(String(playDuration), 10) || 5) : (targetSlot.play_duration || 5);
    const newCleanDur = cleanupDuration !== undefined ? (parseInt(String(cleanupDuration), 10) || 2) : (targetSlot.cleanup_duration ?? 2);
    const newLane = lane ? String(lane).trim().toUpperCase() : targetSlot.lane;
    const newSlotTime = slotTime || targetSlot.slot_time;

    const updateTransaction = db.transaction(() => {
      db.prepare(`
        UPDATE slots 
        SET duration_minutes = ?, play_duration = ?, cleanup_duration = ?, lane = ?, slot_time = ?
        WHERE id = ?
      `).run(newDur, newPlayDur, newCleanDur, newLane, newSlotTime, targetSlot.id);

      const updateTicket = db.prepare('UPDATE seat_reservations SET ticket_code = ? WHERE id = ?');
      const seats = db.prepare('SELECT id, seat_no FROM seat_reservations WHERE slot_id = ?').all(targetSlot.id) as any[];
      const [thh, tmm] = newSlotTime.split(':');
      for (const seat of seats) {
        const newCode = targetSlot.day_id > 1 ? `D${targetSlot.day_id}-${newLane}${thh}${tmm}-${seat.seat_no}` : `${newLane}${thh}${tmm}-${seat.seat_no}`;
        updateTicket.run(newCode, seat.id);
      }

      const followingSlots = db.prepare(`
        SELECT * FROM slots 
        WHERE day_id = ? AND order_idx >= ? 
        ORDER BY order_idx ASC
      `).all(targetSlot.day_id, targetSlot.order_idx) as any[];

      if (followingSlots.length > 0) {
        let [curH, curM] = followingSlots[0].slot_time.split(':').map(Number);
        let curTotal = curH * 60 + curM;

        const updateSlotTime = db.prepare('UPDATE slots SET slot_time = ? WHERE id = ?');

        for (let i = 0; i < followingSlots.length; i++) {
          const s = followingSlots[i];
          const sDur = (s.id === targetSlot.id) ? newDur : (s.duration_minutes || 3);
          const sLane = (s.id === targetSlot.id) ? newLane : s.lane;

          if (i > 0) {
            const h = Math.floor(curTotal / 60) % 24;
            const m = curTotal % 60;
            const hh = String(h).padStart(2, '0');
            const mm = String(m).padStart(2, '0');
            const slotTime = `${hh}:${mm}`;

            updateSlotTime.run(slotTime, s.id);

            const seats = db.prepare('SELECT id, seat_no FROM seat_reservations WHERE slot_id = ?').all(s.id) as any[];
            for (const seat of seats) {
              const newCode = s.day_id > 1 ? `D${s.day_id}-${sLane}${hh}${mm}-${seat.seat_no}` : `${sLane}${hh}${mm}-${seat.seat_no}`;
              updateTicket.run(newCode, seat.id);
            }
          }

          curTotal += sDur;
        }
      }
    });

    updateTransaction();
    broadcastUpdate({ reason: 'slot_updated', slotId: targetSlot.id, dayId: targetSlot.day_id });
    res.json({ success: true, message: `スロット設定を更新し、以降のスケジュールを自動調整しました` });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

slotsRouter.post('/api/slots/update-slot', requireAdminAuth, handleUpdateSlot);
slotsRouter.post('/api/slots/update-duration', requireAdminAuth, handleUpdateSlot);

// ==========================================
// 一括遅延シフト API
// ==========================================
slotsRouter.post('/api/slots/shift-delay', requireAdminAuth, (req: Request, res: Response) => {
  try {
    const { fromSlotId, shiftMinutes = 3 } = req.body;
    if (!fromSlotId) {
      res.status(400).json({ success: false, message: 'fromSlotId is required' });
      return;
    }

    const shift = parseInt(String(shiftMinutes), 10) || 0;
    if (shift === 0) {
      res.json({ success: true, message: 'シフト時間0のため変更なし' });
      return;
    }

    const shiftTransaction = db.transaction(() => {
      const baseSlot = db.prepare('SELECT * FROM slots WHERE id = ?').get(fromSlotId) as any;
      if (!baseSlot) {
        throw new Error('指定されたスロットが見つかりません');
      }

      const targetSlots = db.prepare('SELECT * FROM slots WHERE day_id = ? AND order_idx >= ? ORDER BY order_idx ASC').all(baseSlot.day_id, baseSlot.order_idx) as any[];

      const updateSlot = db.prepare('UPDATE slots SET slot_time = ? WHERE id = ?');
      const updateExpectedTime = db.prepare(`
        UPDATE tickets
        SET expected_slot_time = ?
        WHERE expected_slot_id = ? AND status != 'cancelled'
      `);
      const updateTicket = db.prepare('UPDATE seat_reservations SET ticket_code = ? WHERE id = ?');

      for (const slot of targetSlots) {
        const [h, m] = slot.slot_time.split(':').map(Number);
        const newTotal = (h * 60 + m + shift + 1440) % 1440;
        const newH = Math.floor(newTotal / 60);
        const newM = newTotal % 60;
        const newHh = String(newH).padStart(2, '0');
        const newMm = String(newM).padStart(2, '0');
        const newSlotTime = `${newHh}:${newMm}`;

        updateSlot.run(newSlotTime, slot.id);
        updateExpectedTime.run(newSlotTime, slot.id);

        const seats = db.prepare('SELECT id, seat_no FROM seat_reservations WHERE slot_id = ?').all(slot.id) as any[];
        for (const seat of seats) {
          const newCode = slot.day_id > 1 ? `D${slot.day_id}-${slot.lane}${newHh}${newMm}-${seat.seat_no}` : `${slot.lane}${newHh}${newMm}-${seat.seat_no}`;
          updateTicket.run(newCode, seat.id);
        }
      }
    });

    shiftTransaction();
    broadcastUpdate({ reason: 'slots_shifted' });
    res.json({ success: true, message: `指定スロット以降を ${shift > 0 ? `+${shift}` : shift} 分シフトしました` });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// 調整枠切替 API
// ==========================================
slotsRouter.post('/api/slots/toggle-buffer', requireAdminAuth, (req: Request, res: Response) => {
  try {
    const { slotId } = req.body;
    if (!slotId) {
      res.status(400).json({ success: false, message: 'slotId is required' });
      return;
    }

    const current = db.prepare('SELECT is_buffer, is_maintenance FROM slots WHERE id = ?').get(slotId) as any;
    if (!current) {
      res.status(404).json({ success: false, message: 'スロットが見つかりません' });
      return;
    }

    const nextBuffer = current.is_buffer === 1 ? 0 : 1;
    // 調整枠化する場合、メンテナンス枠指定は解除
    const nextMaintenance = nextBuffer === 1 ? 0 : current.is_maintenance;
    db.prepare('UPDATE slots SET is_buffer = ?, is_maintenance = ? WHERE id = ?').run(nextBuffer, nextMaintenance, slotId);

    broadcastUpdate({ reason: 'slot_buffer_toggled', slotId, is_buffer: nextBuffer === 1, is_maintenance: nextMaintenance === 1 });
    res.json({ success: true, is_buffer: nextBuffer === 1, is_maintenance: nextMaintenance === 1 });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// メンテナンス枠切替 API
// ==========================================
slotsRouter.post('/api/slots/toggle-maintenance', requireAdminAuth, (req: Request, res: Response) => {
  try {
    const { slotId } = req.body;
    if (!slotId) {
      res.status(400).json({ success: false, message: 'slotId is required' });
      return;
    }

    const current = db.prepare('SELECT is_buffer, is_maintenance FROM slots WHERE id = ?').get(slotId) as any;
    if (!current) {
      res.status(404).json({ success: false, message: 'スロットが見つかりません' });
      return;
    }

    const nextMaint = current.is_maintenance === 1 ? 0 : 1;
    // メンテナンス枠化する場合、調整枠フラグはクリア
    const nextBuffer = nextMaint === 1 ? 0 : current.is_buffer;
    db.prepare('UPDATE slots SET is_maintenance = ?, is_buffer = ? WHERE id = ?').run(nextMaint, nextBuffer, slotId);

    broadcastUpdate({ reason: 'slot_maintenance_toggled', slotId, is_maintenance: nextMaint === 1, is_buffer: nextBuffer === 1 });
    res.json({ success: true, is_maintenance: nextMaint === 1, is_buffer: nextBuffer === 1 });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// タイムライン取得 API
// ==========================================
slotsRouter.get('/api/timeline', (req: Request, res: Response) => {
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
        r.display_ticket_code,
        r.note,
        r.status,
        r.is_assigned,
        r.assigned_ticket_code,
        r.assigned_at,
        g.id AS game_id,
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
          cleanup_duration: row.cleanup_duration !== undefined ? row.cleanup_duration : 2,
          is_buffer: row.is_buffer === 1,
          is_maintenance: row.is_maintenance === 1,
          is_closed: row.is_closed === 1,
          seats: [],
        });
      }

      if (row.reservation_id) {
        const slot = slotsMap.get(row.slot_id);
        slot.seats.push({
          id: row.reservation_id,
          seat_no: row.seat_no,
          ticket_code: row.ticket_code,
          ticket_number: row.ticket_number,
          display_ticket_code: row.display_ticket_code,
          note: row.note,
          status: row.status,
          is_assigned: row.is_assigned === 1,
          assigned_ticket_code: row.assigned_ticket_code,
          assigned_at: row.assigned_at,
          game_id: row.game_id,
          game_name: row.game_name,
          game_command: row.game_command,
        });
      }
    }

    const timeline = Array.from(slotsMap.values());
    res.json({ success: true, dayId, timeline });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// 案内締め切り＆未着保留＆繰り上げ API
// ==========================================
slotsRouter.post('/api/slots/close', (req: Request, res: Response) => {
  try {
    const { slotId } = req.body;
    if (!slotId) {
      res.status(400).json({ success: false, message: 'slotId is required' });
      return;
    }

    const currentSlot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slotId) as any;
    if (!currentSlot) {
      res.status(404).json({ success: false, message: 'Slot not found' });
      return;
    }

    const closeTransaction = db.transaction(() => {
      db.prepare('UPDATE slots SET is_closed = 1 WHERE id = ?').run(slotId);

      const unarrivedSeats = db.prepare(`
        SELECT r.*, g.name AS game_name 
        FROM seat_reservations r
        LEFT JOIN games g ON r.game_id = g.id
        WHERE r.slot_id = ? AND r.status = 'booked'
      `).all(slotId) as any[];

      const insertLate = db.prepare(`
        INSERT INTO late_queue (day_id, original_ticket_code, original_slot_time, lane, seat_no, game_id, status)
        VALUES (?, ?, ?, ?, ?, ?, 'waiting')
      `);

      for (const seat of unarrivedSeats) {
        insertLate.run(currentSlot.day_id, seat.ticket_code, currentSlot.slot_time, currentSlot.lane, seat.seat_no, seat.game_id);
        db.prepare(`
          UPDATE seat_reservations
          SET status = 'empty', game_id = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(seat.id);
      }

      const availableSeats = db.prepare(`
        SELECT id, seat_no, ticket_code
        FROM seat_reservations
        WHERE slot_id = ? AND status = 'empty'
        ORDER BY seat_no ASC
      `).all(slotId) as any[];

      const checkedInCandidates = db.prepare(`
        SELECT r.id, r.ticket_code, r.game_id, s.slot_time, s.lane, s.order_idx, g.name AS game_name
        FROM seat_reservations r
        JOIN slots s ON r.slot_id = s.id
        LEFT JOIN games g ON r.game_id = g.id
        WHERE s.day_id = ? AND s.order_idx > ? AND r.status = 'checked_in'
        ORDER BY s.order_idx ASC, r.seat_no ASC
        LIMIT ?
      `).all(currentSlot.day_id, currentSlot.order_idx, availableSeats.length) as any[];

      const bumpedList: any[] = [];

      for (let i = 0; i < checkedInCandidates.length; i++) {
        const targetEmptySeat = availableSeats[i];
        const candidate = checkedInCandidates[i];

        db.prepare(`
          UPDATE seat_reservations
          SET status = 'checked_in', game_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(candidate.game_id, targetEmptySeat.id);

        db.prepare(`
          UPDATE seat_reservations
          SET status = 'empty', game_id = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(candidate.id);

        bumpedList.push({
          fromSlotTime: candidate.slot_time,
          fromLane: candidate.lane,
          fromTicketCode: candidate.ticket_code,
          toSlotTime: currentSlot.slot_time,
          toLane: currentSlot.lane,
          toSeatNo: targetEmptySeat.seat_no,
          toTicketCode: targetEmptySeat.ticket_code,
          gameName: candidate.game_name,
        });
      }

      return {
        slotId,
        slotTime: currentSlot.slot_time,
        lane: currentSlot.lane,
        lateCount: unarrivedSeats.length,
        bumpedCount: bumpedList.length,
        bumpedList,
      };
    });

    const result = closeTransaction();
    broadcastUpdate({ reason: 'slot_closed', result });
    res.json({ success: true, result });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});
