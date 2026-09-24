import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TESTS_DIR = __dirname;
const ROOT_DIR = path.resolve(__dirname, '../..');

// 対象テストファイルを取得
const files = fs.readdirSync(TESTS_DIR)
  .filter((f) => f.startsWith('test-') && f.endsWith('.mjs'))
  .sort();

console.log(`\n========================================`);
console.log(`🧪 テストランナー起動: 全 ${files.length} ファイルのテスト`);
console.log(`========================================\n`);

const results = [];

for (const file of files) {
  const filePath = path.join(TESTS_DIR, file);
  process.stdout.write(`▶ 実行中: ${file} ... `);

  const start = Date.now();
  const res = await new Promise((resolve) => {
    const proc = spawn('node', ['--experimental-strip-types', filePath], {
      cwd: ROOT_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: '4000' },
    });

    let stderr = '';
    let stdout = '';
    proc.stdout.on('data', (d) => stdout += d.toString());
    proc.stderr.on('data', (d) => stderr += d.toString());

    proc.on('close', (code) => {
      const duration = Date.now() - start;
      resolve({ code, duration, stdout, stderr });
    });
  });

  if (res.code === 0) {
    console.log(`✅ PASS (${res.duration}ms)`);
    results.push({ file, pass: true, duration: res.duration });
  } else {
    console.log(`❌ FAIL (${res.duration}ms)`);
    results.push({ file, pass: false, duration: res.duration, error: res.stderr || res.stdout });
  }
}

console.log(`\n========================================`);
console.log(`📊 テスト結果サマリー`);
console.log(`========================================`);
let passCount = 0;
for (const r of results) {
  if (r.pass) {
    passCount++;
    console.log(`  ✅ ${r.file} (${r.duration}ms)`);
  } else {
    console.log(`  ❌ ${r.file} (${r.duration}ms)`);
    if (r.error) {
      console.log(`     Error: ${r.error.trim().split('\n').slice(-2).join(' ')}`);
    }
  }
}

console.log(`----------------------------------------`);
console.log(`結果: ${passCount} / ${results.length} PASSED`);
console.log(`========================================\n`);

if (passCount < results.length) {
  process.exit(1);
}

