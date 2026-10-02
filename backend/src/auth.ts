import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const adminTokens = new Set<string>();

/**
 * リクエストから管理者トークンを抽出 (X-Admin-Token または Authorization: Bearer)
 * ※ Basic認証との競合を避けるため X-Admin-Token を最優先
 */
export function getAdminTokenFromRequest(req: Request): string | null {
  const xAdminToken = req.headers['x-admin-token'];
  if (typeof xAdminToken === 'string' && xAdminToken.trim()) {
    return xAdminToken.trim();
  }
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

/**
 * 管理者認証ミドルウェア (X-Admin-Token または Bearer トークン検証)
 */
export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const token = getAdminTokenFromRequest(req);
  if (token && adminTokens.has(token)) {
    return next();
  }
  res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: '管理者認証が必要です (401 Unauthorized)' });
}

/**
 * 管理者パスワードの検証
 */
export function verifyAdminPassword(password: string): boolean {
  return password === ADMIN_PASSWORD;
}

/**
 * 新しい管理者トークンを発行
 */
export function generateAdminToken(): string {
  const token = crypto.randomBytes(32).toString('hex');
  adminTokens.add(token);
  return token;
}

/**
 * 管理者トークンの有効性確認
 */
export function isValidAdminToken(token: string | null | undefined): boolean {
  if (!token) return false;
  return adminTokens.has(token);
}

/**
 * 管理者トークンの失効 (ログアウト)
 */
export function revokeAdminToken(token: string | null | undefined): void {
  if (token) {
    adminTokens.delete(token);
  }
}

