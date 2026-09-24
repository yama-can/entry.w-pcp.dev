async function testCloseFlow() {
  const baseUrl = 'http://127.0.0.1:4000';
  console.log('--- Testing Slot Close & Bump Flow ---');

  // 1. スロット生成 (4枠、bufferInterval: 3 -> 3枠目がバッファ枠)
  const gen = await fetch(`${baseUrl}/api/slots/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startHour: 10, startMinute: 0, count: 4, seatsPerSlot: 2, bufferInterval: 3 })
  }).then(r => r.json());
  console.log('1. Generated slots with buffer:', gen.success);

  // タイムライン確認
  const tl = await fetch(`${baseUrl}/api/timeline`).then(r => r.json());
  console.log('Slot 0 buffer?', tl.timeline[0].is_buffer); // false
  console.log('Slot 2 buffer?', tl.timeline[2].is_buffer); // true (3番目の枠)

  // 2. 発券
  // Slot 0 Seat 1
  const t1 = await fetch(`${baseUrl}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'ACT_01' })
  }).then(r => r.json());
  // Slot 0 Seat 2
  const t2 = await fetch(`${baseUrl}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'PUZ_01' })
  }).then(r => r.json());
  // Slot 1 Seat 1 (後続枠)
  const t3 = await fetch(`${baseUrl}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'RPG_01' })
  }).then(r => r.json());

  console.log('Tickets issued:');
  console.log('  t1:', t1.ticket.ticket_code, t1.ticket.slot_time);
  console.log('  t2:', t2.ticket.ticket_code, t2.ticket.slot_time);
  console.log('  t3:', t3.ticket.ticket_code, t3.ticket.slot_time);

  // 3. 点呼状況
  // t1: 到着 (checked_in)
  await fetch(`${baseUrl}/api/checkin/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reservationId: t1.ticket.reservation_id })
  });
  // t2: 未着のまま (booked)
  // t3: 後続枠だが早めに来て到着済み！ (checked_in)
  await fetch(`${baseUrl}/api/checkin/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reservationId: t3.ticket.reservation_id })
  });

  // 4. Slot 0 を「締め切り」！
  const closeRes = await fetch(`${baseUrl}/api/slots/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slotId: tl.timeline[0].id })
  }).then(r => r.json());

  console.log('Close Result:', JSON.stringify(closeRes.result, null, 2));
  console.log('  lateCount (未着保留):', closeRes.result.lateCount, '(expected 1)');
  console.log('  bumpedCount (繰り上げ):', closeRes.result.bumpedCount, '(expected 1)');

  // 5. 保留キュー確認
  const lateList = await fetch(`${baseUrl}/api/late-queue`).then(r => r.json());
  console.log('Late Queue count:', lateList.list.length, 'ticket:', lateList.list[0]?.original_ticket_code);

  // 6. 遅刻者が後から到着 -> 空き枠へ再割り当て！
  const reassignRes = await fetch(`${baseUrl}/api/late-queue/reassign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lateId: lateList.list[0].id })
  }).then(r => r.json());
  console.log('Reassigned latecomer:', reassignRes);

  console.log('--- All Close Flow Tests Completed ---');
}

testCloseFlow().catch(console.error);

