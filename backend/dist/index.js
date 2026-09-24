import express, {} from 'express';
import { db, initDatabase, getActiveDay, setActiveDay, getMaxWaitMinutes, setMaxWaitMinutes } from './db.ts';
import { registerSSEClient, broadcastUpdate } from './sse.ts';
initDatabase();
const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
// CORS ミドルウェア
app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (_req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
    }
    next();
});
app.use(express.json());
// ==========================================
// 設定 API (日程 & 最大許容待ち時間)
// ==========================================
app.get('/api/settings', (_req, res) => {
    try {
        const activeDay = getActiveDay();
        const maxWaitMinutes = getMaxWaitMinutes();
        res.json({ success: true, activeDay, maxWaitMinutes });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
app.post('/api/settings/max-wait', (req, res) => {
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
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// ==========================================
// 日程管理 (Day 1 / Day 2) API
// ==========================================
app.get('/api/day/current', (_req, res) => {
    try {
        const activeDay = getActiveDay();
        res.json({ success: true, activeDay });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
app.post('/api/day/switch', (req, res) => {
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
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// ==========================================
// ゲームマスタ API（2日間共通共有マスタ）
// ==========================================
app.get('/api/games', (_req, res) => {
    try {
        const games = db.prepare('SELECT * FROM games ORDER BY id ASC').all();
        res.json({ success: true, games });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
app.post('/api/games', (req, res) => {
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
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
app.post('/api/games/delete', (req, res) => {
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
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// ==========================================
// スロット生成・スケジュール調整 API
// ==========================================
// スロット一括初期化生成（開始・終了時刻または枠数指定）
app.post('/api/slots/generate', (req, res) => {
    try {
        const { day = null, startHour = 10, startMinute = 0, endHour = null, endMinute = null, count = null, seatsPerSlot = 6, bufferInterval = 0, bufferDuration = 3, 
        // 任意レーン & 拘束/入替パラメータ
        lanes: inputLanes = null, playDuration = 5, cleanupDuration = 2, laneOffset = null, 
        // 互換パラメータ
        pitchMinutes = 3, pitchMinutesA = null, pitchMinutesB = null, } = req.body;
        const dayId = day ? parseInt(String(day), 10) : getActiveDay();
        const interval = parseInt(String(bufferInterval), 10) || 0;
        const seats = parseInt(String(seatsPerSlot), 10) || 6;
        const bufDur = parseInt(String(bufferDuration), 10) || 3;
        // レーンリストの正規化
        let lanes = ['A', 'B'];
        if (Array.isArray(inputLanes) && inputLanes.length > 0) {
            lanes = inputLanes.map(l => String(l).trim().toUpperCase()).filter(Boolean);
        }
        else if (typeof inputLanes === 'string' && inputLanes.trim().length > 0) {
            lanes = inputLanes.split(',').map(l => l.trim().toUpperCase()).filter(Boolean);
        }
        if (lanes.length === 0)
            lanes = ['A', 'B'];
        const playDur = parseInt(String(playDuration), 10) || 5;
        const cleanDur = parseInt(String(cleanupDuration), 10) || 2;
        const laneCycle = playDur + cleanDur;
        const hasLegacyPitch = !inputLanes && (pitchMinutesA !== null ||
            pitchMinutesB !== null ||
            (req.body.pitchMinutes !== undefined && req.body.pitchMinutes !== null));
        const isLegacyPitch = hasLegacyPitch;
        let durA = 3;
        let durB = 3;
        let avgDur = 3;
        let offset = 3;
        if (isLegacyPitch) {
            const pDefault = parseInt(String(pitchMinutes), 10) || 3;
            durA = pitchMinutesA !== null ? (parseInt(String(pitchMinutesA), 10) || pDefault) : pDefault;
            durB = pitchMinutesB !== null ? (parseInt(String(pitchMinutesB), 10) || pDefault) : pDefault;
            avgDur = (durA + durB) / 2;
            lanes = ['A', 'B'];
        }
        else {
            if (laneOffset !== null && laneOffset !== undefined && laneOffset !== '') {
                offset = parseInt(String(laneOffset), 10);
            }
            else {
                offset = lanes.length > 1 ? Math.max(1, Math.floor(laneCycle / lanes.length)) : laneCycle;
            }
            avgDur = laneCycle / lanes.length;
        }
        let startTotal = Number(startHour) * 60 + Number(startMinute);
        let totalSlots = 20;
        if (endHour !== null && endMinute !== null && endHour !== '' && endMinute !== '') {
            const endTotal = Number(endHour) * 60 + Number(endMinute);
            if (endTotal > startTotal) {
                totalSlots = Math.floor((endTotal - startTotal) / avgDur);
            }
        }
        else if (count !== null && count !== '') {
            totalSlots = parseInt(String(count), 10);
        }
        if (totalSlots <= 0)
            totalSlots = 1;
        const generateTransaction = db.transaction(() => {
            db.prepare('DELETE FROM slots WHERE day_id = ?').run(dayId);
            db.prepare('DELETE FROM late_queue WHERE day_id = ?').run(dayId);
            const insertSlot = db.prepare(`
        INSERT INTO slots (day_id, order_idx, slot_time, lane, duration_minutes, play_duration, cleanup_duration, is_buffer, is_closed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      `);
            const insertReservation = db.prepare(`
        INSERT INTO seat_reservations (slot_id, seat_no, ticket_code, status)
        VALUES (?, ?, ?, 'empty')
      `);
            const slotTimes = [];
            if (isLegacyPitch) {
                let cur = startTotal;
                for (let i = 0; i < totalSlots; i++) {
                    const lane = i % 2 === 0 ? 'A' : 'B';
                    const h = Math.floor(cur / 60) % 24;
                    const m = cur % 60;
                    slotTimes.push({ slotTime: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, totalMins: cur, lane });
                    cur += (lane === 'A' ? durA : durB);
                }
            }
            else {
                const L = lanes.length;
                for (let i = 0; i < totalSlots; i++) {
                    const lIdx = i % L;
                    const cycle = Math.floor(i / L);
                    const lane = lanes[lIdx];
                    const cur = startTotal + cycle * laneCycle + lIdx * offset;
                    const h = Math.floor(cur / 60) % 24;
                    const m = cur % 60;
                    slotTimes.push({ slotTime: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, totalMins: cur, lane });
                }
            }
            for (let i = 0; i < totalSlots; i++) {
                const st = slotTimes[i];
                const isBuffer = interval > 0 && (i + 1) % interval === 0 ? 1 : 0;
                let dur;
                if (isBuffer) {
                    dur = bufDur;
                }
                else if (i < totalSlots - 1) {
                    dur = Math.max(1, slotTimes[i + 1].totalMins - st.totalMins);
                }
                else {
                    dur = Math.max(1, Math.round(avgDur));
                }
                const result = insertSlot.run(dayId, i, st.slotTime, st.lane, dur, playDur, cleanDur, isBuffer);
                const slotId = result.lastInsertRowid;
                const [hh, mm] = st.slotTime.split(':');
                for (let seat = 1; seat <= seats; seat++) {
                    const ticketCode = `${st.lane}${hh}${mm}-${seat}`;
                    insertReservation.run(slotId, seat, ticketCode);
                }
            }
        });
        generateTransaction();
        broadcastUpdate({ reason: 'slots_generated', dayId });
        res.json({ success: true, message: `Day ${dayId} に ${totalSlots} 枠（レーン: ${lanes.join(', ')}）を生成しました`, count: totalSlots });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// ある時点以降のスロット再調整・追加
app.post('/api/slots/adjust-from', (req, res) => {
    try {
        const { day = null, fromSlotId = null, startHour, startMinute, endHour = null, endMinute = null, count = null, seatsPerSlot = 6, bufferInterval = 0, bufferDuration = 3, 
        // 任意レーン & 拘束/入替パラメータ
        lanes: inputLanes = null, playDuration = 5, cleanupDuration = 2, laneOffset = null, appendOnly = false, 
        // 互換パラメータ
        pitchMinutes = 3, pitchMinutesA = null, pitchMinutesB = null, } = req.body;
        const dayId = day ? parseInt(String(day), 10) : getActiveDay();
        const interval = parseInt(String(bufferInterval), 10) || 0;
        const seats = parseInt(String(seatsPerSlot), 10) || 6;
        const bufDur = parseInt(String(bufferDuration), 10) || 3;
        let lanes = ['A', 'B'];
        if (Array.isArray(inputLanes) && inputLanes.length > 0) {
            lanes = inputLanes.map(l => String(l).trim().toUpperCase()).filter(Boolean);
        }
        else if (typeof inputLanes === 'string' && inputLanes.trim().length > 0) {
            lanes = inputLanes.split(',').map(l => l.trim().toUpperCase()).filter(Boolean);
        }
        if (lanes.length === 0)
            lanes = ['A', 'B'];
        const playDur = parseInt(String(playDuration), 10) || 5;
        const cleanDur = parseInt(String(cleanupDuration), 10) || 2;
        const laneCycle = playDur + cleanDur;
        const hasLegacyPitch = !inputLanes && (pitchMinutesA !== null ||
            pitchMinutesB !== null ||
            (req.body.pitchMinutes !== undefined && req.body.pitchMinutes !== null));
        const isLegacyPitch = hasLegacyPitch;
        let durA = 3;
        let durB = 3;
        let avgDur = 3;
        let offset = 3;
        if (isLegacyPitch) {
            const pDefault = parseInt(String(pitchMinutes), 10) || 3;
            durA = pitchMinutesA !== null ? (parseInt(String(pitchMinutesA), 10) || pDefault) : pDefault;
            durB = pitchMinutesB !== null ? (parseInt(String(pitchMinutesB), 10) || pDefault) : pDefault;
            avgDur = (durA + durB) / 2;
            lanes = ['A', 'B'];
        }
        else {
            if (laneOffset !== null && laneOffset !== undefined && laneOffset !== '') {
                offset = parseInt(String(laneOffset), 10);
            }
            else {
                offset = lanes.length > 1 ? Math.max(1, Math.floor(laneCycle / lanes.length)) : laneCycle;
            }
            avgDur = laneCycle / lanes.length;
        }
        const adjustTransaction = db.transaction(() => {
            let baseOrderIdx = 0;
            let lastLaneIdx = -1;
            let currentTotalMinutes;
            if (fromSlotId && !appendOnly) {
                const baseSlot = db.prepare('SELECT * FROM slots WHERE id = ? AND day_id = ?').get(fromSlotId, dayId);
                if (!baseSlot) {
                    throw new Error('指定された起点スロットが見つかりません');
                }
                baseOrderIdx = baseSlot.order_idx;
                const prevSlot = db.prepare('SELECT lane FROM slots WHERE day_id = ? AND order_idx < ? ORDER BY order_idx DESC LIMIT 1').get(dayId, baseOrderIdx);
                if (prevSlot) {
                    lastLaneIdx = lanes.indexOf(prevSlot.lane);
                }
                db.prepare('DELETE FROM slots WHERE day_id = ? AND order_idx >= ?').run(dayId, baseOrderIdx);
            }
            else if (appendOnly) {
                const lastSlot = db.prepare('SELECT * FROM slots WHERE day_id = ? ORDER BY order_idx DESC LIMIT 1').get(dayId);
                if (lastSlot) {
                    baseOrderIdx = lastSlot.order_idx + 1;
                    lastLaneIdx = lanes.indexOf(lastSlot.lane);
                }
            }
            if (startHour !== undefined && startMinute !== undefined && startHour !== '' && startMinute !== '') {
                currentTotalMinutes = Number(startHour) * 60 + Number(startMinute);
            }
            else {
                const prevSlot = db.prepare('SELECT slot_time, duration_minutes FROM slots WHERE day_id = ? ORDER BY order_idx DESC LIMIT 1').get(dayId);
                if (prevSlot) {
                    const [ph, pm] = prevSlot.slot_time.split(':').map(Number);
                    const pDur = prevSlot.duration_minutes || 3;
                    currentTotalMinutes = ph * 60 + pm + pDur;
                }
                else {
                    currentTotalMinutes = 10 * 60;
                }
            }
            let slotCount = 10;
            if (endHour !== null && endMinute !== null && endHour !== '' && endMinute !== '') {
                const endTotal = Number(endHour) * 60 + Number(endMinute);
                if (endTotal > currentTotalMinutes) {
                    slotCount = Math.floor((endTotal - currentTotalMinutes) / avgDur);
                }
            }
            else if (count !== null && count !== '') {
                slotCount = parseInt(String(count), 10);
            }
            if (slotCount <= 0)
                slotCount = 1;
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
                let dur;
                if (isBuffer) {
                    dur = bufDur;
                }
                else if (isLegacyPitch) {
                    dur = lane === 'A' ? durA : durB;
                }
                else {
                    dur = (L > 1 && lIdx < L - 1) ? offset : Math.max(1, laneCycle - (L - 1) * offset);
                }
                const result = insertSlot.run(dayId, orderIdx, slotTime, lane, dur, playDur, cleanDur, isBuffer);
                const slotId = result.lastInsertRowid;
                for (let seat = 1; seat <= seats; seat++) {
                    const ticketCode = `${lane}${hh}${mm}-${seat}`;
                    insertReservation.run(slotId, seat, ticketCode);
                }
                curMins += dur;
            }
        });
        adjustTransaction();
        broadcastUpdate({ reason: 'slots_adjusted', dayId });
        res.json({ success: true, message: `Day ${dayId} のスロットを調整・生成しました` });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// スロット個別の設定（枠時間・体験時間・入替時間・レーン）更新 & 後続時刻・整理券コードのカスケード再計算
app.post('/api/slots/update-slot', (req, res) => {
    try {
        const { slotId, durationMinutes, playDuration, cleanupDuration, lane } = req.body;
        if (!slotId) {
            res.status(400).json({ success: false, message: 'slotId is required' });
            return;
        }
        const updateTransaction = db.transaction(() => {
            const targetSlot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slotId);
            if (!targetSlot) {
                throw new Error('指定されたスロットが見つかりません');
            }
            const newDur = (durationMinutes !== undefined && durationMinutes !== null)
                ? Math.max(1, parseInt(String(durationMinutes), 10))
                : targetSlot.duration_minutes;
            const newPlay = (playDuration !== undefined && playDuration !== null)
                ? Math.max(1, parseInt(String(playDuration), 10))
                : (targetSlot.play_duration || 5);
            const newClean = (cleanupDuration !== undefined && cleanupDuration !== null)
                ? Math.max(0, parseInt(String(cleanupDuration), 10))
                : (targetSlot.cleanup_duration !== undefined ? targetSlot.cleanup_duration : 2);
            const newLane = lane ? String(lane).trim().toUpperCase() : targetSlot.lane;
            // 当該スロットを更新
            db.prepare(`
        UPDATE slots 
        SET duration_minutes = ?, play_duration = ?, cleanup_duration = ?, lane = ?
        WHERE id = ?
      `).run(newDur, newPlay, newClean, newLane, slotId);
            // 当該スロットのチケット番号を lane に合わせて更新
            const [th, tm] = targetSlot.slot_time.split(':');
            const targetSeats = db.prepare('SELECT id, seat_no FROM seat_reservations WHERE slot_id = ?').all(slotId);
            const updateTicket = db.prepare('UPDATE seat_reservations SET ticket_code = ? WHERE id = ?');
            for (const seat of targetSeats) {
                const code = `${newLane}${th}${tm}-${seat.seat_no}`;
                updateTicket.run(code, seat.id);
            }
            // カスケード再計算: targetSlot 以降のスロットの slot_time と ticket_code を更新
            const followingSlots = db.prepare(`
        SELECT * FROM slots 
        WHERE day_id = ? AND order_idx >= ? 
        ORDER BY order_idx ASC
      `).all(targetSlot.day_id, targetSlot.order_idx);
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
                        const seats = db.prepare('SELECT id, seat_no FROM seat_reservations WHERE slot_id = ?').all(s.id);
                        for (const seat of seats) {
                            const newCode = `${sLane}${hh}${mm}-${seat.seat_no}`;
                            updateTicket.run(newCode, seat.id);
                        }
                    }
                    curTotal += sDur;
                }
            }
        });
        updateTransaction();
        broadcastUpdate({ reason: 'slot_updated', slotId });
        res.json({ success: true, message: 'スロット設定を更新し、時刻と整理券を再計算しました' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// スロット個別の枠時間（duration_minutes）更新（後方互換）
app.post('/api/slots/update-duration', (req, res) => {
    const { slotId, durationMinutes } = req.body;
    if (!slotId || !durationMinutes || Number(durationMinutes) <= 0) {
        res.status(400).json({ success: false, message: '有効な slotId と durationMinutes (> 0) を指定してください' });
        return;
    }
    // update-slot に処理を統合
    req.url = '/api/slots/update-slot';
    app._router.handle(req, res);
});
// 一括遅延シフト
app.post('/api/slots/shift-delay', (req, res) => {
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
            const baseSlot = db.prepare('SELECT * FROM slots WHERE id = ?').get(fromSlotId);
            if (!baseSlot) {
                throw new Error('指定されたスロットが見つかりません');
            }
            const targetSlots = db.prepare('SELECT * FROM slots WHERE day_id = ? AND order_idx >= ? ORDER BY order_idx ASC').all(baseSlot.day_id, baseSlot.order_idx);
            const updateSlot = db.prepare('UPDATE slots SET slot_time = ? WHERE id = ?');
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
                const seats = db.prepare('SELECT id, seat_no FROM seat_reservations WHERE slot_id = ?').all(slot.id);
                for (const seat of seats) {
                    const newCode = `${slot.lane}${newHh}${newMm}-${seat.seat_no}`;
                    updateTicket.run(newCode, seat.id);
                }
            }
        });
        shiftTransaction();
        broadcastUpdate({ reason: 'slots_shifted' });
        res.json({ success: true, message: `指定スロット以降を ${shift > 0 ? `+${shift}` : shift} 分シフトしました` });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// 調整枠切替
app.post('/api/slots/toggle-buffer', (req, res) => {
    try {
        const { slotId } = req.body;
        if (!slotId) {
            res.status(400).json({ success: false, message: 'slotId is required' });
            return;
        }
        const current = db.prepare('SELECT is_buffer FROM slots WHERE id = ?').get(slotId);
        if (!current) {
            res.status(404).json({ success: false, message: 'スロットが見つかりません' });
            return;
        }
        const nextBuffer = current.is_buffer === 1 ? 0 : 1;
        db.prepare('UPDATE slots SET is_buffer = ? WHERE id = ?').run(nextBuffer, slotId);
        broadcastUpdate({ reason: 'slot_buffer_toggled', slotId, is_buffer: nextBuffer === 1 });
        res.json({ success: true, is_buffer: nextBuffer === 1 });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// ==========================================
// タイムライン取得 API
// ==========================================
app.get('/api/timeline', (req, res) => {
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
        s.is_closed,
        r.id AS reservation_id,
        r.seat_no,
        r.ticket_code,
        r.ticket_number,
        r.assigned_ticket_code,
        CASE 
          WHEN r.ticket_number IS NOT NULL THEN 'No. ' || r.ticket_number
          WHEN r.assigned_ticket_code IS NOT NULL THEN r.assigned_ticket_code
          ELSE r.ticket_code
        END AS display_ticket_code,
        r.note,
        r.status,
        r.game_id,
        r.updated_at,
        g.name AS game_name,
        g.command AS game_command
      FROM slots s
      LEFT JOIN seat_reservations r ON s.id = r.slot_id
      LEFT JOIN games g ON r.game_id = g.id
      WHERE s.day_id = ?
      ORDER BY s.order_idx ASC, r.seat_no ASC
    `).all(dayId);
        const slotsMap = new Map();
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
                    is_closed: row.is_closed === 1,
                    seats: [],
                });
            }
            if (row.reservation_id) {
                slotsMap.get(row.slot_id).seats.push({
                    id: row.reservation_id,
                    seat_no: row.seat_no,
                    ticket_code: row.ticket_code,
                    ticket_number: row.ticket_number,
                    assigned_ticket_code: row.assigned_ticket_code,
                    display_ticket_code: row.display_ticket_code,
                    note: row.note,
                    status: row.status,
                    game_id: row.game_id,
                    game_name: row.game_name,
                    game_command: row.game_command,
                    updated_at: row.updated_at,
                });
            }
        }
        const timeline = Array.from(slotsMap.values());
        const waitStatus = getIssueWaitStatus(dayId);
        res.json({ success: true, activeDay, selectedDay: dayId, timeline, waitStatus });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// ==========================================
// 発券可能・待ち時間判定ロジック
// ==========================================
function getIssueWaitStatus(dayId) {
    const maxWaitMinutes = getMaxWaitMinutes();
    // 当日有効な全座席（未閉鎖スロット）
    const allSeats = db.prepare(`
    SELECT 
      r.id AS reservation_id,
      r.seat_no,
      r.ticket_code,
      s.slot_time,
      s.lane,
      s.order_idx,
      s.is_buffer
    FROM seat_reservations r
    JOIN slots s ON r.slot_id = s.id
    WHERE s.day_id = ? AND s.is_closed = 0
    ORDER BY s.order_idx ASC, r.seat_no ASC
  `).all(dayId);
    // 発券済みで有効な（キャンセルされていない）チケット数
    const activeCountRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM tickets
    WHERE day_id = ? AND status IN ('issued', 'checked_in', 'assigned')
  `).get(dayId);
    const activeCount = activeCountRow?.cnt || 0;
    if (allSeats.length === 0 || activeCount >= allSeats.length) {
        return {
            canIssue: false,
            reason: 'FULL',
            message: '本日の枠はすべて満席です',
            maxWaitMinutes,
            currentWaitMinutes: 0,
            nextSlotTime: null,
            resumeTime: null,
        };
    }
    // 次に発券されるチケットが入る予定の座席
    const candidate = allSeats[activeCount];
    const [cH, cM] = candidate.slot_time.split(':').map(Number);
    const candidateMins = cH * 60 + cM;
    const firstOpenSlot = db.prepare(`
    SELECT slot_time FROM slots WHERE day_id = ? AND is_closed = 0 ORDER BY order_idx ASC LIMIT 1
  `).get(dayId);
    const lastSlot = db.prepare(`
    SELECT slot_time FROM slots WHERE day_id = ? ORDER BY order_idx DESC LIMIT 1
  `).get(dayId);
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    let baseMins;
    if (firstOpenSlot) {
        const [fH, fM] = firstOpenSlot.slot_time.split(':').map(Number);
        const firstMins = fH * 60 + fM;
        let lastMins = firstMins + 360;
        if (lastSlot) {
            const [lH, lM] = lastSlot.slot_time.split(':').map(Number);
            lastMins = lH * 60 + lM + 10;
        }
        if (nowMins >= firstMins && nowMins <= lastMins) {
            baseMins = nowMins;
        }
        else {
            baseMins = firstMins;
        }
    }
    else {
        baseMins = nowMins;
    }
    const currentWaitMinutes = Math.max(0, candidateMins - baseMins);
    if (maxWaitMinutes > 0 && currentWaitMinutes > maxWaitMinutes) {
        const resumeTotal = (candidateMins - maxWaitMinutes + 1440) % 1440;
        const rH = Math.floor(resumeTotal / 60);
        const rM = resumeTotal % 60;
        const resumeTime = `${String(rH).padStart(2, '0')}:${String(rM).padStart(2, '0')}`;
        return {
            canIssue: false,
            reason: 'WAIT_LIMIT_EXCEEDED',
            message: `待ち時間（約${currentWaitMinutes}分）が上限（${maxWaitMinutes}分）を超えているため、現在発券を一時停止しています（次回再開目安: ${resumeTime}頃）`,
            maxWaitMinutes,
            currentWaitMinutes,
            nextSlotTime: candidate.slot_time,
            resumeTime,
        };
    }
    return {
        canIssue: true,
        reason: 'OK',
        message: '発券可能',
        maxWaitMinutes,
        currentWaitMinutes,
        nextSlotTime: candidate.slot_time,
        resumeTime: null,
    };
}
// ==========================================
// 発券状況・待ち時間確認 API
// ==========================================
app.get('/api/issue/status', (_req, res) => {
    try {
        const activeDay = getActiveDay();
        const status = getIssueWaitStatus(activeDay);
        res.json({ success: true, activeDay, ...status });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// ==========================================
// ==========================================
// 整理券発券 API（単なる通し数字の発行・枠事前割当なし）
// ==========================================
app.post('/api/issue', (req, res) => {
    try {
        const { gameId } = req.body;
        if (!gameId) {
            res.status(400).json({ success: false, message: 'gameId is required' });
            return;
        }
        const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
        if (!game) {
            res.status(404).json({ success: false, message: `ゲームID [${gameId}] がマスタに見つかりません` });
            return;
        }
        const activeDay = req.body.day ? parseInt(String(req.body.day), 10) : getActiveDay();
        const issueTransaction = db.transaction(() => {
            // 最新の整理番号を取得し、+1 で連番採番
            const maxRow = db.prepare('SELECT MAX(ticket_number) AS max_num FROM tickets WHERE day_id = ?').get(activeDay);
            const nextNum = (maxRow?.max_num || 0) + 1;
            db.prepare(`
        INSERT INTO tickets (day_id, ticket_number, game_id, status)
        VALUES (?, ?, ?, 'issued')
      `).run(activeDay, nextNum, game.id);
            // 現在待機中（未割当: issued または checked_in）の人数
            const waitRow = db.prepare(`
        SELECT COUNT(*) AS cnt FROM tickets
        WHERE day_id = ? AND status IN ('issued', 'checked_in')
      `).get(activeDay);
            return {
                ticket_number: nextNum,
                ticket_code: String(nextNum),
                display_ticket_code: `No. ${nextNum}`,
                game_id: game.id,
                game_name: game.name,
                waiting_count: waitRow?.cnt || 1,
                day_id: activeDay,
                created_at: new Date().toISOString(),
            };
        });
        const issued = issueTransaction();
        broadcastUpdate({ reason: 'ticket_issued', ticket: issued, dayId: activeDay });
        res.json({ success: true, ticket: issued });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// ==========================================
// 案内締め切り＆未着保留＆繰り上げ API
// ==========================================
app.post('/api/slots/close', (req, res) => {
    try {
        const { slotId } = req.body;
        if (!slotId) {
            res.status(400).json({ success: false, message: 'slotId is required' });
            return;
        }
        const currentSlot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slotId);
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
      `).all(slotId);
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
      `).all(slotId);
            const checkedInCandidates = db.prepare(`
        SELECT r.id, r.ticket_code, r.game_id, s.slot_time, s.lane, s.order_idx, g.name AS game_name
        FROM seat_reservations r
        JOIN slots s ON r.slot_id = s.id
        LEFT JOIN games g ON r.game_id = g.id
        WHERE s.day_id = ? AND s.order_idx > ? AND r.status = 'checked_in'
        ORDER BY s.order_idx ASC, r.seat_no ASC
        LIMIT ?
      `).all(currentSlot.day_id, currentSlot.order_idx, availableSeats.length);
            const bumpedList = [];
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
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// ==========================================
// 遅刻・保留キュー API (現在のアクティブDay対象)
// ==========================================
app.get('/api/late-queue', (req, res) => {
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
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
app.post('/api/late-queue/reassign', (req, res) => {
    try {
        const { lateId, reservationId } = req.body;
        if (!lateId) {
            res.status(400).json({ success: false, message: 'lateId is required' });
            return;
        }
        const activeDay = getActiveDay();
        const lateItem = db.prepare("SELECT * FROM late_queue WHERE id = ? AND status = 'waiting'").get(lateId);
        if (!lateItem) {
            res.status(404).json({ success: false, message: 'Late queue item not found' });
            return;
        }
        const reassignTransaction = db.transaction(() => {
            let targetSeat = null;
            if (reservationId) {
                targetSeat = db.prepare(`
          SELECT r.*, s.slot_time, s.lane 
          FROM seat_reservations r 
          JOIN slots s ON r.slot_id = s.id 
          WHERE s.day_id = ? AND r.id = ? AND r.status = 'empty'
        `).get(activeDay, reservationId);
            }
            else {
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
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
app.post('/api/late-queue/cancel', (req, res) => {
    try {
        const { lateId } = req.body;
        db.prepare("UPDATE late_queue SET status = 'cancelled' WHERE id = ?").run(lateId);
        broadcastUpdate({ reason: 'late_cancelled', lateId });
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// ==========================================
// 受付（チェックイン）API
// ==========================================
// 整理券一覧取得（受付担当専用: 整理番号・希望ゲーム・到着状況のみ）
app.get('/api/checkin/list', (req, res) => {
    try {
        const activeDay = getActiveDay();
        const dayId = req.query.day ? parseInt(String(req.query.day), 10) : activeDay;
        const tickets = db.prepare(`
      SELECT 
        t.id,
        t.day_id,
        t.ticket_number,
        t.game_id,
        t.status,
        t.assigned_slot_id,
        t.assigned_seat_no,
        t.created_at,
        t.checked_in_at,
        g.name AS game_name,
        g.command AS game_command
      FROM tickets t
      LEFT JOIN games g ON t.game_id = g.id
      WHERE t.day_id = ? AND t.status != 'cancelled'
      ORDER BY t.ticket_number ASC
    `).all(dayId);
        res.json({ success: true, dayId, tickets });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// 到着ステータス更新（「到着」/「未到着に戻す」）
app.post('/api/checkin/mark', (req, res) => {
    try {
        const { ticketNumber, ticketId, status } = req.body;
        const activeDay = getActiveDay();
        let targetTicket = null;
        if (ticketId) {
            targetTicket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
        }
        else if (ticketNumber) {
            const num = parseInt(String(ticketNumber).replace(/[^0-9]/g, ''), 10);
            targetTicket = db.prepare('SELECT * FROM tickets WHERE day_id = ? AND ticket_number = ?').get(activeDay, num);
        }
        if (!targetTicket) {
            res.status(404).json({ success: false, message: '整理券が見つかりません' });
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
            reason: 'checkin_updated',
            ticketId: targetTicket.id,
            ticketNumber: targetTicket.ticket_number,
            status: nextStatus,
            dayId: activeDay,
        });
        res.json({
            success: true,
            ticketId: targetTicket.id,
            ticketNumber: targetTicket.ticket_number,
            status: nextStatus,
            message: `No. ${targetTicket.ticket_number} のステータスを [${nextStatus === 'checked_in' ? '到着済' : '未到着'}] に更新しました`,
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// 番号スキャンまたは入力による到着受付
app.post('/api/checkin/by-ticket', (req, res) => {
    try {
        const { ticketCode, ticketNumber } = req.body;
        const raw = String(ticketNumber || ticketCode || '').trim();
        if (!raw) {
            res.status(400).json({ success: false, message: '整理券番号を入力してください' });
            return;
        }
        const activeDay = getActiveDay();
        const numMatch = raw.match(/\d+/);
        let targetTicket = null;
        if (numMatch) {
            const num = parseInt(numMatch[0], 10);
            targetTicket = db.prepare(`
        SELECT t.*, g.name AS game_name 
        FROM tickets t 
        LEFT JOIN games g ON t.game_id = g.id 
        WHERE t.day_id = ? AND t.ticket_number = ?
      `).get(activeDay, num);
        }
        if (!targetTicket) {
            // 従来の席予約コードとの後方互換
            const reservation = db.prepare(`
        SELECT r.*, s.slot_time, s.lane, g.name AS game_name
        FROM seat_reservations r
        JOIN slots s ON r.slot_id = s.id
        LEFT JOIN games g ON r.game_id = g.id
        WHERE s.day_id = ? AND (UPPER(r.ticket_code) = ? OR UPPER(COALESCE(r.assigned_ticket_code, '')) = ?)
      `).get(activeDay, raw.toUpperCase(), raw.toUpperCase());
            if (reservation) {
                const nextSt = reservation.status === 'checked_in' ? 'booked' : 'checked_in';
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
        const nextStatus = targetTicket.status === 'checked_in' ? 'issued' : 'checked_in';
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
        res.json({
            success: true,
            ticketNumber: targetTicket.ticket_number,
            ticketCode: `No. ${targetTicket.ticket_number}`,
            gameName: targetTicket.game_name,
            status: nextStatus,
            message: `No. ${targetTicket.ticket_number} (${targetTicket.game_name}): ${nextStatus === 'checked_in' ? '到着済にしました' : '未到着に戻しました'}`,
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// 整理券の取消（欠席・キャンセル）
app.post('/api/checkin/cancel', (req, res) => {
    try {
        const { ticketNumber, ticketId } = req.body;
        const activeDay = getActiveDay();
        let targetTicket = null;
        if (ticketId) {
            targetTicket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
        }
        else if (ticketNumber) {
            const num = parseInt(String(ticketNumber).replace(/[^0-9]/g, ''), 10);
            targetTicket = db.prepare('SELECT * FROM tickets WHERE day_id = ? AND ticket_number = ?').get(activeDay, num);
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
        res.json({ success: true, message: `No. ${targetTicket.ticket_number} を取消しました` });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// キャンセル（座席ID指定互換）
app.post('/api/cancel', (req, res) => {
    try {
        const { reservationId } = req.body;
        if (!reservationId) {
            res.status(400).json({ success: false, message: 'reservationId is required' });
            return;
        }
        const current = db.prepare('SELECT * FROM seat_reservations WHERE id = ?').get(reservationId);
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
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// ==========================================
// 枠割り当て管理（スロット配席 & 割当予定プレビュー）API
// ==========================================
// 全スロットの確定状況と「割当予定」プレビュー取得
app.get('/api/assignment/status', (req, res) => {
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
    `).all(dayId);
        const slotsMap = new Map();
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
        // 到着済み（checked_in）でまだ枠に割り当てられていないチケットを昇順で取得
        const unassignedCheckedIn = db.prepare(`
      SELECT t.*, g.name AS game_name, g.command AS game_command
      FROM tickets t
      LEFT JOIN games g ON t.game_id = g.id
      WHERE t.day_id = ? AND t.status = 'checked_in' AND t.assigned_slot_id IS NULL
      ORDER BY t.ticket_number ASC
    `).all(dayId);
        // 各未閉鎖枠の空席に到着順で割り当て予定をシミュレート
        const queue = [...unassignedCheckedIn];
        for (const slot of slotList) {
            if (slot.is_closed)
                continue;
            const emptySeats = slot.seats.filter((s) => !s.is_assigned && s.status === 'empty');
            for (const seat of emptySeats) {
                if (queue.length > 0) {
                    const nextTicket = queue.shift();
                    slot.plannedSeats.push({
                        seatNo: seat.seat_no,
                        ticketId: nextTicket.id,
                        ticketNumber: nextTicket.ticket_number,
                        displayTicketNumber: `No. ${nextTicket.ticket_number}`,
                        gameName: nextTicket.game_name,
                        gameId: nextTicket.game_id,
                    });
                }
            }
            slot.canFill = slot.plannedSeats.length > 0;
        }
        res.json({
            success: true,
            dayId,
            slots: slotList,
            totalUnassignedCheckedIn: unassignedCheckedIn.length,
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// 「枠に割当」確定API（割当予定のチケットを一括確定）
app.post('/api/assignment/fill-slot', (req, res) => {
    try {
        const { slotId } = req.body;
        if (!slotId) {
            res.status(400).json({ success: false, message: 'slotId is required' });
            return;
        }
        const activeDay = getActiveDay();
        const targetSlot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slotId);
        if (!targetSlot) {
            res.status(404).json({ success: false, message: 'スロットが見つかりません' });
            return;
        }
        const fillTx = db.transaction(() => {
            const emptySeats = db.prepare(`
        SELECT * FROM seat_reservations
        WHERE slot_id = ? AND (is_assigned = 0 OR status = 'empty')
        ORDER BY seat_no ASC
      `).all(slotId);
            const waitingTickets = db.prepare(`
        SELECT * FROM tickets
        WHERE day_id = ? AND status = 'checked_in' AND assigned_slot_id IS NULL
        ORDER BY ticket_number ASC
        LIMIT ?
      `).all(activeDay, emptySeats.length);
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
            message: `【${targetSlot.lane}組 ${targetSlot.slot_time}】に ${result.assignedCount} 名を割り当てました`,
            data: result,
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// スロットの割当解除API（誤操作時の取消）
app.post('/api/assignment/unfill-slot', (req, res) => {
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
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// ==========================================
// 室内準備モニター / 各席体験PC用監視 API
// ==========================================
app.get('/api/seat-status', (req, res) => {
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
    `).get(activeDay, lane, seat);
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
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// SSE: GET /api/events
app.get('/api/events', (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const unregister = registerSSEClient(res);
    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 15000);
    _req.on('close', () => {
        clearInterval(heartbeat);
        unregister();
    });
});
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Backend] Ticket Management Server running on http://0.0.0.0:${PORT}`);
});
//# sourceMappingURL=index.js.map