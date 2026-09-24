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

  // テスト用初期化: Day 2 を使ってクリーンな状態で検証
  const switchRes = await fetch(`${API_BASE}/api/day/switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day: 2 }),
  }).then(r => r.json());
  console.log('Day switch res:', switchRes);

  console.log('--- 1. Testing Issue Rejection when NO SLOTS exist ---');
  const issueNoSlotRes = await fetch(`${API_BASE}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'ACT_01' }),
  });
  const noSlotData = await issueNoSlotRes.json();
  if (!noSlotData.success) {
    console.log('Success: Correctly rejected with message:', noSlotData.message);
    assert(noSlotData.reason === 'NO_SLOTS' || noSlotData.reason === 'FULL');
  }

  console.log('--- 2. Generate a Small Slot Set (1 slot, 2 seats) ---');
  // 1枠2席のスロットを10:00開始で生成
  const genRes = await fetch(`${API_BASE}/api/slots/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      day: 2,
      count: 1,
      seatsPerSlot: 2,
      startHour: 10,
      startMinute: 0,
      lanes: ['A'],
      playDuration: 5,
      cleanupDuration: 2,
    }),
  }).then(r => r.json());
  console.log('Generate slots res:', genRes);

  // 待ち時間上限を無制限（0）にして満席テスト
  await fetch(`${API_BASE}/api/settings/max-wait`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxWaitMinutes: 0 }),
  });

  // 発券状況の確認: canIssue should be true
  const st1 = await fetch(`${API_BASE}/api/issue/status`).then(r => r.json());
  console.log('DEBUG st1:', st1);
  assert(st1.canIssue === true, 'Should be allowed to issue for available seat 1');
  console.log('Status before issue:', st1.message);

  // 1枚目発券
  const t1Res = await fetch(`${API_BASE}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'ACT_01' }),
  });
  const t1 = await t1Res.json();
  assert(t1.success, 'Ticket 1 should succeed');
  console.log(`Issued Ticket 1: No. ${t1.ticket.ticket_number}`);

  // 2枚目発券
  const t2Res = await fetch(`${API_BASE}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'PUZ_01' }),
  });
  const t2 = await t2Res.json();
  assert(t2.success, 'Ticket 2 should succeed');
  console.log(`Issued Ticket 2: No. ${t2.ticket.ticket_number}`);

  console.log('--- 3. Testing Issue Rejection on FULL Capacity (Illegal Reservation Block) ---');
  // 3枚目発券を試行（定員2席に対して3枚目）➔ 拒否されるべき！
  const t3Res = await fetch(`${API_BASE}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'RPG_01' }),
  });
  assert.strictEqual(t3Res.status, 400, '3rd ticket issue should be HTTP 400 Bad Request');
  const t3 = await t3Res.json();
  assert(!t3.success, '3rd ticket issue should fail');
  assert.strictEqual(t3.reason, 'FULL', 'Reason should be FULL');
  console.log('Success: Correctly blocked 3rd ticket! Message:', t3.message);

  console.log('--- 4. Testing Max Wait Limit Rejection ---');
  // 枠を追加して（例えば11:00開始で待ち時間が大きくなるように設定）
  await fetch(`${API_BASE}/api/slots/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      count: 2,
      seatsPerSlot: 1,
      startHour: 10,
      startMinute: 0,
      inputLanes: ['A'],
      playDuration: 30, // 1枠30分
      cleanupDuration: 10,
    }),
  });

  // 最大許容待ち時間を 15 分に設定
  await fetch(`${API_BASE}/api/settings/max-wait`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxWaitMinutes: 15 }),
  });

  // 1枚目発券（10:00枠用、待ち時間0分想定）
  const waitT1Res = await fetch(`${API_BASE}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'ACT_01', simulatedTime: '10:00' }),
  });
  const waitT1 = await waitT1Res.json();
  assert(waitT1.success, '1st ticket within wait limit should succeed');
  console.log(`Issued Ticket in 10:00 slot: No. ${waitT1.ticket.ticket_number}`);

  // 2枚目発券（次の席は10:40開始枠。10:00からの待ち時間は40分 > 上限15分）➔ 拒否されるべき！
  const waitT2Res = await fetch(`${API_BASE}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'ACT_01', simulatedTime: '10:00' }),
  });
  assert.strictEqual(waitT2Res.status, 400, 'Issue exceeding max wait should be HTTP 400');
  const waitT2 = await waitT2Res.json();
  assert(!waitT2.success, 'Should fail due to WAIT_LIMIT_EXCEEDED');
  assert.strictEqual(waitT2.reason, 'WAIT_LIMIT_EXCEEDED');
  console.log('Success: Correctly blocked over-wait issue! Message:', waitT2.message);

  console.log('--- 5. Testing Closed Slot Re-assignment Rejection ---');
  const assignRes = await fetch(`${API_BASE}/api/assignment/status`).then(r => r.json());
  const openSlot = assignRes.slots[0];
  assert(openSlot, 'Should find slot');

  // スロットをスキップ（クローズ）
  await fetch(`${API_BASE}/api/assignment/fill-slot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slotId: openSlot.id }),
  });

  // 既にクローズされたスロットに対して再度 fill-slot ➔ 400拒否されるべき！
  const doubleFillRes = await fetch(`${API_BASE}/api/assignment/fill-slot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slotId: openSlot.id }),
  });
  assert.strictEqual(doubleFillRes.status, 400, 'Re-assignment to closed slot should be HTTP 400');
  const doubleFill = await doubleFillRes.json();
  assert(!doubleFill.success);
  console.log('Success: Correctly blocked assignment to closed slot! Message:', doubleFill.message);

  // Day 1 に戻す
  await fetch(`${API_BASE}/api/day/switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day: 1 }),
  });

  console.log('\nAll Illegal Reservation Prevention Tests PASSED!');
}

test().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
