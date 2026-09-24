import type { Response } from 'express';
export declare function registerSSEClient(res: Response): () => void;
export declare function broadcastUpdate(payload?: Record<string, unknown>): void;
//# sourceMappingURL=sse.d.ts.map