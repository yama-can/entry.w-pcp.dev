import assert from 'node:assert';

const API_BASE = 'http://127.0.0.1:4000';

async function waitForServer() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`${API_BASE}/api/games`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Server did not become ready');
}

async function test() {
  await waitForServer();
  console.log('--- 0. Server Ready ---');

  // スロット一覧取得
  const assignRes = await fetch(`${API_BASE}/api/assignment/status`).then((r) => r.json());
  assert(assignRes.success, 'assignment/status should succeed');

  let openSlot = assignRes.slots.find((s) => !s.is_closed);
  if (!openSlot) {
    // スロットが全て確定済みなら生成
    await fetch(`${API_BASE}/api/slots/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 5, seatsPerSlot: 6, startHour: 10, startMinute: 0 }),
    });
    const freshRes = await fetch(`${API_BASE}/api/assignment/status`).then((r) => r.json());
    openSlot = freshRes.slots.find((s) => !s.is_closed);
  }
  assert(openSlot, 'Should find an open slot');
  console.log(`--- 1. Testing Empty Slot Skipping on slot ${openSlot.id} (${openSlot.lane}組 ${openSlot.slot_time}) ---`);

  // 空枠スキップ（fill-slot を0名状態で実行）
  const fillRes = await fetch(`${API_BASE}/api/assignment/fill-slot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slotId: openSlot.id }),
  }).then((r) => r.json());

  assert(fillRes.success, 'fill-slot should succeed even if 0 tickets assigned (skip)');
  console.log('Fill/Skip result:', fillRes.message);

  // 再度スロット状態を確認
  const verifyRes = await fetch(`${API_BASE}/api/assignment/status`).then((r) => r.json());
  const skippedSlot = verifyRes.slots.find((s) => s.id === openSlot.id);
  assert(skippedSlot.is_closed, 'Slot should now be closed (skipped)');
  console.log('Verified: Slot is_closed =', skippedSlot.is_closed);

  // 割当解除（復元）
  const unfillRes = await fetch(`${API_BASE}/api/assignment/unfill-slot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slotId: openSlot.id }),
  }).then((r) => r.json());
  assert(unfillRes.success, 'unfill-slot should succeed');
  console.log('Unfill result:', unfillRes.message);

  console.log('--- 2. Testing Shift Delay (Schedule Delay / Oshi) API ---');
  // 直近スロットを +2分 シフト
  const shiftRes = await fetch(`${API_BASE}/api/slots/shift-delay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromSlotId: openSlot.id, shiftMinutes: 2 }),
  }).then((r) => r.json());
  assert(shiftRes.success, 'shift-delay should succeed');
  console.log('Shift delay result:', shiftRes.message);

  // 元に戻す (-2分 シフト)
  const revertShiftRes = await fetch(`${API_BASE}/api/slots/shift-delay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromSlotId: openSlot.id, shiftMinutes: -2 }),
  }).then((r) => r.json());
  assert(revertShiftRes.success, 'revert shift-delay should succeed');
  console.log('Revert shift delay result:', revertShiftRes.message);

  console.log('\nAll Skip & Scheduler (Delay Management) Backend Tests PASSED!');
}

test().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
