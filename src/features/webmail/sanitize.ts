const BLOCKED = /<\s*(script|iframe|object|embed|link|meta|base|form|svg|math)[\s\S]*?<\/\s*\1\s*>/gi;
const BLOCKED_EMPTY = /<\s*(script|iframe|object|embed|link|meta|base|form|svg|math)[^>]*>/gi;

export function sanitizeHtml(html: string, allowRemoteImages: boolean): string {
  let out = html.replace(BLOCKED, "").replace(BLOCKED_EMPTY, "");
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  out = out.replace(/(href|src|xlink:href|action)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=$2#$2');
  out = out.replace(/\ssrcset\s*=\s*("[^"]*"|'[^']*')/gi, "");
  if (!allowRemoteImages) {
    out = out.replace(
      /<img\b([^>]*?)\bsrc\s*=\s*(["'])(?:https?:)?\/\/[^"']*\2/gi,
      '<img$1data-blocked="1" alt="remote image blocked"',
    );
  }
  return out;
}

export function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function textToHtml(text: string): string {
  return `<pre style="white-space:pre-wrap;font:14px/1.5 ui-sans-serif,system-ui">${escapeText(text)}</pre>`;
}
