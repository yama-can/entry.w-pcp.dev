import assert from 'node:assert';
import { createTestServer } from './helpers.mjs';

async function runTest() {
  console.log('--- 1. インプロセス・テストサーバー起動 ---');
  const appServer = await createTestServer();
  const { fetch: apiFetch, loginAdmin, close, cleanTestDay } = appServer;

  try {
    console.log(`サーバー起動完了 (Port: ${appServer.port})`);

    // 管理者ログイン
    const { headers: adminHeaders } = await loginAdmin('admin');
    assert(adminHeaders.Authorization, '管理者ログイン成功');

    console.log('--- 2. テスト用 Day 2 の初期化 ---');
    cleanTestDay(2);
    const switchRes = await apiFetch('/api/day/switch', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ day: 2 }),
    }).then((r) => r.json());
    assert(switchRes.success, 'Day 2 への切り替え成功');

    // スロット生成: 3枠（枠0: 10:00 通常枠 2席, 枠1: 10:07 調整枠 2席, 枠2: 10:14 通常枠 2席）
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

    // 枠1を調整枠に設定
    await apiFetch('/api/slots/toggle-buffer', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ slotId: slot1.id, isBuffer: true }),
    });
    console.log(`スロット設定完了: 枠0(ID:${slot0.id}, ${slot0.slot_time}, 通常枠), 枠1(ID:${slot1.id}, ${slot1.slot_time}, 調整枠), 枠2(ID:${slot2.id}, ${slot2.slot_time}, 通常枠)`);

    console.log('--- 3. 整理券の発券 ---');
    const games = await apiFetch('/api/games').then((r) => r.json());
    const gameId = games.games[0].id;

    // 3枚発券:
    // No.1 -> 枠0 (10:00 予定)
    // No.2 -> 枠0 (10:00 予定)
    // No.3 -> 枠2 (10:14 予定、調整枠はスキップ)
    const t1 = await apiFetch('/api/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, day: 2 }),
    }).then((r) => r.json());

    const t2 = await apiFetch('/api/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, day: 2 }),
    }).then((r) => r.json());

    const t3 = await apiFetch('/api/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, day: 2 }),
    }).then((r) => r.json());

    assert.strictEqual(t1.ticket.ticket_number, 1);
    assert.strictEqual(t2.ticket.ticket_number, 2);
    assert.strictEqual(t3.ticket.ticket_number, 3);
    console.log(`発券完了: No.${t1.ticket.ticket_number}, No.${t2.ticket.ticket_number}, No.${t3.ticket.ticket_number}`);

    console.log('--- 4. スロット0の確定閉鎖（これで3名とも遅刻・遅延者となる） ---');
    await apiFetch('/api/slots/close', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ slotId: slot0.id }),
    });

    console.log('--- 5. 遅刻者の受付（番号と到着順序を逆転させて到着） ---');
    // あえて No.2 を先に到着受付させる (checked_in)
    const checkin2 = await apiFetch('/api/checkin/mark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketNumber: t2.ticket.ticket_number, status: 'checked_in' }),
    }).then((r) => r.json());

    console.log(`No.2 受付レスポンス: ${checkin2.message}`);
    assert.strictEqual(checkin2.isDelayed, true, 'No.2 は遅刻者');
    assert.strictEqual(checkin2.bufferSummary.canAccommodate, true, '調整枠（残2席）で収容可能判定');
    assert.strictEqual(checkin2.bufferSummary.remainingBufferSeats, 2, '調整枠残席は2');
    assert(checkin2.message.includes('確実に案内可能'), '受付時に案内可能メッセージが出力されていること');

    // 次に No.1 を到着受付させる (No.2 より遅れて到着)
    await new Promise((r) => setTimeout(r, 50));
    const checkin1 = await apiFetch('/api/checkin/mark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketNumber: t1.ticket.ticket_number, status: 'checked_in' }),
    }).then((r) => r.json());

    console.log(`No.1 受付レスポンス: ${checkin1.message}`);
    assert.strictEqual(checkin1.isDelayed, true, 'No.1 は遅刻者');
    assert.strictEqual(checkin1.bufferSummary.canAccommodate, true, '2人目も調整枠残2席に収容可能');
    assert.strictEqual(checkin1.bufferSummary.unassignedDelayedCount, 2, '到着済みの未割当遅刻者が2名');

    console.log('--- 6. 受付リスト API の調整枠サマリー検証 ---');
    const checkinList = await apiFetch('/api/checkin/list?day=2').then((r) => r.json());
    assert(checkinList.success);
    assert.strictEqual(checkinList.bufferSummary.remainingBufferSlots, 1);
    assert.strictEqual(checkinList.bufferSummary.remainingBufferSeats, 2);
    assert.strictEqual(checkinList.bufferSummary.unassignedDelayedCount, 2);
    assert.strictEqual(checkinList.bufferSummary.canAccommodate, true);
    console.log('受付サマリー検証成功:', checkinList.bufferSummary);

    console.log('--- 7. 割当ステータス API での「早く来た順」割当検証 ---');
    assignStatus = await apiFetch('/api/assignment/status?day=2').then((r) => r.json());
    const targetBufferSlot = assignStatus.slots.find((s) => s.id === slot1.id);

    console.log(`調整枠 割当プレビュー: Seat 1 = No.${targetBufferSlot.plannedSeats[0]?.ticketNumber}, Seat 2 = No.${targetBufferSlot.plannedSeats[1]?.ticketNumber}`);
    assert.strictEqual(targetBufferSlot.plannedSeats.length, 2, '調整枠に2名割当予定');
    // 到着が早かった No.2 が 1席目、後から来た No.1 が 2席目になっていることを確認！
    assert.strictEqual(targetBufferSlot.plannedSeats[0].ticketNumber, 2, '先に到着した No.2 が Seat 1 に割当');
    assert.strictEqual(targetBufferSlot.plannedSeats[1].ticketNumber, 1, '後に到着した No.1 が Seat 2 に割当');
    console.log('✓ 遅刻者の中で「早く到着した順」に調整枠へ割り当てられることを確認！');

    console.log('--- 8. 枠割当確定（fill-slot）での「早く来た順」確定検証 ---');
    const fillRes = await apiFetch('/api/assignment/fill-slot', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ slotId: slot1.id }),
    }).then((r) => r.json());
    assert(fillRes.success);
    assert.strictEqual(fillRes.assignedCount, 2);

    const filledSlot = await apiFetch('/api/assignment/status?day=2').then((r) => r.json());
    const finalBuffer = filledSlot.slots.find((s) => s.id === slot1.id);
    const seat1 = finalBuffer.seats.find((s) => s.seat_no === 1);
    const seat2 = finalBuffer.seats.find((s) => s.seat_no === 2);

    assert.strictEqual(seat1.ticket_number, 2, '確定後も Seat 1 は No.2 (早く来た順)');
    assert.strictEqual(seat2.ticket_number, 1, '確定後も Seat 2 は No.1 (早く来た順)');
    console.log('✓ 枠確定後も「早く到着した順」で座席が確定されていることを確認！');

    // クリーンアップ
    await apiFetch('/api/day/switch', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ day: 1 }),
    });

    console.log('\n========================================');
    console.log('★ 全ての検証項目（遅刻者受入確認 & 早く来た順割当）が正常に合格しました！');
    console.log('========================================');
  } finally {
    await close();
  }
}

runTest().catch((err) => {
  console.error('❌ テスト失敗:', err);
  process.exit(1);
});
