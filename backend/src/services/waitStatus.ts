import { db, getIssuingPaused, getMaxWaitMinutes } from '../db.ts';

export interface IssueWaitStatus {
  canIssue: boolean;
  reason: 'NO_SLOTS' | 'FULL' | 'WAIT_LIMIT_EXCEEDED' | 'PAUSED' | 'OK';
  message: string;
  maxWaitMinutes: number;
  currentWaitMinutes: number;
  nextSlotTime: string | null;
  resumeTime: string | null;
}

export interface BufferSummary {
  totalBufferSlots: number;
  totalBufferSeats: number;
  remainingBufferSlots: number;
  remainingBufferSeats: number;
  unassignedDelayedCount: number;
  unarrivedDelayedCount: number;
  seatsDiff: number;
  canAccommodate: boolean;
}

/**
 * 発券可能・待ち時間判定ロジック
 */
export function getIssueWaitStatus(dayId: number, simulatedTimeStr?: string | null): IssueWaitStatus {
  const maxWaitMinutes = getMaxWaitMinutes();

  if (getIssuingPaused()) {
    return {
      canIssue: false,
      reason: 'PAUSED',
      message: '管理者により発券を一時停止しています',
      maxWaitMinutes,
      currentWaitMinutes: 0,
      nextSlotTime: null,
      resumeTime: null,
    };
  }

  // 1. スロット自体が存在するか確認
  const totalSlotsRow = db.prepare('SELECT COUNT(*) as cnt FROM slots WHERE day_id = ? AND is_buffer = 0 AND is_maintenance = 0').get(dayId) as any;
  if (!totalSlotsRow || totalSlotsRow.cnt === 0) {
    return {
      canIssue: false,
      reason: 'NO_SLOTS',
      message: 'スロットが生成されていません。「設定」タブからスロットを生成してください',
      maxWaitMinutes,
      currentWaitMinutes: 0,
      nextSlotTime: null,
      resumeTime: null,
    };
  }

  // 2. 当日有効な未閉鎖スロットの空席（まだ確定・割当されていない通常枠の席）を昇順で取得
  // ★ 調整枠（is_buffer = 1）およびメンテナンス枠（is_maintenance = 1）は予約時は除外
  const availableSeats = db.prepare(`
    SELECT 
      r.id AS reservation_id,
      r.seat_no,
      r.ticket_code,
      s.id AS slot_id,
      s.slot_time,
      s.lane,
      s.order_idx,
      s.is_buffer
    FROM seat_reservations r
    JOIN slots s ON r.slot_id = s.id
    WHERE s.day_id = ? AND s.is_closed = 0 AND s.is_buffer = 0 AND s.is_maintenance = 0 AND (r.is_assigned = 0 OR r.status = 'empty')
    ORDER BY s.order_idx ASC, r.seat_no ASC
  `).all(dayId) as any[];

  // 3. 発券済みでまだ枠に割り当てられていない待機中チケット（issued または checked_in で assigned_slot_id が NULL）
  const waitingCountRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM tickets
    WHERE day_id = ? AND status IN ('issued', 'checked_in') AND assigned_slot_id IS NULL
  `).get(dayId) as any;
  const waitingCount = waitingCountRow?.cnt || 0;

  // 4. 空き枠がもうない、または待機客で残りの全空席が埋まっている場合 ➔ 満席（FULL）
  if (availableSeats.length === 0 || waitingCount >= availableSeats.length) {
    return {
      canIssue: false,
      reason: 'FULL',
      message: '本日の空き枠はすべて満席です（受付終了）',
      maxWaitMinutes,
      currentWaitMinutes: 0,
      nextSlotTime: null,
      resumeTime: null,
    };
  }

  // 5. 次に発券されるチケットが入る予定の空席
  const candidate = availableSeats[waitingCount];
  const [cH, cM] = candidate.slot_time.split(':').map(Number);
  const candidateMins = cH * 60 + cM;

  // 6. 基準時刻（baseMins）の計算（調整枠・メンテナンス枠を除く通常枠の先頭）
  const firstOpenSlot = db.prepare(`
    SELECT slot_time FROM slots WHERE day_id = ? AND is_closed = 0 AND is_buffer = 0 AND is_maintenance = 0 ORDER BY order_idx ASC LIMIT 1
  `).get(dayId) as any;

  let nowMins: number;
  if (simulatedTimeStr && /^\d{1,2}:\d{2}$/.test(simulatedTimeStr)) {
    const [sH = 0, sM = 0] = simulatedTimeStr.split(':').map(Number);
    nowMins = sH * 60 + sM;
  } else {
    const now = new Date();
    nowMins = now.getHours() * 60 + now.getMinutes();
  }

  let baseMins: number;
  if (firstOpenSlot) {
    const [fH, fM] = firstOpenSlot.slot_time.split(':').map(Number);
    const firstMins = fH * 60 + fM;
    // 開場前（現在時刻が先頭スロットより前）なら先頭スロット時刻を基準、開場後なら現在時刻を基準
    baseMins = Math.max(nowMins, firstMins);
  } else {
    baseMins = nowMins;
  }

  // 待ち時間（分）
  const currentWaitMinutes = Math.max(0, candidateMins - baseMins);

  // 7. 最大待ち時間上限チェック
  if (maxWaitMinutes > 0 && currentWaitMinutes > maxWaitMinutes) {
    const resumeTotal = (candidateMins - maxWaitMinutes + 1440) % 1440;
    const rH = Math.floor(resumeTotal / 60);
    const rM = resumeTotal % 60;
    const resumeTime = `${String(rH).padStart(2, '0')}:${String(rM).padStart(2, '0')}`;

    return {
      canIssue: false,
      reason: 'WAIT_LIMIT_EXCEEDED',
      message: `待ち時間（約${currentWaitMinutes}分）が上限（${maxWaitMinutes}分）を超えているため、発券を一時停止しています（次回再開目安: ${resumeTime}頃）`,
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

/**
 * 調整枠の空き状況と遅延者受け入れ可能数を算出するヘルパー
 */
export function getBufferSummary(dayId: number, nowMins?: number): BufferSummary {
  if (nowMins === undefined) {
    const now = new Date();
    nowMins = now.getHours() * 60 + now.getMinutes();
  }

  // 当日の調整枠 (is_buffer = 1)
  const bufferSlots = db.prepare(`
    SELECT * FROM slots
    WHERE day_id = ? AND is_buffer = 1 AND is_maintenance = 0
    ORDER BY slot_time ASC
  `).all(dayId) as any[];

  let totalBufferSeats = 0;
  let remainingBufferSeats = 0;
  let remainingBufferSlots = 0;

  for (const slot of bufferSlots) {
    const seats = db.prepare(`
      SELECT * FROM seat_reservations WHERE slot_id = ?
    `).all(slot.id) as any[];
    totalBufferSeats += seats.length;

    if (!slot.is_closed) {
      remainingBufferSlots++;
      const emptyCount = seats.filter((s: any) => !s.is_assigned && s.status === 'empty').length;
      remainingBufferSeats += emptyCount;
    }
  }

  // 全チケットから遅延者を抽出
  const allTickets = db.prepare(`
    SELECT t.*, s.lane AS expected_lane, s.is_closed AS expected_slot_is_closed
    FROM tickets t
    LEFT JOIN slots s ON t.expected_slot_id = s.id
    WHERE t.day_id = ? AND t.status != 'cancelled'
  `).all(dayId) as any[];

  let unassignedDelayedCount = 0;
  let unarrivedDelayedCount = 0;

  for (const t of allTickets) {
    if (t.status === 'assigned') continue;

    let isDelayed = false;
    if (t.expected_slot_is_closed === 1) {
      isDelayed = true;
    } else if (t.expected_slot_time) {
      const [eH, eM] = t.expected_slot_time.split(':').map(Number);
      const expMins = eH * 60 + eM;
      if (nowMins > expMins) {
        isDelayed = true;
      }
    }

    if (isDelayed) {
      if (t.status === 'checked_in' && !t.assigned_slot_id) {
        unassignedDelayedCount++;
      } else if (t.status === 'issued') {
        unarrivedDelayedCount++;
      }
    }
  }

  const seatsDiff = remainingBufferSeats - unassignedDelayedCount;
  const canAccommodate = seatsDiff >= 0;

  return {
    totalBufferSlots: bufferSlots.length,
    totalBufferSeats,
    remainingBufferSlots,
    remainingBufferSeats,
    unassignedDelayedCount,
    unarrivedDelayedCount,
    seatsDiff,
    canAccommodate,
  };
}
