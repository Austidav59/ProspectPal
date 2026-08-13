// Matches social links inside HTML; profile-path filtering happens in the normalizers.
export const INSTAGRAM_LINK_PATTERN =
  /(?:https?:)?\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9_.\-/%]+/gi;
export const FACEBOOK_LINK_PATTERN =
  /(?:https?:)?\/\/(?:www\.|m\.|web\.)?facebook\.com\/[A-Za-z0-9_.\-/%?=&;]+/gi;
export const MAILTO_PATTERN =
  /mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const EMAIL_FILE_SUFFIXES = /\.(?:png|jpe?g|gif|svg|webp|css|js)$/i;

const INSTAGRAM_NON_PROFILE_SEGMENTS = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "stories",
  "explore",
  "accounts",
  "share",
  "direct",
]);

const FACEBOOK_NON_PAGE_SEGMENTS = new Set([
  "sharer",
  "sharer.php",
  "share",
  "share.php",
  "login",
  "login.php",
  "dialog",
  "plugins",
  "tr",
  "events",
  "groups",
  "hashtag",
  "photo",
  "photo.php",
  "photos",
  "watch",
  "story.php",
  "help",
  "policies",
  "marketplace",
]);

function stripTrailingJunk(raw: string): string {
  return raw.replace(/&amp;.*$/i, "").replace(/[.,;:!?'"”)\\]+$/g, "");
}

function absoluteSocialUrl(raw: string): string {
  return raw.startsWith("//") ? `https:${raw}` : raw;
}

export function normalizeInstagramUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(absoluteSocialUrl(stripTrailingJunk(raw)));
  } catch {
    return null;
  }
  if (!/(^|\.)instagram\.com$/i.test(parsed.hostname)) return null;

  const segments = parsed.pathname.split("/").filter(Boolean);
  const handle = segments[0];
  if (!handle || INSTAGRAM_NON_PROFILE_SEGMENTS.has(handle.toLowerCase()))
    return null;

  return `https://www.instagram.com/${handle.replace(/%2f/gi, "")}/`;
}

export function normalizeFacebookUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(absoluteSocialUrl(stripTrailingJunk(raw)));
  } catch {
    return null;
  }
  if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) return null;

  const segments = parsed.pathname.split("/").filter(Boolean);
  const first = segments[0];
  if (!first || FACEBOOK_NON_PAGE_SEGMENTS.has(first.toLowerCase()))
    return null;
  if (first.toLowerCase() === "profile.php") {
    const id = parsed.searchParams.get("id");
    return id && /^\d+$/.test(id)
      ? `https://www.facebook.com/profile.php?id=${id}`
      : null;
  }

  // Classic page URLs look like /pages/Business-Name/12345 — keep the whole path.
  const path =
    first.toLowerCase() === "pages" ? segments.slice(0, 3).join("/") : first;
  if (!path) return null;

  return `https://www.facebook.com/${path}/`;
}

export function extractInstagramUrl(html: string): string | null {
  for (const match of html.match(INSTAGRAM_LINK_PATTERN) ?? []) {
    const normalized = normalizeInstagramUrl(match);
    if (normalized) return normalized;
  }
  return null;
}

export function extractFacebookUrl(html: string): string | null {
  for (const match of html.match(FACEBOOK_LINK_PATTERN) ?? []) {
    const normalized = normalizeFacebookUrl(match);
    if (normalized) return normalized;
  }
  return null;
}

export function extractEmail(html: string): string | null {
  const deobfuscated = html
    .replace(/\s*(?:\[|\()\s*at\s*(?:\]|\))\s*/gi, "@")
    .replace(/\s*(?:\[|\()\s*dot\s*(?:\]|\))\s*/gi, ".");
  const candidates = [
    deobfuscated.match(MAILTO_PATTERN)?.[1],
    ...(deobfuscated.match(EMAIL_PATTERN) ?? []),
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const email = raw.toLowerCase().replace(/[.,;:]+$/, "");
    if (EMAIL_FILE_SUFFIXES.test(email)) continue;
    if (/(?:example\.com|email\.com|domain\.com)$/.test(email)) continue;
    if (/^(?:no-?reply|donotreply)@/.test(email)) continue;
    return email;
  }
  return null;
}
