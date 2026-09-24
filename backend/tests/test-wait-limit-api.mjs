// backend/test-wait-limit-api.mjs
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
    let ready = false;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await request('GET', '/api/games');
        if (res.status === 200) {
          ready = true;
          break;
        }
      } catch (e) {}
      await sleep(300);
    }
    if (!ready) throw new Error('Server start failed');

    console.log('--- Testing Wait Time Limit & Rejection API ---');

    // 1. スロット生成 (Day 1, 10:00〜, 4枠, 各1席, 3分ピッチ)
    // 枠0: 10:00, 枠1: 10:03, 枠2: 10:06, 枠3: 10:09
    await request('POST', '/api/slots/generate', {
      day: 1,
      startHour: 10,
      startMinute: 0,
      count: 4,
      seatsPerSlot: 1,
      pitchMinutes: 3,
    });

    // 2. 最大許容待ち時間を 5分 に設定
    console.log('Setting maxWaitMinutes to 5...');
    const setWaitRes = await request('POST', '/api/settings/max-wait', { maxWaitMinutes: 5 });
    console.log('Set wait res:', setWaitRes.data);

    // 3. 発券ステータス確認
    const status1 = await request('GET', '/api/issue/status');
    console.log('Initial issue status:', status1.data);

    // 4. 枠0 (10:00) を発券 -> 待ち時間 0分 (<= 5分) で成功するはず
    const issue1 = await request('POST', '/api/issue', { gameId: 'ACT_01' });
    console.log('Issue 1 (10:00): success =', issue1.data.success, issue1.data.ticket?.slot_time);

    // 5. 枠1 (10:03) を発券 -> 待ち時間 3分 (<= 5分) で成功するはず
    const issue2 = await request('POST', '/api/issue', { gameId: 'ACT_01' });
    console.log('Issue 2 (10:03): success =', issue2.data.success, issue2.data.ticket?.slot_time);

    // 6. 枠2 (10:06) を発券試行 -> 次の空き枠は 10:06、待ち時間 6分 (> 5分) で拒否されるはず！
    console.log('Attempting Issue 3 (next slot 10:06, wait 6 min > limit 5 min)...');
    const issue3 = await request('POST', '/api/issue', { gameId: 'ACT_01' });
    console.log('Issue 3 Result:', issue3.data);

    if (
      !issue3.data.success &&
      issue3.data.code === 'WAIT_LIMIT_EXCEEDED' &&
      issue3.data.currentWaitMinutes === 6 &&
      issue3.data.resumeTime === '10:01'
    ) {
      console.log('>>> SUCCESS: Issue was rejected with WAIT_LIMIT_EXCEEDED! Resume time calculated correctly:', issue3.data.resumeTime);
    } else {
      throw new Error(`Test failed on issue 3: ${JSON.stringify(issue3.data)}`);
    }

    // 7. 最大許容待ち時間を 10分 に拡大
    console.log('Increasing maxWaitMinutes to 10...');
    await request('POST', '/api/settings/max-wait', { maxWaitMinutes: 10 });

    // 8. 再度枠2 (10:06) を発券 -> 待ち時間 6分 <= 10分 となり今度は成功するはず！
    const issue3Retry = await request('POST', '/api/issue', { gameId: 'ACT_01' });
    console.log('Issue 3 Retry after limit increase: success =', issue3Retry.data.success, issue3Retry.data.ticket?.slot_time);

    if (issue3Retry.data.success && issue3Retry.data.ticket?.slot_time === '10:06') {
      console.log('>>> SUCCESS: Issue succeeded after limit increased!');
    } else {
      throw new Error(`Test failed on issue 3 retry: ${JSON.stringify(issue3Retry.data)}`);
    }

    console.log('--- All Wait Time Limit Tests Completed Successfully! ---');
  } finally {
    server.kill();
  }
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});

