// Links that open the app (housefi://..., from any other app or web page) are checked before the router parses them.
// The router's URL decoder (decode-uri-component, via query-string) has a known denial-of-service bug with long,
// heavily percent-encoded input and no compatible patched release yet; such links simply open the home screen.
export const MAX_LINK_LENGTH = 2048;
export const MAX_LINK_ESCAPES = 64;

export function safeIncomingPath(path: string): string {
  if (path.length > MAX_LINK_LENGTH) return '/';
  const escapes = path.match(/%/g)?.length ?? 0;
  if (escapes > MAX_LINK_ESCAPES) return '/';
  return path;
}
