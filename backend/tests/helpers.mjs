import { app } from '../src/app.ts';
import { db, initDatabase } from '../src/db.ts';

/**
 * テスト専用のインプロセスサーバーを作成（ポート0で自動割当）
 * 高速かつポート競合・プロセス残存のリスクがゼロ。
 */
export async function createTestServer() {
  initDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 4000;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    server,
    port,
    baseUrl,
    /**
     * 指定パスにリクエストを送信
     */
    async fetch(path, options = {}) {
      return fetch(`${baseUrl}${path}`, options);
    },
    /**
     * 管理者ログインを実行してトークンとヘッダーを取得
     */
    async loginAdmin(password = 'admin') {
      const res = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      }).then((r) => r.json());

      if (!res.token) {
        throw new Error('管理者ログインに失敗しました: ' + (res.message || 'Unknown error'));
      }

      return {
        token: res.token,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${res.token}`,
        },
      };
    },
    /**
     * テスト対象日のチケットやキューをリセットして完全クリーンにする
     */
    cleanTestDay(day = 2) {
      db.prepare('DELETE FROM tickets WHERE day_id = ?').run(day);
      db.prepare('DELETE FROM late_queue WHERE day_id = ?').run(day);
    },
    /**
     * サーバーを正常終了
     */
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
