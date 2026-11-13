import { isIP } from "node:net";

/**
 * The header the panel takes the client address from. nginx sets it to
 * `$remote_addr` on every proxied request (installer/templates/nginx-panel.conf),
 * replacing whatever the client sent, so it cannot be forged from outside.
 * `X-Forwarded-For` is never read: nginx appends to the client's own value.
 *
 * Better Auth keys its rate limiter on this header (`advanced.ipAddress` in
 * `./server.ts`) and the failed sign-in log line names it.
 */
export const CLIENT_IP_HEADER = "x-real-ip";

/**
 * The client address from `CLIENT_IP_HEADER`, or `"unknown"` when the header
 * is missing or is not a single plain IPv4/IPv6 address. Validating it keeps
 * anything but an address (spaces, newlines, zone ids) out of the log.
 */
export function clientIp(headers: Headers | null | undefined): string {
  const value = headers?.get(CLIENT_IP_HEADER) ?? "";
  return /^[0-9A-Fa-f:.]+$/.test(value) && isIP(value) !== 0 ? value : "unknown";
}

/**
 * The single stdout line written for a failed sign-in or a failed two-factor
 * code. fail2ban matches it in the schela-panel journal, so the text is a
 * contract: change it only together with the filter. It carries the address
 * only, never the email, password or code.
 */
export function failedSignInLine(ip: string): string {
  return `schela-auth: failed sign-in from ${ip}`;
}
