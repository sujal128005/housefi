// Every link that opens the app passes through here before the router reads it (see domain/linkGuard).
import { safeIncomingPath } from '../domain/linkGuard';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return safeIncomingPath(path);
}
