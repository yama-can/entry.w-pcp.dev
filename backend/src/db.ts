import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// data ディレクトリを用意
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'tickets.db');
export const db = new Database(dbPath);

// WALモードと外部キー制約の有効化
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      command TEXT
    );

    CREATE TABLE IF NOT EXISTS slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_id INTEGER NOT NULL DEFAULT 1,
      order_idx INTEGER NOT NULL,
      slot_time TEXT NOT NULL,
      lane TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 3,
      play_duration INTEGER NOT NULL DEFAULT 5,
      cleanup_duration INTEGER NOT NULL DEFAULT 2,
      is_buffer INTEGER DEFAULT 0,
      is_maintenance INTEGER DEFAULT 0,
      is_closed INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS seat_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_id INTEGER NOT NULL,
      seat_no INTEGER NOT NULL,
      ticket_code TEXT UNIQUE NOT NULL,
      game_id TEXT,
      status TEXT NOT NULL DEFAULT 'empty',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (slot_id) REFERENCES slots(id) ON DELETE CASCADE,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL,
      UNIQUE (slot_id, seat_no)
    );

    CREATE TABLE IF NOT EXISTS late_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_id INTEGER NOT NULL DEFAULT 1,
      original_ticket_code TEXT NOT NULL,
      original_slot_time TEXT NOT NULL,
      lane TEXT NOT NULL,
      seat_no INTEGER NOT NULL,
      game_id TEXT,
      status TEXT DEFAULT 'waiting',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reassigned_reservation_id INTEGER,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_id INTEGER NOT NULL DEFAULT 1,
      ticket_number INTEGER NOT NULL,
      game_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'issued',
      assigned_slot_id INTEGER,
      assigned_seat_no INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      checked_in_at DATETIME,
      assigned_at DATETIME,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE RESTRICT,
      FOREIGN KEY (assigned_slot_id) REFERENCES slots(id) ON DELETE SET NULL,
      UNIQUE(day_id, ticket_number)
    );

    CREATE INDEX IF NOT EXISTS idx_slots_order ON slots(day_id, order_idx);
    CREATE INDEX IF NOT EXISTS idx_reservations_status ON seat_reservations(status);
    CREATE INDEX IF NOT EXISTS idx_reservations_ticket ON seat_reservations(ticket_code);
    CREATE INDEX IF NOT EXISTS idx_tickets_day ON tickets(day_id, ticket_number);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(day_id, status);
  `);

  // カラム追加マイグレーション
  try {
    db.exec(`ALTER TABLE slots ADD COLUMN day_id INTEGER NOT NULL DEFAULT 1`);
  } catch {}
  try {
    db.exec(`ALTER TABLE slots ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 3`);
  } catch {}
  try {
    db.exec(`ALTER TABLE slots ADD COLUMN play_duration INTEGER NOT NULL DEFAULT 5`);
  } catch {}
  try {
    db.exec(`ALTER TABLE slots ADD COLUMN cleanup_duration INTEGER NOT NULL DEFAULT 2`);
  } catch {}
  try {
    db.exec(`ALTER TABLE slots ADD COLUMN is_buffer INTEGER DEFAULT 0`);
  } catch {}
  try {
    db.exec(`ALTER TABLE slots ADD COLUMN is_closed INTEGER DEFAULT 0`);
  } catch {}
  try {
    db.exec(`ALTER TABLE late_queue ADD COLUMN day_id INTEGER NOT NULL DEFAULT 1`);
  } catch {}
  try {
    db.exec(`ALTER TABLE seat_reservations ADD COLUMN assigned_ticket_code TEXT`);
  } catch {}
  try {
    db.exec(`ALTER TABLE seat_reservations ADD COLUMN note TEXT`);
  } catch {}
  try {
    db.exec(`ALTER TABLE seat_reservations ADD COLUMN is_assigned INTEGER DEFAULT 0`);
  } catch {}
  try {
    db.exec(`ALTER TABLE seat_reservations ADD COLUMN ticket_number INTEGER`);
  } catch {}
  try {
    db.exec(`ALTER TABLE tickets ADD COLUMN expected_slot_id INTEGER`);
  } catch {}
  try {
    db.exec(`ALTER TABLE tickets ADD COLUMN expected_slot_time TEXT`);
  } catch {}

  // 初期設定値
  db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES ('active_day', '1')
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES ('max_wait_minutes', '30')
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES ('meeting_lead_minutes', '5')
  `).run();

  // マイグレーション: is_maintenance カラムが存在しなければ追加
  try {
    db.prepare('ALTER TABLE slots ADD COLUMN is_maintenance INTEGER DEFAULT 0').run();
  } catch {}

  // 初期ゲームデータがなければ投入
  const count = (db.prepare('SELECT COUNT(*) as count FROM games').get() as { count: number }).count;
  if (count === 0) {
    const insertGame = db.prepare('INSERT INTO games (id, name, command) VALUES (?, ?, ?)');
    const defaultGames = [
      { id: 'ACT_01', name: '爆走バトルレーシング', command: 'racing.exe' },
      { id: 'PUZ_01', name: 'ぷよっとパズルクエスト', command: 'puzzle.exe' },
      { id: 'RPG_01', name: '勇者の大冒険 試練編', command: 'rpg.exe' },
      { id: 'STG_01', name: 'スペースインベーダー DX', command: 'invaders.exe' },
    ];
    for (const g of defaultGames) {
      insertGame.run(g.id, g.name, g.command);
    }
  }
}

export function getActiveDay(): number {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'active_day'").get() as any;
  return row ? parseInt(row.value, 10) : 1;
}

export function setActiveDay(day: number): void {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('active_day', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(day));
}

export function getMaxWaitMinutes(): number {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'max_wait_minutes'").get() as any;
  return row ? parseInt(row.value, 10) : 30;
}

export function setMaxWaitMinutes(minutes: number): void {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('max_wait_minutes', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(minutes));
}

export function getMeetingLeadMinutes(): number {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'meeting_lead_minutes'").get() as any;
  return row ? parseInt(row.value, 10) : 5;
}

export function setMeetingLeadMinutes(minutes: number): void {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('meeting_lead_minutes', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(minutes));
}

