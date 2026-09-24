// backend/test-attendance-crosslane-api.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: 4000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(responseBody) });
        } catch {
          resolve({ status: res.statusCode, raw: responseBody });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('--- Starting Backend Server for Attendance & Cross-lane Test ---');
  const server = spawn('node', ['--experimental-strip-types', 'backend/src/index.ts'], {
    stdio: 'inherit',
  });

  try {
    let ready = false;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await request('GET', '/api/games');
        if (res.status === 200) {
          ready = true;
          break;
        }
      } catch (e) {
        // wait
      }
      await sleep(300);
    }

    if (!ready) {
      throw new Error('Backend server did not start in time');
    }

    console.log('✓ Server is ready');

    // 0. ゲーム登録
    await request('POST', '/api/games', {
      id: 'G_CROSS',
      name: 'クロスレーン対戦',
      command: 'cross_game.exe',
    });

    // 1. スロット生成（A組・B組、7分ピッチ、オフセット3分）
    console.log('\n--- 1. Generate Slots (A & B lanes, 7min cycle, 3min offset) ---');
    const genRes = await request('POST', '/api/slots/generate', {
      day: 1,
      startHour: '10',
      startMinute: '00',
      count: 4,
      seatsPerSlot: 2,
      lanes: ['A', 'B'],
      playDuration: 5,
      cleanupDuration: 2,
      laneOffset: 3,
    });
    console.log('Generate slots response:', genRes.status, genRes.data?.message);
    if (genRes.status !== 200) throw new Error('Failed to generate slots');

    // タイムライン取得
    const tlRes = await request('GET', '/api/timeline?day=1');
    const slots = tlRes.data.timeline;
    console.log(`Generated ${slots.length} slots:`);
    for (const s of slots) {
      console.log(`- Slot id=${s.id}, idx=${s.order_idx}: [${s.lane}組] ${s.slot_time}`);
    }

    const aSlots = slots.filter(s => s.lane === 'A');
    const bSlots = slots.filter(s => s.lane === 'B');
    if (aSlots.length === 0 || bSlots.length === 0) throw new Error('Slots missing for A or B');

    // 2. チケット発券（A組の第1枠: 10:00 1番席に発券される）
    console.log('\n--- 2. Issue Ticket (Auto-allocated to Lane A 10:00) ---');
    const issueRes = await request('POST', '/api/issue', {
      gameId: 'G_CROSS',
      force: true
    });
    console.log('Issue ticket response:', issueRes.status, issueRes.data);
    if (issueRes.status !== 200 || !issueRes.data?.ticket?.ticket_code) {
      throw new Error('Failed to issue ticket: ' + JSON.stringify(issueRes.data));
    }
    const ticketCode = issueRes.data.ticket.ticket_code;
    console.log(`Issued Ticket Code: ${ticketCode}`);

    // 3. 出席状況一覧の取得 (/api/attendance/list)
    console.log('\n--- 3. Verify Attendance List (Initial status: booked) ---');
    const attListRes1 = await request('GET', '/api/attendance/list?day=1');
    console.log('Attendance list response:', attListRes1.status, 'Total items:', attListRes1.data?.list?.length);
    const item1 = attListRes1.data?.list?.find(i => i.ticket_code === ticketCode);
    if (!item1) throw new Error(`Ticket ${ticketCode} not found in attendance list`);
    console.log(`Found ticket in list: lane=${item1.lane}, time=${item1.slot_time}, seat=${item1.seat_no}, status=${item1.status}, game=${item1.game_name}`);
    if (item1.status !== 'booked') throw new Error(`Expected status 'booked', got '${item1.status}'`);

    // 4. 来場マーク (/api/attendance/mark) -> checked_in に更新
    console.log('\n--- 4. Mark Attendance as checked_in (来た！) ---');
    const markRes = await request('POST', '/api/attendance/mark', {
      ticketCode: ticketCode,
      status: 'checked_in'
    });
    console.log('Mark attendance response:', markRes.status, markRes.data?.message);
    if (markRes.status !== 200 || markRes.data?.status !== 'checked_in') {
      throw new Error('Failed to mark attendance as checked_in');
    }

    // 再度一覧確認
    const attListRes2 = await request('GET', '/api/attendance/list?day=1');
    const item2 = attListRes2.data?.list?.find(i => i.ticket_code === ticketCode);
    if (item2.status !== 'checked_in') throw new Error(`Expected status 'checked_in', got '${item2.status}'`);
    console.log('✓ Ticket status successfully updated to checked_in in attendance list');

    // 5. クロスレーン座席割り当て (A組の予約をB組スロットへ移動)
    console.log('\n--- 5. Cross-Lane Seat Reassignment (Move from Lane A to Lane B 10:03 Seat 2) ---');
    const targetBSlot = bSlots[0]; // B組 10:03
    const targetSeatNo = 2;

    const reassignRes = await request('POST', '/api/reservations/reassign-seat', {
      ticketCode: ticketCode,
      targetSlotId: targetBSlot.id,
      targetSeatNo: targetSeatNo
    });
    console.log('Reassign response:', reassignRes.status, reassignRes.data?.message);
    if (reassignRes.status !== 200 || !reassignRes.data.success) {
      throw new Error('Failed to reassign seat: ' + JSON.stringify(reassignRes.data));
    }

    // 6. 移動結果の検証
    console.log('\n--- 6. Verify Reassignment Result in Attendance List & Slot Detail ---');
    const attListRes3 = await request('GET', '/api/attendance/list?day=1');
    const item3 = attListRes3.data?.list?.find(i => i.display_ticket_code === ticketCode || i.ticket_code === ticketCode || i.assigned_ticket_code === ticketCode);
    console.log(`Updated ticket item: lane=${item3?.lane}, time=${item3?.slot_time}, seat=${item3?.seat_no}, status=${item3?.status}, game=${item3?.game_name}, display_ticket=${item3?.display_ticket_code}, note=${item3?.note}`);
    if (!item3 || item3.lane !== 'B' || item3.slot_id !== targetBSlot.id || item3.seat_no !== targetSeatNo) {
      throw new Error(`Reassignment verification failed: expected Lane B slot ${targetBSlot.id} seat ${targetSeatNo}, got lane ${item3?.lane} slot ${item3?.slot_id} seat ${item3?.seat_no}`);
    }

    // 元のA組座席（slot 0, seat 1）が empty になっているか確認
    const tlAfter = await request('GET', '/api/timeline?day=1');
    const originalSlotAfter = tlAfter.data.timeline.find(s => s.id === aSlots[0].id);
    const origSeat = originalSlotAfter.seats.find(r => r.seat_no === 1);
    console.log(`Original seat 1 in Lane A slot status: ${origSeat.status}`);
    if (origSeat.status !== 'empty') {
      throw new Error(`Original seat in Lane A should be empty, but got ${origSeat.status}`);
    }

    // 7. クライアントPC向け案内API (/api/seat-status) の検証
    console.log('\n--- 7. Verify Client PC API (/api/seat-status?lane=B&seat=2) ---');
    // 枠を締め切り済みにした状態でのテスト (案内画面やPC席画面の連携)
    await request('POST', '/api/slots/close', { slotId: targetBSlot.id, day: 1 });

    const clientStatusRes = await request('GET', `/api/seat-status?lane=B&seat=${targetSeatNo}`);
    console.log('Client status response:', clientStatusRes.status, clientStatusRes.data);
    if (clientStatusRes.status !== 200 || clientStatusRes.data.status !== 'checked_in' || clientStatusRes.data.ticket_code !== ticketCode) {
      throw new Error(`Client PC status check failed: expected checked_in with ticket ${ticketCode}, got ${JSON.stringify(clientStatusRes.data)}`);
    }
    if (clientStatusRes.data.game_command !== 'cross_game.exe') {
      throw new Error(`Client PC game command mismatch: expected cross_game.exe, got ${clientStatusRes.data.game_command}`);
    }
    console.log(`✓ Client PC received correct game command [${clientStatusRes.data.game_command}] and ticket [${clientStatusRes.data.ticket_code}]!`);

    console.log('\n======================================================');
    console.log('🎉 ALL ATTENDANCE & CROSS-LANE REASSIGN TESTS PASSED!');
    console.log('======================================================\n');
  } finally {
    console.log('Shutting down test backend server...');
    server.kill();
  }
}

run().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
