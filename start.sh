#!/usr/bin/env bash
set -e

# カレントディレクトリをプロジェクトルートに設定
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "=========================================================="
echo " 文化祭ゲーム体験 整理券・運用管理システム 起動スクリプト"
echo " 完全オフラインLAN対応 (Backend: 4000 / Frontend: 3000)"
echo "=========================================================="

# IPアドレスの表示（LAN内からのアクセス用）
echo ""
echo "▼ LAN内端末（スマホ・受付PC・室内モニター）からのアクセス先:"
hostname -I 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i !~ /^127\./) print "   http://" $i ":3000"}' || true
echo "   http://localhost:3000 (母艦PC)"
echo "----------------------------------------------------------"

# 終了時のシグナルハンドリング
cleanup() {
  echo ""
  echo "システムを停止しています..."
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# 1. バックエンド起動 (Express + SQLite + SSE : 4000)
echo "[1/2] バックエンドを起動中 (Port: 4000)..."
node --experimental-strip-types backend/src/index.ts &
BACKEND_PID=$!

# バックエンドの立ち上がりを待つ
sleep 1

# 2. フロントエンド起動 (Next.js : 3000)
echo "[2/2] フロントエンドを起動中 (Port: 3000)..."
cd frontend
./node_modules/.bin/next start -p 3000 -H 0.0.0.0 &
FRONTEND_PID=$!

echo ""
echo ">>> 全システム稼働中！ブラウザで http://localhost:3000 を開いてください。"
echo ">>> (終了するには Ctrl+C を押してください)"
echo ""

wait

