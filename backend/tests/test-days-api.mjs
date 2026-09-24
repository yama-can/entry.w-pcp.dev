async function testDaysFlow() {
  const baseUrl = 'http://127.0.0.1:4000';
  console.log('--- Testing 2-Day Separation & End-Time Generation ---');

  // 1. 現在のDay確認 & Day 1 に設定
  await fetch(`${baseUrl}/api/day/switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day: 1 })
  });

  const cur1 = await fetch(`${baseUrl}/api/day/current`).then(r => r.json());
  console.log('1. Active day is Day 1:', cur1.activeDay === 1);

  // 2. Day 1 に終了時刻指定でスロット生成 (10:00 〜 10:15 -> 5枠)
  const gen1 = await fetch(`${baseUrl}/api/slots/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startHour: 10, startMinute: 0, endHour: 10, endMinute: 15, seatsPerSlot: 2 })
  }).then(r => r.json());
  console.log('2. Day 1 generated with end-time (10:00-10:15):', gen1.count === 5, `count=${gen1.count}`);

  // Day 1 で発券
  const t1 = await fetch(`${baseUrl}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'ACT_01' })
  }).then(r => r.json());
  console.log('   Day 1 issued ticket:', t1.ticket.ticket_code);

  const tl1 = await fetch(`${baseUrl}/api/timeline`).then(r => r.json());
  console.log('   Day 1 timeline slots count:', tl1.timeline.length);

  // 3. Day 2 へ切り替え
  const sw2 = await fetch(`${baseUrl}/api/day/switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day: 2 })
  }).then(r => r.json());
  console.log('3. Switched to Day 2:', sw2.activeDay === 2);

  // Day 2 のタイムラインはまだ空
  const tl2_empty = await fetch(`${baseUrl}/api/timeline`).then(r => r.json());
  console.log('4. Day 2 timeline is empty before generation:', tl2_empty.timeline.length === 0);

  // 4. Day 2 にスロット生成 (09:30 〜 09:45 -> 5枠)
  const gen2 = await fetch(`${baseUrl}/api/slots/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startHour: 9, startMinute: 30, endHour: 9, endMinute: 45, seatsPerSlot: 2 })
  }).then(r => r.json());
  console.log('5. Day 2 generated (09:30-09:45):', gen2.count === 5);

  const tl2 = await fetch(`${baseUrl}/api/timeline`).then(r => r.json());
  console.log('   Day 2 timeline slots count:', tl2.timeline.length, 'first slot:', tl2.timeline[0]?.slot_time);

  // 5. ゲームマスタが Day 1 と共通で存在することを確認
  const games = await fetch(`${baseUrl}/api/games`).then(r => r.json());
  console.log('6. Games master is shared and available:', games.games.length > 0);

  // 6. 再び Day 1 へ切り替え
  await fetch(`${baseUrl}/api/day/switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day: 1 })
  });

  const tl1_restored = await fetch(`${baseUrl}/api/timeline`).then(r => r.json());
  const seat1 = tl1_restored.timeline[0]?.seats[0];
  console.log('7. Switched back to Day 1: slots and booked ticket preserved:',
    tl1_restored.timeline.length === 5 && seat1.status === 'booked' && seat1.ticket_code === t1.ticket.ticket_code
  );

  console.log('--- 2-Day Tests Completed Successfully ---');
}

testDaysFlow().catch(console.error);

