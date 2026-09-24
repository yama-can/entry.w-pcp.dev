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

  // Day 1 に切り替え
  await fetch(`${API_BASE}/api/day/switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day: 1 }),
  });

  // スロット生成（3枠: 10:00, 10:07, 10:14）
  await fetch(`${API_BASE}/api/slots/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      day: 1,
      count: 3,
      seatsPerSlot: 2,
      startHour: 10,
      startMinute: 0,
      lanes: ['A'],
      playDuration: 5,
      cleanupDuration: 2,
    }),
  });

  console.log('--- 1. Testing Ticket Issuance & Check-in Timestamps (Screen 2 Sort Order) ---');
  // チケット3枚発券
  const t1 = await fetch(`${API_BASE}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'ACT_01' }),
  }).then(r => r.json());

  // 少し待機して時間をずらす
  await new Promise(r => setTimeout(r, 100));

  const t2 = await fetch(`${API_BASE}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'PUZ_01' }),
  }).then(r => r.json());

  await new Promise(r => setTimeout(r, 100));

  const t3 = await fetch(`${API_BASE}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'RPG_01' }),
  }).then(r => r.json());

  // t1, t2, t3 の順にチェックイン
  await fetch(`${API_BASE}/api/checkin/mark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketNumber: t1.ticket.ticket_number, status: 'checked_in' }),
  });
  await new Promise(r => setTimeout(r, 100));

  await fetch(`${API_BASE}/api/checkin/mark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketNumber: t2.ticket.ticket_number, status: 'checked_in' }),
  });
  await new Promise(r => setTimeout(r, 100));

  await fetch(`${API_BASE}/api/checkin/mark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketNumber: t3.ticket.ticket_number, status: 'checked_in' }),
  });

  // checkin/list を取得
  const checkinRes = await fetch(`${API_BASE}/api/checkin/list`).then(r => r.json());
  assert(checkinRes.success);
  const checkedInList = checkinRes.tickets.filter(t => t.status === 'checked_in');

  // フロントエンドのソートロジックを検証:
  // 「最上部が最も遅い時刻」➔ checked_in_at の降順
  const sortedArrived = [...checkedInList].sort((a, b) => {
    if (a.checked_in_at && b.checked_in_at) {
      return new Date(b.checked_in_at).getTime() - new Date(a.checked_in_at).getTime();
    }
    return b.ticket_number - a.ticket_number;
  });

  console.log('Arrived sort order (latest check-in at top):');
  sortedArrived.forEach(t => console.log(`  No. ${t.ticket_number} (arrived at ${t.checked_in_at})`));

  assert.strictEqual(sortedArrived[0].ticket_number, t3.ticket.ticket_number, 'Latest check-in (t3) must be at index 0');
  assert.strictEqual(sortedArrived[2].ticket_number, t1.ticket.ticket_number, 'Earliest check-in (t1) must be at index 2');
  console.log('Verified: Screen 2 (CheckinTab) top item is the latest checkin time!');

  console.log('\n--- 2. Testing Screen 3 (AssignmentTab) Split & Sort Order ---');
  // スロット状態取得
  let assignStatus = await fetch(`${API_BASE}/api/assignment/status`).then(r => r.json());
  assert(assignStatus.slots.length === 3);

  // 1つ目のスロット（10:00）を割り当て確定
  await fetch(`${API_BASE}/api/assignment/fill-slot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slotId: assignStatus.slots[0].id }),
  });

  // 2つ目のスロット（10:07）も割り当て確定（スキップ含む）
  await fetch(`${API_BASE}/api/assignment/fill-slot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slotId: assignStatus.slots[1].id }),
  });

  // 再度スロット状態取得
  assignStatus = await fetch(`${API_BASE}/api/assignment/status`).then(r => r.json());

  // フロントエンドと同じ分割 & ソート処理
  const unassigned = assignStatus.slots.filter(s => !s.is_closed).sort((a, b) => a.order_idx - b.order_idx);
  const assigned = assignStatus.slots.filter(s => s.is_closed).sort((a, b) => {
    const [aH, aM] = a.slot_time.split(':').map(Number);
    const [bH, bM] = b.slot_time.split(':').map(Number);
    const aTotal = aH * 60 + aM;
    const bTotal = bH * 60 + bM;
    if (bTotal !== aTotal) return bTotal - aTotal; // 降順
    return b.order_idx - a.order_idx;
  });

  console.log(`Unassigned slots count: ${unassigned.length} (earliest slot: ${unassigned[0]?.slot_time})`);
  console.log('Assigned slots (latest at top):');
  assigned.forEach(s => console.log(`  Slot ${s.id} (${s.lane}組 ${s.slot_time})`));

  assert.strictEqual(unassigned.length, 1, 'Should have 1 unassigned slot');
  assert.strictEqual(unassigned[0].slot_time, '10:14', 'Unassigned slot should be 10:14');

  assert.strictEqual(assigned.length, 2, 'Should have 2 assigned slots');
  assert.strictEqual(assigned[0].slot_time, '10:07', 'Most recent assigned slot (10:07) MUST be at the top');
  assert.strictEqual(assigned[1].slot_time, '10:00', 'Older assigned slot (10:00) MUST be below');
  console.log('Verified: Screen 3 (AssignmentTab) split and assigned sort order is correct!');

  console.log('\nAll Sort Orders & Split Layout Tests PASSED!');
}

test().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});

