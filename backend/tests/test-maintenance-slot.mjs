import assert from 'node:assert';
import { createTestServer } from './helpers.mjs';

async function runTest() {
  console.log('--- 1. インプロセス・テストサーバー起動 ---');
  const appServer = await createTestServer();
  const { fetch: apiFetch, loginAdmin, close } = appServer;

  try {
    console.log(`サーバー起動完了 (Port: ${appServer.port})`);

    const { headers: adminHeaders } = await loginAdmin('admin');
    assert(adminHeaders.Authorization, '管理者ログイン成功');

    console.log('--- 2. テスト用 Day 2 の初期化 ---');
    appServer.cleanTestDay(2);
    await apiFetch('/api/day/switch', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ day: 2 }),
    });

    // スロット生成: 3枠（枠0: 10:00 通常枠 2席, 枠1: 10:07 メンテ枠 2席, 枠2: 10:14 通常枠 2席）
    await apiFetch('/api/slots/generate', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        day: 2,
        count: 3,
        seatsPerSlot: 2,
        startHour: 10,
        startMinute: 0,
        lanes: ['A'],
        playDuration: 5,
        cleanupDuration: 2,
      }),
    });

    let assignStatus = await apiFetch('/api/assignment/status?day=2').then((r) => r.json());
    const [slot0, slot1, slot2] = assignStatus.slots;

    console.log('--- 3. 枠1をメンテナンス枠に設定 ---');
    const toggleRes = await apiFetch('/api/slots/toggle-maintenance', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ slotId: slot1.id, isMaintenance: true }),
    }).then((r) => r.json());
    assert.strictEqual(toggleRes.success, true);
    assert.strictEqual(toggleRes.is_maintenance, true);

    assignStatus = await apiFetch('/api/assignment/status?day=2').then((r) => r.json());
    const targetSlot1 = assignStatus.slots.find((s) => s.id === slot1.id);
    assert.strictEqual(targetSlot1.is_maintenance, true, '枠1がメンテナンス枠として認識されている');
    assert.strictEqual(targetSlot1.canFill, false, 'メンテナンス枠は canFill = false');
    assert.strictEqual(targetSlot1.plannedSeats.length, 0, 'メンテナンス枠の plannedSeats は空');

    console.log('--- 4. 整理券の発券（メンテナンス枠が発券対象外としてスキップされるか） ---');
    const games = await apiFetch('/api/games').then((r) => r.json());
    const gameId = games.games[0].id;

    // No.1, No.2 -> 枠0 (10:00 予定)
    const t1 = await apiFetch('/api/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, day: 2 }),
    }).then((r) => r.json());
    assert.strictEqual(t1.ticket.expected_slot_time, '10:00', '1枚目は枠0 (10:00)');

    const t2 = await apiFetch('/api/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, day: 2 }),
    }).then((r) => r.json());
    assert.strictEqual(t2.ticket.expected_slot_time, '10:00', '2枚目は枠0 (10:00)');

    // No.3 -> 枠1(メンテ枠)をスキップして 枠2 (10:14) に発券されるべき！
    const t3 = await apiFetch('/api/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, day: 2 }),
    }).then((r) => r.json());
    console.log(`t3の発券枠時刻: ${t3.ticket.expected_slot_time}`);
    assert.strictEqual(t3.ticket.expected_slot_time, '10:14', 'メンテ枠(10:07)はスキップされ、枠2(10:14)に発券された');
    assert.strictEqual(t3.ticket.expected_slot_id, slot2.id, 't3の予定枠IDは枠2');

    console.log('--- 5. 早着客チェックイン時、メンテナンス枠に客が入らないことの検証 ---');
    // 全員チェックイン
    await apiFetch('/api/checkin/mark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketNumber: t1.ticket.ticket_number, status: 'checked_in' }),
    });
    await apiFetch('/api/checkin/mark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketNumber: t2.ticket.ticket_number, status: 'checked_in' }),
    });
    // t3 は 10:14 枠だが早着チェックイン
    await apiFetch('/api/checkin/mark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketNumber: t3.ticket.ticket_number, status: 'checked_in' }),
    });

    assignStatus = await apiFetch('/api/assignment/status?day=2').then((r) => r.json());
    const s0After = assignStatus.slots.find((s) => s.id === slot0.id);
    const s1After = assignStatus.slots.find((s) => s.id === slot1.id);
    const s2After = assignStatus.slots.find((s) => s.id === slot2.id);

    console.log(`枠0 計画割当数: ${s0After.plannedSeats.length}`);
    console.log(`枠1(メンテ枠) 計画割当数: ${s1After.plannedSeats.length}`);
    console.log(`枠2 計画割当数: ${s2After.plannedSeats.length}`);

    assert.strictEqual(s0After.plannedSeats.length, 2, '枠0には定刻客2名が割当');
    assert.strictEqual(s1After.plannedSeats.length, 0, '枠1(メンテ枠)には早着客も含めて割当ゼロ！');
    assert.strictEqual(s1After.canFill, false, '枠1(メンテ枠)は canFill = false');

    console.log('--- 6. メンテナンス枠への fill-slot 実行が拒絶されることの検証 ---');
    const fillRes = await apiFetch('/api/assignment/fill-slot', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ slotId: slot1.id, day: 2 }),
    });
    assert.strictEqual(fillRes.status, 400, 'メンテ枠への確定実行は HTTP 400 で遮断される');
    const fillErr = await fillRes.json();
    console.log(`fill-slot エラーメッセージ: ${fillErr.message}`);
    assert(fillErr.message.includes('メンテナンス枠'), 'エラーメッセージにメンテナンス枠の言及がある');

    console.log('--- 7. メンテナンス枠の解除（通常枠化）時の動作検証 ---');
    // 枠0を確定・案内完了にする
    await apiFetch('/api/assignment/fill-slot', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ slotId: slot0.id, day: 2 }),
    });

    // 枠1のメンテ枠を解除
    await apiFetch('/api/slots/toggle-maintenance', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ slotId: slot1.id, isMaintenance: false }),
    });

    assignStatus = await apiFetch('/api/assignment/status?day=2').then((r) => r.json());
    const s1Restored = assignStatus.slots.find((s) => s.id === slot1.id);
    console.log(`メンテ解除後の枠1 計画割当数: ${s1Restored.plannedSeats.length}`);
    assert.strictEqual(s1Restored.is_maintenance, false, 'メンテフラグが false に戻っている');
    assert.strictEqual(s1Restored.plannedSeats.length, 1, '通常枠に戻ったことで早着客t3が前倒し割当された');
    assert.strictEqual(s1Restored.plannedSeats[0].assignmentType, 'advanced', '割当タイプが advanced');

    console.log('--- 8. クリーンアップ (Day 1 に復帰) ---');
    await apiFetch('/api/day/switch', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ day: 1 }),
    });

    console.log('🎉 すべてのテストに合格しました！');
  } finally {
    await close();
  }
}

runTest().catch((err) => {
  console.error('❌ テスト失敗:', err);
  process.exit(1);
});
