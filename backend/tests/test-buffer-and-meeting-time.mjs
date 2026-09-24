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

  // 管理者ログイン
  const loginRes = await fetch(`${API_BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'admin' }),
  });
  const loginData = await loginRes.json();
  assert(loginData.token, 'Should obtain admin token');
  const adminHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${loginData.token}`,
  };

  // テスト用初期化: Day 2 を使って検証
  await fetch(`${API_BASE}/api/day/switch`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ day: 2 }),
  });

  // 集合リードタイムを 5分 に設定
  await fetch(`${API_BASE}/api/settings/meeting-lead`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ meetingLeadMinutes: 5 }),
  });

  const settings = await fetch(`${API_BASE}/api/settings`).then(r => r.json());
  assert.strictEqual(settings.meetingLeadMinutes, 5, 'meetingLeadMinutes should be 5');
  console.log('--- 1. Settings Verified: meetingLeadMinutes = 5 ---');

  // スロット生成: 3枠（枠0: 10:00 A組, 枠1: 10:03 B組 [調整枠化予定], 枠2: 10:06 A組）、各2席
  await fetch(`${API_BASE}/api/slots/generate`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      day: 2,
      count: 3,
      seatsPerSlot: 2,
      startHour: 10,
      startMinute: 0,
      lanes: ['A', 'B'],
      playDuration: 5,
      cleanupDuration: 2,
    }),
  });

  let assignStatus = await fetch(`${API_BASE}/api/assignment/status?day=2`).then(r => r.json());
  assert.strictEqual(assignStatus.slots.length, 3, 'Should have 3 slots');
  const [slot0, slot1, slot2] = assignStatus.slots;
  console.log(`Generated slots: Slot0=${slot0.slot_time}, Slot1=${slot1.slot_time}, Slot2=${slot2.slot_time}`);

  // 枠1 (10:03) を「調整枠」にする
  await fetch(`${API_BASE}/api/slots/toggle-buffer`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ slotId: slot1.id }),
  });

  console.log('--- 2. Buffer Slot Toggled for Slot 1 (10:03) ---');

  // 予約時（発券時）に調整枠（Slot 1）が無視されているかを検証！
  // 定員: Slot 0 (2席) + Slot 2 (2席) = 4席（Slot 1 の2席は除外！）
  // 1枚目発券 -> 予定枠は Slot 0 (10:00)
  const t1 = await fetch(`${API_BASE}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'ACT_01', day: 2 }),
  }).then(r => r.json());
  assert(t1.success);
  assert.strictEqual(t1.ticket.expected_slot_id, slot0.id, 'T1 expected slot should be Slot 0');
  assert.strictEqual(t1.ticket.expected_slot_time, slot0.slot_time);
  console.log(`Issued T1: expected slot ${t1.ticket.expected_slot_time}`);

  // 2枚目発券 -> 予定枠は Slot 0 (10:00)
  const t2 = await fetch(`${API_BASE}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'ACT_01', day: 2 }),
  }).then(r => r.json());
  assert(t2.success);
  assert.strictEqual(t2.ticket.expected_slot_id, slot0.id, 'T2 expected slot should be Slot 0');
  console.log(`Issued T2: expected slot ${t2.ticket.expected_slot_time}`);

  // ★ 3枚目発券 -> 調整枠（Slot 1: 10:03）を無視して Slot 2 (10:06) になるはず！
  const t3 = await fetch(`${API_BASE}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'ACT_01', day: 2 }),
  }).then(r => r.json());
  assert(t3.success);
  assert.strictEqual(t3.ticket.expected_slot_id, slot2.id, 'T3 MUST skip buffer slot1 and jump to Slot 2 (10:06)!');
  assert.strictEqual(t3.ticket.expected_slot_time, slot2.slot_time);
  console.log(`★ PASS: T3 skipped buffer slot and expected slot is ${t3.ticket.expected_slot_time} (Slot 2)!`);

  // 4枚目発券 -> 予定枠は Slot 2 (10:06)
  const t4 = await fetch(`${API_BASE}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'ACT_01', day: 2 }),
  }).then(r => r.json());
  assert(t4.success);
  assert.strictEqual(t4.ticket.expected_slot_id, slot2.id, 'T4 expected slot should be Slot 2');
  console.log(`Issued T4: expected slot ${t4.ticket.expected_slot_time}`);

  // 5枚目発券 -> 通常枠4席が埋まったため、調整枠を除外して満席（FULL）で拒否されるはず！
  const t5 = await fetch(`${API_BASE}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'ACT_01', day: 2 }),
  }).then(r => r.json());
  assert(!t5.success, '5th ticket issue must be rejected as FULL because buffer slot is ignored');
  assert.strictEqual(t5.reason, 'FULL');
  console.log('★ PASS: Correctly blocked 5th ticket as FULL (buffer slot ignored in reservation)!');

  console.log('--- 3. Testing Meeting Time and Assignment Logic ---');
  // Check assignment status at simulated time 09:56 (Slot 0 is 10:00 -> meeting time is 09:55 -> reached)
  const assignAt0956 = await fetch(`${API_BASE}/api/assignment/status?day=2&simulatedTime=09:56`).then(r => r.json());
  const s0At0956 = assignAt0956.slots.find(s => s.id === slot0.id);
  assert.strictEqual(s0At0956.meeting_time, '09:55');
  assert.strictEqual(s0At0956.is_meeting_reached, true, 'Meeting time 09:55 reached at 09:56');

  // Check at simulated time 09:50 (meeting time 09:55 -> not reached)
  const assignAt0950 = await fetch(`${API_BASE}/api/assignment/status?day=2&simulatedTime=09:50`).then(r => r.json());
  const s0At0950 = assignAt0950.slots.find(s => s.id === slot0.id);
  assert.strictEqual(s0At0950.is_meeting_reached, false, 'Meeting time 09:55 not reached at 09:50');
  console.log('★ PASS: meeting_time and is_meeting_reached calculation verified!');

  // --- 4. 前倒し・前詰め割当と「予定枠優先」の検証 ---
  console.log('--- 4. Testing Advance Filling & Expected Slot Priority ---');

  // Case 1: T3 (10:06枠の人) だけが先にチェックイン
  // Slot 0 (10:00) に空席があるため、T3 は Slot 0 に「前倒し（advanced）」で前詰めで入る！
  await fetch(`${API_BASE}/api/checkin/mark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketNumber: t3.ticket.ticket_number, status: 'checked_in' }),
  });

  const assignWithEarlyT3 = await fetch(`${API_BASE}/api/assignment/status?day=2`).then(r => r.json());
  const s0Check1 = assignWithEarlyT3.slots.find(s => s.id === slot0.id);
  assert.strictEqual(s0Check1.plannedSeats.length, 1, 'Slot 0 should take early T3 into its empty seat (front-filling)');
  assert.strictEqual(s0Check1.plannedSeats[0].ticketNumber, t3.ticket.ticket_number);
  assert.strictEqual(s0Check1.plannedSeats[0].assignmentType, 'advanced', 'T3 should be marked as advanced assignment');
  console.log('★ PASS: Early arrival T3 correctly front-filled into Slot 0 as advanced assignment!');

  // Case 2: Slot 0 (10:00) 本来の予定客 T1 が遅れてチェックイン
  // 予定客 T1 が最優先で Slot 0 の席を確保し、T3 も Slot 0 の2席目に前倒しで残る（Slot 0 は T1, T3 で2席満席）
  await fetch(`${API_BASE}/api/checkin/mark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketNumber: t1.ticket.ticket_number, status: 'checked_in' }),
  });

  const assignWithT1 = await fetch(`${API_BASE}/api/assignment/status?day=2`).then(r => r.json());
  const s0Check2 = assignWithT1.slots.find(s => s.id === slot0.id);
  assert.strictEqual(s0Check2.plannedSeats.length, 2, 'Slot 0 should have 2 planned seats (T1 + T3)');
  assert.strictEqual(s0Check2.plannedSeats[0].ticketNumber, t1.ticket.ticket_number, 'T1 (expected) has priority 1');
  assert.strictEqual(s0Check2.plannedSeats[0].assignmentType, 'on_time', 'T1 is on_time');
  assert.strictEqual(s0Check2.plannedSeats[1].ticketNumber, t3.ticket.ticket_number, 'T3 is advanced');
  console.log('★ PASS: Slot 0 prioritized expected ticket T1 and filled remaining seat with T3!');

  // Slot 0 を確定（fill-slot）
  const fillS0 = await fetch(`${API_BASE}/api/assignment/fill-slot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slotId: slot0.id }),
  }).then(r => r.json());
  assert(fillS0.success);
  assert.strictEqual(fillS0.assignedCount, 2, 'Slot 0 filled with 2 tickets (T1 and T3)');
  console.log('★ PASS: Slot 0 filled successfully with T1 and T3!');

  // Case 3: 遅延者と予定枠優先の検証
  // Slot 0 で来なかった T2 (10:00枠の遅延者) が今チェックイン。
  // そして Slot 2 (10:06枠) 本来の予定客 T4 もチェックイン。
  await fetch(`${API_BASE}/api/checkin/mark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketNumber: t2.ticket.ticket_number, status: 'checked_in' }),
  });
  await fetch(`${API_BASE}/api/checkin/mark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketNumber: t4.ticket.ticket_number, status: 'checked_in' }),
  });

  const assignWithT2T4 = await fetch(`${API_BASE}/api/assignment/status?day=2`).then(r => r.json());
  const s1Check = assignWithT2T4.slots.find(s => s.id === slot1.id); // 調整枠 (10:03)
  const s2Check = assignWithT2T4.slots.find(s => s.id === slot2.id); // 通常枠 (10:06)

  // 新仕様: 調整枠 Slot 1 には遅延客 T2 (buffer) と早着客 T4 (advanced) が挿入される！
  assert.strictEqual(s1Check.plannedSeats.length, 2, 'Buffer Slot 1 takes delayed T2 and advance T4');
  assert.strictEqual(s1Check.plannedSeats[0].ticketNumber, t2.ticket.ticket_number, 'Slot 1 takes T2');
  assert.strictEqual(s1Check.plannedSeats[0].assignmentType, 'buffer', 'Assigned into buffer slot');
  assert.strictEqual(s1Check.plannedSeats[1].ticketNumber, t4.ticket.ticket_number, 'Slot 1 takes T4 as advanced');
  assert.strictEqual(s1Check.plannedSeats[1].assignmentType, 'advanced', 'T4 advance into buffer slot');
  console.log('★ PASS: Delayed ticket T2 and advance ticket T4 both accommodated into buffer Slot 1!');

  // 調整枠 Slot 1 を確定（fill-slot）
  const fillS1 = await fetch(`${API_BASE}/api/assignment/fill-slot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slotId: slot1.id }),
  }).then(r => r.json());
  assert(fillS1.success);
  assert.strictEqual(fillS1.assignedCount, 2, 'Buffer slot 1 filled with 2 tickets (T2 delayed and T4 advance)');
  console.log('★ PASS: Buffer slot 1 filled successfully with delayed T2 and advance T4!');

  // Slot 2 を確定（fill-slot）
  const fillS2 = await fetch(`${API_BASE}/api/assignment/fill-slot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slotId: slot2.id }),
  }).then(r => r.json());
  assert(fillS2.success);
  console.log('★ PASS: Slot 2 filled successfully!');

  // Day 1 に戻す
  await fetch(`${API_BASE}/api/day/switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day: 1 }),
  });

  console.log('\nAll Buffer Slot, Advance Filling & Priority Tests PASSED successfully!');
}

test().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});

