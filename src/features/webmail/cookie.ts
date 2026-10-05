/** Secure cookies are dropped by browsers on http://IP. Only set Secure on HTTPS. */
export function webmailCookieSecure(input: {
  forwardedProto: string | null;
  url: string;
}): boolean {
  const forwarded = input.forwardedProto?.split(",")[0]?.trim().toLowerCase() ?? "";
  if (forwarded === "https") return true;
  if (forwarded === "http") return false;
  return input.url.startsWith("https:");
}
