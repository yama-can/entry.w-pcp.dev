import express, { type Request, type Response } from 'express';
import { requireBasicAuth } from './basicAuth.ts';
import { registerSSEClient } from './sse.ts';
import { adminRouter } from './routes/admin.ts';
import { daysRouter } from './routes/days.ts';
import { gamesRouter } from './routes/games.ts';
import { slotsRouter } from './routes/slots.ts';
import { ticketsRouter } from './routes/tickets.ts';
import { assignmentRouter } from './routes/assignment.ts';

export const app = express();

// 外部公開入口のBasic認証。BASIC_AUTH_USERNAME/PASSWORD設定時のみ有効。
app.use(requireBasicAuth);

// CORS ミドルウェア
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json());

// 各種ルーターの登録
app.use(adminRouter);
app.use(daysRouter);
app.use(gamesRouter);
app.use(slotsRouter);
app.use(ticketsRouter);
app.use(assignmentRouter);

// SSE: GET /api/events
app.get('/api/events', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const unregister = registerSSEClient(res);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  _req.on('close', () => {
    clearInterval(heartbeat);
    unregister();
  });
});
