import { createHash } from "node:crypto";
import { DEFAULT_ORIGIN, generateMessageIDV2, proto, type BinaryNode, type WASocket } from "baileys";

/**
 * Post to a WhatsApp Channel (newsletter) this account owns or administers -
 * text, image or video - and wait until WhatsApp confirms it.
 *
 * Why not sock.sendMessage? In baileys 7.0.0-rc14 channel media has to go
 * to the unencrypted /newsletter/ upload endpoint and the post must carry
 * the upload's media handle, but sendMessage uploads to the normal /mms/
 * endpoint and drops the handle - so image/video posts never show up. It
 * also resolves before WhatsApp accepts the post, hiding failures.
 *
 * This follows whatsmeow's working implementation (UploadNewsletter +
 * sendNewsletter). No ffmpeg in here: pass `jpegThumbnail` / dimensions
 * yourself for a nicer preview in the channel feed (all optional), and
 * make sure videos are H.264/AAC MP4 so followers' phones can play them.
 */

export type ChannelContent =
  | { text: string }
  | {
      image: Buffer;
      caption?: string;
      /** detected from the bytes when omitted (jpeg/png/webp) */
      mimetype?: string;
      jpegThumbnail?: Buffer;
      width?: number;
      height?: number;
    }
  | {
      video: Buffer;
      caption?: string;
      jpegThumbnail?: Buffer;
      width?: number;
      height?: number;
      seconds?: number;
    };

export interface ChannelPostResult {
  /** our message id */
  id: string;
  /** the post's id inside the channel (from WhatsApp's ack) - use it to react / fetch */
  serverId?: string;
}

export interface ChannelPostOptions {
  /** how long to wait for WhatsApp's ack (default 30s) */
  ackTimeoutMs?: number;
  /** per-host upload timeout (default 2 min) */
  uploadTimeoutMs?: number;
}

interface Upload {
  url: string;
  directPath: string;
  handle?: string;
  sha256: Buffer;
  length: number;
}

/** Raw (unencrypted) upload to /newsletter/newsletter-<kind>/ - channel media isn't end-to-end encrypted. */
async function uploadForChannel(sock: WASocket, data: Buffer, kind: "image" | "video", timeoutMs: number): Promise<Upload> {
  const sha256 = createHash("sha256").update(data).digest();
  const token = sha256.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  let lastError: unknown = new Error("wa-kit: WhatsApp gave no upload hosts");
  for (const fresh of [false, true]) {
    const conn = await sock.refreshMediaConn(fresh);
    for (const { hostname } of conn.hosts) {
      try {
        const res = await fetch(
          `https://${hostname}/newsletter/newsletter-${kind}/${token}?auth=${encodeURIComponent(conn.auth)}&token=${token}`,
          {
            method: "POST",
            body: new Uint8Array(data),
            headers: { "Content-Type": "application/octet-stream", Origin: DEFAULT_ORIGIN, Referer: `${DEFAULT_ORIGIN}/` },
            signal: AbortSignal.timeout(timeoutMs),
          },
        );
        const body = (await res.json().catch(() => ({}))) as { url?: string; direct_path?: string; handle?: string };
        if (res.ok && body.direct_path) {
          return { url: body.url ?? "", directPath: body.direct_path, handle: body.handle, sha256, length: data.length };
        }
        lastError = new Error(`wa-kit: channel media upload refused (HTTP ${res.status})`);
      } catch (err) {
        lastError = err;
      }
    }
  }
  throw lastError;
}

/** Image type from the first bytes - URLs and forwarded files don't always say. */
function imageMime(data: Buffer): string {
  if (data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "image/png";
  if (data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return "image/jpeg";
}

export async function postToChannel(
  sock: WASocket,
  channelJid: string,
  content: ChannelContent,
  opts: ChannelPostOptions = {},
): Promise<ChannelPostResult> {
  if (!channelJid.endsWith("@newsletter")) throw new Error("wa-kit: postToChannel needs a xxx@newsletter JID");

  let message: proto.IMessage;
  let kind: "image" | "video" | undefined;
  let handle: string | undefined;

  if ("text" in content) {
    message = { extendedTextMessage: { text: content.text } };
  } else {
    kind = "image" in content ? "image" : "video";
    const data = "image" in content ? content.image : content.video;
    const up = await uploadForChannel(sock, data, kind, opts.uploadTimeoutMs ?? 2 * 60_000);
    handle = up.handle;
    const media = {
      url: up.url,
      directPath: up.directPath,
      fileSha256: up.sha256,
      fileLength: up.length,
      caption: content.caption || undefined,
      jpegThumbnail: content.jpegThumbnail,
      width: content.width,
      height: content.height,
    };
    message =
      "image" in content
        ? { imageMessage: { ...media, mimetype: content.mimetype || imageMime(content.image) } }
        : { videoMessage: { ...media, seconds: content.seconds, mimetype: "video/mp4" } };
  }

  const id = generateMessageIDV2(sock.user?.id);
  const node: BinaryNode = {
    tag: "message",
    attrs: { to: channelJid, id, type: kind ? "media" : "text", ...(handle ? { media_id: handle } : {}) },
    content: [{ tag: "plaintext", attrs: kind ? { mediatype: kind } : {}, content: proto.Message.encode(message).finish() }],
  };

  // listen before sending so a fast ack isn't missed
  const ack = sock.waitForMessage(id, opts.ackTimeoutMs ?? 30_000) as Promise<BinaryNode | undefined>;
  ack.catch(() => undefined);
  await sock.sendNode(node);

  let reply: BinaryNode | undefined;
  try {
    reply = await ack;
  } catch {
    throw new Error("wa-kit: WhatsApp didn't confirm the channel post in time - check the channel before retrying");
  }
  const error = reply?.attrs?.error;
  if (error) throw new Error(`wa-kit: WhatsApp refused the channel post (error ${error}) - is this account an admin of the channel?`);

  return { id, serverId: reply?.attrs?.server_id };
}
