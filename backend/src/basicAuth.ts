import type { NextFunction, Request, Response } from 'express';

const BASIC_AUTH_USERNAME = process.env.BASIC_AUTH_USERNAME;
const BASIC_AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD;

function hasValidCredentials(req: Request): boolean {
  if (!BASIC_AUTH_USERNAME || !BASIC_AUTH_PASSWORD) {
    return true;
  }

  const header = req.headers.authorization;
  if (!header?.startsWith('Basic ')) {
    return false;
  }

  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }

  const separator = decoded.indexOf(':');
  if (separator < 0) {
    return false;
  }

  return (
    decoded.slice(0, separator) === BASIC_AUTH_USERNAME &&
    decoded.slice(separator + 1) === BASIC_AUTH_PASSWORD
  );
}

export function requireBasicAuth(req: Request, res: Response, next: NextFunction): void {
  if (hasValidCredentials(req)) {
    next();
    return;
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Ticket System"');
  res.status(401).send('Authentication required');
}
