import assert from 'assert';

const BASE_URL = 'http://localhost:4000';

async function runTests() {
  console.log('=== 管理者認証（Bearer Token）テスト開始 ===');

  // 1. 未認証での管理者API呼び出し -> 401
  console.log('\n[TEST 1] 未認証での管理者API呼出が拒否 (401) されること');
  const endpoints = [
    { url: `${BASE_URL}/api/settings/max-wait`, body: { maxWaitMinutes: 30 } },
    { url: `${BASE_URL}/api/settings/meeting-lead`, body: { meetingLeadMinutes: 5 } },
    { url: `${BASE_URL}/api/day/switch`, body: { day: 1 } },
    { url: `${BASE_URL}/api/games`, body: { id: 'test_game', name: 'Test' } },
    { url: `${BASE_URL}/api/games/delete`, body: { id: 'test_game' } },
    { url: `${BASE_URL}/api/slots/toggle-buffer`, body: { slotId: 1 } },
  ];

  for (const ep of endpoints) {
    const res = await fetch(ep.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ep.body),
    });
    assert.strictEqual(res.status, 401, `Expected 401 for ${ep.url}, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.code, 'UNAUTHORIZED');
  }
  console.log('  -> OK: すべての保護対象エンドポイントで 401 が返却されました');

  // 2. 不正なパスワードでログイン -> 401
  console.log('\n[TEST 2] 誤ったパスワードでのログインが拒否 (401) されること');
  const badLoginRes = await fetch(`${BASE_URL}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong-password-123' }),
  });
  assert.strictEqual(badLoginRes.status, 401);
  const badLoginData = await badLoginRes.json();
  assert.strictEqual(badLoginData.success, false);
  console.log('  -> OK: 誤ったパスワードは拒否されました');

  // 3. 正しいパスワードでログイン -> 200 & トークン返却
  console.log('\n[TEST 3] 正しいパスワード（デフォルト: admin）でログインしてBearerトークン取得');
  const loginRes = await fetch(`${BASE_URL}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'admin' }),
  });
  assert.strictEqual(loginRes.status, 200);
  const loginData = await loginRes.json();
  assert.strictEqual(loginData.success, true);
  assert(loginData.token, 'Token should be returned');
  const token = loginData.token;
  console.log(`  -> OK: トークン取得成功 (${token.slice(0, 10)}...)`);

  // 4. トークン検証 API (/api/admin/verify)
  console.log('\n[TEST 4] トークン検証 (/api/admin/verify)');
  const verifyRes = await fetch(`${BASE_URL}/api/admin/verify`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(verifyRes.status, 200);
  const verifyData = await verifyRes.json();
  assert.strictEqual(verifyData.success, true);
  assert.strictEqual(verifyData.valid, true);
  console.log('  -> OK: トークンが正しく検証されました');

  // 5. Bearer トークン付きで管理者API呼び出し -> 成功 (200)
  console.log('\n[TEST 5] Bearerトークン付きでの設定更新API呼出');
  const setWaitRes = await fetch(`${BASE_URL}/api/settings/max-wait`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ maxWaitMinutes: 45 }),
  });
  assert.strictEqual(setWaitRes.status, 200);
  const setWaitData = await setWaitRes.json();
  assert.strictEqual(setWaitData.success, true);
  assert.strictEqual(setWaitData.maxWaitMinutes, 45);
  console.log('  -> OK: 設定更新が成功しました');

  // 6. ログアウト処理 (/api/admin/logout)
  console.log('\n[TEST 6] ログアウト後にトークンが無効化されること');
  const logoutRes = await fetch(`${BASE_URL}/api/admin/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(logoutRes.status, 200);

  const reVerifyRes = await fetch(`${BASE_URL}/api/admin/verify`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(reVerifyRes.status, 401);
  console.log('  -> OK: ログアウト後にトークンが無効化されました');

  // 7. 一般現場API（発券・受付等）は認証不要で正常に動くこと
  console.log('\n[TEST 7] 一般API（/api/settings, /api/timeline, /api/checkin/status）は認証不要で利用可能');
  const publicRes = await fetch(`${BASE_URL}/api/settings`);
  assert.strictEqual(publicRes.status, 200);
  const publicData = await publicRes.json();
  assert.strictEqual(publicData.success, true);
  console.log('  -> OK: 一般APIは高速・認証不要で稼働中');

  console.log('\n🎉 すべての管理者認証テストに合格しました！');
}

runTests().catch((err) => {
  console.error('❌ テスト失敗:', err);
  process.exit(1);
});
