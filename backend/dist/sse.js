const clients = new Set();
export function registerSSEClient(res) {
    clients.add(res);
    // 初回接続イベント
    res.write(`data: ${JSON.stringify({ type: 'connected', clientsCount: clients.size })}\n\n`);
    return () => {
        clients.delete(res);
    };
}
export function broadcastUpdate(payload = {}) {
    const message = JSON.stringify({
        type: 'update',
        timestamp: Date.now(),
        ...payload,
    });
    for (const client of clients) {
        try {
            client.write(`data: ${message}\n\n`);
        }
        catch {
            clients.delete(client);
        }
    }
}
//# sourceMappingURL=sse.js.map