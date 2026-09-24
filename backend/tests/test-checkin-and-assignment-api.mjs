// backend/test-checkin-and-assignment-api.mjs
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
  console.log('--- Starting Backend Server for Checkin & Assignment Test ---');
  const server = spawn('node', ['--experimental-strip-types', 'backend/src/index.ts'], {
    stdio: 'inherit',
  });

  try {
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await request('GET', '/api/games');
        if (res.status === 200) {
          ready = true;
          break;
        }
      } catch (e) {
        // wait
      }
      await sleep(400);
    }

    if (!ready) {
      throw new Error('Backend server did not start in time');
    }
    console.log('✓ Server ready');

    // ゲーム登録
    await request('POST', '/api/games', {
      id: 'G_ACTION',
      name: 'ハイパーアクション',
      command: 'hyper_action.exe',
    });

    // 1. スロット生成 (A組, B組 各2枠、枠あたり2席)
    console.log('\n--- 1. Generate Slots ---');
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
    console.log('Generate slots:', genRes.status, genRes.data?.message);

    // 2. チケット2枚発券（Slot 0の1番席、2番席に発券される）
    console.log('\n--- 2. Issue Tickets ---');
    const t1 = await request('POST', '/api/issue', { gameId: 'G_ACTION', force: true });
    const t2 = await request('POST', '/api/issue', { gameId: 'G_ACTION', force: true });
    const code1 = t1.data?.ticket?.ticket_code;
    const code2 = t2.data?.ticket?.ticket_code;
    const slot0Id = t1.data?.ticket?.slot_id || (await request('GET', '/api/timeline?day=1')).data.timeline[0].id;
    console.log(`Issued: Ticket 1 = ${code1}, Ticket 2 = ${code2} (in Slot 0: ${slot0Id})`);

    // 3. チェックイン画面での操作: Ticket 1 のみ「来た！」(checked_in) にする
    console.log('\n--- 3. Checkin Page: Mark Ticket 1 as checked_in (来た！) ---');
    const markRes = await request('POST', '/api/attendance/mark', {
      ticketCode: code1,
      status: 'checked_in',
    });
    console.log('Mark result:', markRes.status, markRes.data?.message);

    // 4. 枠割り当て画面でのステータス取得 (/api/assignment/status)
    console.log('\n--- 4. Assignment Page: Get Status & Preview Planned Seats ---');
    const assignStatusRes = await request('GET', '/api/assignment/status?day=1');
    console.log('Status code:', assignStatusRes.status);
    const slots = assignStatusRes.data?.slots;
    const slot0 = slots?.find(s => s.id === slot0Id);

    console.log(`Slot 0 (${slot0.lane}組 ${slot0.slot_time}): is_closed=${slot0.is_closed}, canFill=${slot0.canFill}`);
    console.log('Slot 0 Planned seats count:', slot0.plannedSeats?.length);
    console.log('Planned seat details:', slot0.plannedSeats);

    if (!slot0.canFill || slot0.plannedSeats.length === 0) {
      throw new Error('Slot 0 should have planned seats preview for checked-in ticket 1');
    }
    if (slot0.plannedSeats[0].ticketCode !== code1) {
      throw new Error(`Expected planned seat ticket code ${code1}, got ${slot0.plannedSeats[0].ticketCode}`);
    }
    console.log('✓ Successfully previewed Ticket 1 in Planned Seats!');

    // 5. 「⚡ この枠を埋める」ボタンの実行 (/api/assignment/fill-slot)
    console.log('\n--- 5. Assignment Page: Click [⚡ この枠を埋める] ---');
    const fillRes = await request('POST', '/api/assignment/fill-slot', {
      slotId: slot0Id,
    });
    console.log('Fill slot response:', fillRes.status, fillRes.data?.message);
    if (fillRes.status !== 200 || !fillRes.data?.success) {
      throw new Error('Failed to fill slot');
    }

    // 6. 体験PC用監視API (/api/seat-status?lane=A&seat=1) での確認
    console.log('\n--- 6. Verify Seat Status for In-Room PC (Lane A Seat 1) ---');
    const seatStatusRes = await request('GET', '/api/seat-status?lane=A&seat=1');
    console.log('Seat status response:', seatStatusRes.status, seatStatusRes.data);
    if (seatStatusRes.status !== 200 || seatStatusRes.data.status !== 'checked_in') {
      throw new Error(`Expected seat status checked_in, got ${JSON.stringify(seatStatusRes.data)}`);
    }
    if (seatStatusRes.data.ticket_code !== code1 || seatStatusRes.data.game_command !== 'hyper_action.exe') {
      throw new Error(`Mismatch in ticket or game_command: ${JSON.stringify(seatStatusRes.data)}`);
    }
    console.log('✓ In-Room PC correctly received filled seat status and game command!');

    // 7. 再度 /api/assignment/status で確認
    const afterAssignRes = await request('GET', '/api/assignment/status?day=1');
    const slot0After = afterAssignRes.data?.slots?.find(s => s.id === slot0Id);
    console.log(`Slot 0 after fill: is_closed=${slot0After.is_closed}, seat 1 is_assigned=${slot0After.seats[0].is_assigned}`);
    if (!slot0After.is_closed || !slot0After.seats[0].is_assigned) {
      throw new Error('Slot 0 should be closed and seat 1 should be assigned');
    }

    console.log('\n======================================================');
    console.log('🎉 ALL CHECKIN & ASSIGNMENT TESTS PASSED!');
    console.log('======================================================\n');
  } finally {
    console.log('Shutting down test backend server...');
    server.kill();
  }
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
