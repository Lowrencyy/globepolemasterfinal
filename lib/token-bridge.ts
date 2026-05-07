/**
 * Synchronous in-memory token bridge.
 * auth-context writes here on login/logout.
 * lib/api.ts reads from here on every request.
 * No async, no file I/O — always up to date for the current session.
 */

let _token: string | null = null;

export function setBridgeToken(token: string | null): void {
  _token = token;
}

export function getBridgeToken(): string | null {
  return _token;
}
