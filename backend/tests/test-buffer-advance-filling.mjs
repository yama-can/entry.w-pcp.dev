import assert from 'node:assert';
import { createTestServer } from './helpers.mjs';

async function runTest() {
  console.log('--- 1. インプロセス・テストサーバー起動 ---');
  const appServer = await createTestServer();
  const { fetch: apiFetch, loginAdmin, close, cleanTestDay } = appServer;

  try {
    console.log(`サーバー起動完了 (Port: ${appServer.port})`);

    const { headers: adminHeaders } = await loginAdmin('admin');
    assert(adminHeaders.Authorization, '管理者ログイン成功');

    console.log('--- 2. テスト用 Day 2 の初期化 ---');
    cleanTestDay(2);
    await apiFetch('/api/day/switch', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ day: 2 }),
    });

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
    console.log(`スロット設定完了: 枠0(ID:${slot0.id}, ${slot0.slot_time}), 枠1(ID:${slot1.id}, ${slot1.slot_time}, 調整枠), 枠2(ID:${slot2.id}, ${slot2.slot_time})`);

    console.log('--- 3. 整理券の発券 ---');
    const games = await apiFetch('/api/games').then((r) => r.json());
    const gameId = games.games[0].id;

    // 4枚発券:
    // No.1, No.2 -> 枠0 (10:00 予定)
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

    // No.3, No.4 -> 枠2 (10:14 予定、枠1の調整枠をスキップして枠2へ)
    const t3 = await apiFetch('/api/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, day: 2 }),
    }).then((r) => r.json());

    const t4 = await apiFetch('/api/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, day: 2 }),
    }).then((r) => r.json());

    assert.strictEqual(t3.ticket.expected_slot_id, slot2.id, 'T3 は調整枠をスキップして枠2(10:14)予定');
    console.log(`発券完了: T1=No.${t1.ticket.ticket_number}(10:00), T2=No.${t2.ticket.ticket_number}(10:00), T3=No.${t3.ticket.ticket_number}(10:14), T4=No.${t4.ticket.ticket_number}(10:14)`);

    console.log('--- 4. 枠0の確定閉鎖 ---');
    await apiFetch('/api/slots/close', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ slotId: slot0.id }),
    });

    console.log('--- 5. 受付チェックイン（遅刻客 No.1 と 早着客 No.3 が到着） ---');
    // 遅延客: No.1 (枠0を逃した遅刻客) が到着
    const markT1 = await apiFetch('/api/checkin/mark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketNumber: t1.ticket.ticket_number, status: 'checked_in' }),
    }).then((r) => r.json());
    assert(markT1.isDelayed, 'T1 は遅刻者として判定');

    // 早着客: No.3 (本来 10:14 予定だが早く到着) が到着
    const markT3 = await apiFetch('/api/checkin/mark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketNumber: t3.ticket.ticket_number, status: 'checked_in' }),
    }).then((r) => r.json());
    assert.strictEqual(markT3.isDelayed, false, 'T3 は早着（遅刻ではない）');

    console.log('--- 6. 調整枠（枠1, 10:07）への割当プレビュー検証 ---');
    assignStatus = await apiFetch('/api/assignment/status?day=2').then((r) => r.json());
    const bufferSlot = assignStatus.slots.find((s) => s.id === slot1.id);

    console.log(`調整枠 plannedSeats: ${JSON.stringify(bufferSlot.plannedSeats, null, 2)}`);
    assert.strictEqual(bufferSlot.plannedSeats.length, 2, '調整枠に2名割当予定が入っていること');

    const plannedT1 = bufferSlot.plannedSeats.find((p) => p.ticketNumber === t1.ticket.ticket_number);
    const plannedT3 = bufferSlot.plannedSeats.find((p) => p.ticketNumber === t3.ticket.ticket_number);

    assert(plannedT1, '遅延者 No.1 が調整枠に割り当てられていること');
    assert.strictEqual(plannedT1.assignmentType, 'buffer', 'No.1 の割当タイプは buffer');

    assert(plannedT3, '早着客 No.3 が調整枠に割り当てられていること（前倒し挿入）');
    assert.strictEqual(plannedT3.assignmentType, 'advanced', 'No.3 の割当タイプは advanced（早着前倒し）');

    console.log(`調整枠 Seat 1: No.${plannedT1.ticketNumber}, タイプ: ${plannedT1.assignmentType}`);
    console.log(`調整枠 Seat 2: No.${plannedT3.ticketNumber}, タイプ: ${plannedT3.assignmentType}`);
    console.log('✓ 調整枠に遅延者だけでなく「早着客」も前倒し挿入されることを確認！');

    console.log('--- 7. 調整枠の確定（fill-slot）検証 ---');
    const fillRes = await apiFetch('/api/assignment/fill-slot', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ slotId: slot1.id }),
    }).then((r) => r.json());

    assert(fillRes.success, 'fill-slot should succeed');
    assert.strictEqual(fillRes.assignedCount, 2, '2名が確定割り当てされたこと');

    // 確定後のスロット確認
    const finalAssign = await apiFetch('/api/assignment/status?day=2').then((r) => r.json());
    const finalBufferSlot = finalAssign.slots.find((s) => s.id === slot1.id);
    const assignedTicketNumbers = finalBufferSlot.seats.map((s) => s.ticket_number);
    assert(assignedTicketNumbers.includes(t1.ticket.ticket_number), 'No.1 が確定');
    assert(assignedTicketNumbers.includes(t3.ticket.ticket_number), 'No.3 (早着客) が確定');
    console.log('✓ 調整枠の確定でも早着客が正しく割当確定されました！');

    // クリーンアップ
    await apiFetch('/api/day/switch', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ day: 1 }),
    });

    console.log('\n========================================');
    console.log('★ PASS: 「調整枠への早着客の挿入」が正常に動作することを確認しました！');
    console.log('========================================');
  } finally {
    await close();
  }
}

runTest().catch((err) => {
  console.error('❌ テスト失敗:', err);
  process.exit(1);
});
