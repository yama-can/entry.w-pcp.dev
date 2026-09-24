import type { Response } from 'express';

const clients = new Set<Response>();

export function registerSSEClient(res: Response): () => void {
  clients.add(res);

  // 初回接続イベント
  res.write(`data: ${JSON.stringify({ type: 'connected', clientsCount: clients.size })}\n\n`);

  return () => {
    clients.delete(res);
  };
}

export function broadcastUpdate(payload: Record<string, unknown> = {}) {
  const message = JSON.stringify({
    type: 'update',
    timestamp: Date.now(),
    ...payload,
  });

  for (const client of clients) {
    try {
      client.write(`data: ${message}\n\n`);
    } catch {
      clients.delete(client);
    }
  }
}

