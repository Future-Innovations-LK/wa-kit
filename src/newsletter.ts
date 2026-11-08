import { delay, type WASocket, type WAMessage, type proto } from "baileys";

/**
 * Newsletter (WhatsApp Channel) helpers. Official Baileys already has the
 * full API (newsletterCreate/Follow/Unfollow/Mute/Update/React/Fetch...) -
 * this module adds the conveniences ourin-baileys had, rebuilt on top of it.
 *
 * NOTHING here runs automatically. Every follow happens only when you call it.
 */

export type NewsletterMeta = NonNullable<Awaited<ReturnType<WASocket["newsletterMetadata"]>>>;

/** Pulls the invite code out of https://whatsapp.com/channel/<code> (or returns a bare code). */
export function parseChannelLink(input: string): { type: "jid" | "invite"; key: string } {
  const value = input.trim();
  if (value.endsWith("@newsletter")) return { type: "jid", key: value };
  const m = value.match(/(?:whatsapp\.com\/channel\/|wa\.me\/channel\/)([A-Za-z0-9_-]+)/);
  return { type: "invite", key: m ? m[1]! : value };
}

/**
 * Accepts a channel link, invite code or xxx@newsletter JID and returns the
 * channel's metadata (id, name, subscribers, picture...). This is ourin's
 * "cekIDSaluran" / URL resolve.
 */
export async function resolveNewsletter(sock: WASocket, linkOrJid: string): Promise<NewsletterMeta | null> {
  const { type, key } = parseChannelLink(linkOrJid);
  return sock.newsletterMetadata(type, key);
}

/** Channel link -> "1203...@newsletter", or null if not found. */
export async function newsletterIdFromLink(sock: WASocket, link: string): Promise<string | null> {
  return (await resolveNewsletter(sock, link))?.id ?? null;
}

export interface BulkResult {
  jid: string;
  ok: boolean;
  error?: string;
}

/**
 * Follow several channels - only when YOU call it. Accepts links or JIDs.
 * Spaced out (default 1.5s) so it doesn't look like spam to WhatsApp.
 */
export async function followNewsletters(
  sock: WASocket,
  channels: string[],
  opts: { delayMs?: number; mute?: boolean } = {},
): Promise<BulkResult[]> {
  return forEachChannel(sock, channels, opts.delayMs, async (jid) => {
    await sock.newsletterFollow(jid);
    if (opts.mute) await sock.newsletterMute(jid);
  });
}

/** Unfollow several channels. */
export function unfollowNewsletters(sock: WASocket, channels: string[], opts: { delayMs?: number } = {}) {
  return forEachChannel(sock, channels, opts.delayMs, (jid) => sock.newsletterUnfollow(jid));
}

async function forEachChannel(
  sock: WASocket,
  channels: string[],
  delayMs = 1500,
  fn: (jid: string) => Promise<unknown>,
): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  for (const [i, channel] of channels.entries()) {
    let jid = channel;
    try {
      if (!channel.endsWith("@newsletter")) {
        const id = await newsletterIdFromLink(sock, channel);
        if (!id) throw new Error("channel not found");
        jid = id;
      }
      await fn(jid);
      results.push({ jid, ok: true });
    } catch (err) {
      results.push({ jid, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    if (i < channels.length - 1) await delay(delayMs);
  }
  return results;
}

/**
 * Is this account following the channel? true / false / null (unknown).
 * Reads the viewer role from metadata: GUEST means not following.
 */
export async function isFollowing(sock: WASocket, jid: string): Promise<boolean | null> {
  const meta = (await sock.newsletterMetadata("jid", jid)) as unknown as Record<string, unknown> | null;
  const viewer = (meta?.viewer_metadata ?? meta?.viewerMetadata) as { role?: string; view_role?: string } | undefined;
  const role = viewer?.role ?? viewer?.view_role ?? (meta?.role as string | undefined);
  if (!role) return null;
  return !["GUEST", "PREVIEW"].includes(String(role).toUpperCase());
}

/**
 * contextInfo that makes any message look "Forwarded from <channel>" with the
 * "View channel" button underneath. Pass it as `contextInfo` to any wa-kit
 * send, or spread into a normal sock.sendMessage({ ..., contextInfo }).
 */
export function channelBadge(
  newsletterJid: string,
  newsletterName: string,
  opts: { serverMessageId?: number; mentions?: string[] } = {},
): proto.IContextInfo {
  return {
    mentionedJid: opts.mentions ?? [],
    forwardingScore: 999,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
      newsletterJid,
      newsletterName,
      serverMessageId: opts.serverMessageId ?? 143,
    },
  };
}

/** Post text/media to a channel you own (thin wrapper so callers don't forget the @newsletter JID). */
export function postToNewsletter(
  sock: WASocket,
  jid: string,
  content: Parameters<WASocket["sendMessage"]>[1],
): Promise<WAMessage | undefined> {
  if (!jid.endsWith("@newsletter")) throw new Error("wa-kit: postToNewsletter needs a xxx@newsletter JID");
  return sock.sendMessage(jid, content);
}
