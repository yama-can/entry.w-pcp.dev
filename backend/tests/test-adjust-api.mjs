async function testAdjustFlow() {
  const baseUrl = 'http://127.0.0.1:4000';
  console.log('--- Testing Slot Adjust From & Shift Delay ---');

  // 1. スロット生成 (10:00〜 4枠)
  await fetch(`${baseUrl}/api/slots/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startHour: 10, startMinute: 0, count: 4, seatsPerSlot: 2 })
  });

  let tl = await fetch(`${baseUrl}/api/timeline`).then(r => r.json());
  console.log('Initial slots:', tl.timeline.map(s => `${s.order_idx}:${s.lane}@${s.slot_time}`).join(', '));
  // 0:A@10:00, 1:B@10:03, 2:A@10:06, 3:B@10:09

  // 2. 2番目のスロット（10:03 B組）以降を一括 +5分 遅延シフト
  const slot1 = tl.timeline[1];
  const shiftRes = await fetch(`${baseUrl}/api/slots/shift-delay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromSlotId: slot1.id, shiftMinutes: 5 })
  }).then(r => r.json());
  console.log('Shift result:', shiftRes.message);

  tl = await fetch(`${baseUrl}/api/timeline`).then(r => r.json());
  console.log('After +5m shift:', tl.timeline.map(s => `${s.order_idx}:${s.lane}@${s.slot_time}`).join(', '));
  // 期待値: 0:A@10:00, 1:B@10:08, 2:A@10:11, 3:B@10:14

  // 3. 2番目のスロット以降を「11:00開始、3枠、調整ターン付き」で再生成
  const adjustRes = await fetch(`${baseUrl}/api/slots/adjust-from`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromSlotId: slot1.id,
      startHour: 11,
      startMinute: 0,
      count: 3,
      seatsPerSlot: 2,
      bufferInterval: 2
    })
  }).then(r => r.json());
  console.log('Adjust result:', adjustRes.message);

  tl = await fetch(`${baseUrl}/api/timeline`).then(r => r.json());
  console.log('After adjust-from slot 1:', tl.timeline.map(s => `${s.order_idx}:${s.lane}@${s.slot_time}(buf:${s.is_buffer})`).join(', '));
  // 期待値:
  // slot 0 (10:00 A) はそのまま残る！
  // slot 1 (11:00 B), slot 2 (11:03 A, buf:true), slot 3 (11:06 B)

  // 4. バッファ枠トグル
  const toggleRes = await fetch(`${baseUrl}/api/slots/toggle-buffer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slotId: tl.timeline[0].id })
  }).then(r => r.json());
  console.log('Toggled slot 0 buffer:', toggleRes.is_buffer);

  console.log('--- Adjust API Tests Completed ---');
}

testAdjustFlow().catch(console.error);

