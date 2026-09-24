import { db, initDatabase } from './db.ts';
import { app } from './app.ts';

// 互換性のための re-export
export { requireAdminAuth } from './auth.ts';

// DB初期化
initDatabase();

// 既存チケットの expected_slot_id 補完（未設定の場合のバックフィル）
try {
  const unsetTickets = db.prepare(`
    SELECT id, day_id, ticket_number FROM tickets WHERE expected_slot_id IS NULL ORDER BY day_id ASC, ticket_number ASC
  `).all() as any[];
  for (const t of unsetTickets) {
    const regularSeats = db.prepare(`
      SELECT s.id AS slot_id, s.slot_time
      FROM seat_reservations r
      JOIN slots s ON r.slot_id = s.id
      WHERE s.day_id = ? AND s.is_buffer = 0 AND s.is_maintenance = 0
      ORDER BY s.order_idx ASC, r.seat_no ASC
    `).all(t.day_id) as any[];
    const idx = t.ticket_number - 1;
    if (idx >= 0 && idx < regularSeats.length) {
      const match = regularSeats[idx];
      db.prepare('UPDATE tickets SET expected_slot_id = ?, expected_slot_time = ? WHERE id = ?')
        .run(match.slot_id, match.slot_time, t.id);
    }
  }
} catch (e) {
  console.warn('Expected slot backfill notice:', e);
}

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;

export const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Backend] Ticket Management Server running on http://0.0.0.0:${PORT}`);
});
server.ref();
