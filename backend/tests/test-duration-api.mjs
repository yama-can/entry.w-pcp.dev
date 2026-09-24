// backend/test-duration-api.mjs
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
  console.log('--- Starting Backend Server ---');
  const server = spawn('node', ['--experimental-strip-types', 'backend/src/index.ts'], {
    stdio: 'inherit',
  });

  try {
    // Wait for server to become ready
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
      throw new Error('Server failed to start');
    }

    console.log('--- Testing Slot Duration & Cascade API ---');

    // 1. スロット生成 (Day 1, 10:00〜, 4枠, 通常枠 3分, 調整枠 5分, bufferInterval 2)
    const genRes = await request('POST', '/api/slots/generate', {
      day: 1,
      startHour: 10,
      startMinute: 0,
      count: 4,
      seatsPerSlot: 6,
      pitchMinutes: 3,
      bufferInterval: 2,
      bufferDuration: 5,
    });
    console.log('Generate response:', genRes.data);

    // 2. Timeline取得
    let tl = await request('GET', '/api/timeline?day=1');
    console.log('Initial slots:');
    for (const s of tl.data.timeline) {
      console.log(`  ID=${s.id}, Order=${s.order_idx}, Time=${s.slot_time}, Lane=${s.lane}, Duration=${s.duration_minutes}m, Buffer=${s.is_buffer}`);
    }

    // 3. スロット2（Index 1）の枠時間を 7分 に変更
    const secondSlot = tl.data.timeline[1];
    console.log(`\nUpdating slot ${secondSlot.id} (${secondSlot.slot_time}) duration to 7 minutes...`);
    const updateRes = await request('POST', '/api/slots/update-duration', {
      slotId: secondSlot.id,
      durationMinutes: 7,
    });
    console.log('Update duration response:', updateRes.data);

    // 4. Timeline再取得して時刻がカスケード再計算されたか確認
    tl = await request('GET', '/api/timeline?day=1');
    console.log('\nSlots after duration update:');
    for (const s of tl.data.timeline) {
      console.log(`  ID=${s.id}, Order=${s.order_idx}, Time=${s.slot_time}, Lane=${s.lane}, Duration=${s.duration_minutes}m, Buffer=${s.is_buffer}, Seats[0].code=${s.seats[0]?.ticket_code}`);
    }

    console.log('\n--- Test Finished Successfully ---');
  } finally {
    server.kill();
  }
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});

