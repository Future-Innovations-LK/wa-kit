import { randomBytes } from "node:crypto";
import {
  delay,
  generateWAMessage,
  generateWAMessageFromContent,
  isJidGroup,
  jidNormalizedUser,
  type AnyMessageContent,
  type WASocket,
  type WAMessage,
  type proto,
} from "baileys";
import { relay, uploadMedia, viewOnce, type SendOptions } from "./core.js";
import type { NativeButton } from "./buttons.js";

const STATUS_JID = "status@broadcast";

function me(sock: WASocket): string {
  if (!sock.user?.id) throw new Error("wa-kit: socket is not logged in yet");
  return jidNormalizedUser(sock.user.id);
}

// ---------------------------------------------------------------------------
// Album - several images/videos grouped into one bubble
// ---------------------------------------------------------------------------

export type AlbumItem =
  | { image: string | Buffer; caption?: string }
  | { video: string | Buffer; caption?: string };

export async function sendAlbum(
  sock: WASocket,
  jid: string,
  items: AlbumItem[],
  opts: SendOptions & { delayMs?: number } = {},
): Promise<WAMessage> {
  if (items.length < 2) throw new Error("wa-kit: an album needs at least 2 items");

  const parent = generateWAMessageFromContent(
    jid,
    {
      messageContextInfo: { messageSecret: randomBytes(32) },
      albumMessage: {
        expectedImageCount: items.filter((i) => "image" in i).length,
        expectedVideoCount: items.filter((i) => "video" in i).length,
      },
    },
    { userJid: me(sock), quoted: opts.quoted as WAMessage | undefined },
  );
  await sock.relayMessage(jid, parent.message!, { messageId: parent.key.id! });

  for (const item of items) {
    const src = (v: string | Buffer) => (typeof v === "string" ? { url: v } : v);
    const content: AnyMessageContent =
      "image" in item
        ? { image: src(item.image), caption: item.caption }
        : { video: src(item.video), caption: item.caption };
    if (opts.contextInfo) (content as { contextInfo?: proto.IContextInfo }).contextInfo = opts.contextInfo;

    const child = await generateWAMessage(jid, content, { userJid: me(sock), upload: sock.waUploadToServer });
    child.message!.messageContextInfo = {
      messageSecret: randomBytes(32),
      messageAssociation: { associationType: 1, parentMessageKey: parent.key },
    };
    await sock.relayMessage(jid, child.message!, { messageId: child.key.id! });
    if (opts.delayMs) await delay(opts.delayMs);
  }
  return parent;
}

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

export interface EventMessage {
  name: string;
  description?: string;
  /** ms timestamps */
  startTime: number;
  endTime?: number;
  location?: { name: string; latitude?: number; longitude?: number };
  joinLink?: string;
  extraGuestsAllowed?: boolean;
  isCanceled?: boolean;
}

/** Uses official Baileys' native `event` content (it handles the secret + meta node). */
export async function sendEvent(sock: WASocket, jid: string, e: EventMessage, opts: SendOptions = {}): Promise<WAMessage> {
  const sent = await sock.sendMessage(
    jid,
    {
      event: {
        name: e.name,
        description: e.description,
        startDate: new Date(e.startTime),
        endDate: e.endTime ? new Date(e.endTime) : undefined,
        location: e.location
          ? { name: e.location.name, degreesLatitude: e.location.latitude ?? 0, degreesLongitude: e.location.longitude ?? 0 }
          : undefined,
        isCancelled: !!e.isCanceled,
        extraGuestsAllowed: e.extraGuestsAllowed !== false,
      },
      ...(opts.contextInfo ? { contextInfo: opts.contextInfo } : {}),
    } as AnyMessageContent,
    opts.quoted ? { quoted: opts.quoted as WAMessage } : undefined,
  );
  if (!sent) throw new Error("wa-kit: event was not sent");
  return sent;
}

// ---------------------------------------------------------------------------
// Poll result snapshot (shows vote counts, not votable)
// ---------------------------------------------------------------------------

export function sendPollResult(
  sock: WASocket,
  jid: string,
  poll: { name: string; votes: { option: string; count: number }[] },
  opts: SendOptions = {},
): Promise<WAMessage> {
  return relay(
    sock,
    jid,
    {
      pollResultSnapshotMessage: {
        name: poll.name,
        pollVotes: poll.votes.map((v) => ({ optionName: v.option, optionVoteCount: v.count })),
      },
    },
    opts,
  );
}

// ---------------------------------------------------------------------------
// Product card with buttons
// ---------------------------------------------------------------------------

export interface ProductMessage {
  title: string;
  description?: string;
  productId: string;
  retailerId?: string;
  url?: string;
  image: string | Buffer;
  /** price * 1000, e.g. Rs 2,500.00 -> 2_500_000 */
  priceAmount1000?: number;
  currencyCode?: string;
  body?: string;
  footer?: string;
  buttons?: NativeButton[];
  businessOwnerJid?: string;
}

export async function sendProduct(sock: WASocket, jid: string, p: ProductMessage, opts: SendOptions = {}): Promise<WAMessage> {
  const img = await uploadMedia(sock, { image: p.image });
  return relay(
    sock,
    jid,
    viewOnce({
      interactiveMessage: {
        body: { text: p.body ?? "" },
        footer: { text: p.footer ?? "" },
        header: {
          title: p.title,
          hasMediaAttachment: true,
          productMessage: {
            product: {
              productImage: img.imageMessage,
              productId: p.productId,
              title: p.title,
              description: p.description ?? "",
              currencyCode: p.currencyCode ?? "LKR",
              priceAmount1000: p.priceAmount1000,
              retailerId: p.retailerId ?? "",
              url: p.url ?? "",
              productImageCount: 1,
            },
            businessOwnerJid: p.businessOwnerJid ?? me(sock),
          },
        },
        nativeFlowMessage: { buttons: p.buttons ?? [], messageParamsJson: "" },
      },
    }),
    { ...opts, biz: "native_flow" },
  );
}

// ---------------------------------------------------------------------------
// Status with mentions - posts a status, then pings each mentioned user/group
// ---------------------------------------------------------------------------

export type StatusContent =
  | { text: string; font?: number; backgroundColor?: string; textColor?: string }
  | { image: string | Buffer; caption?: string }
  | { video: string | Buffer; caption?: string }
  | { audio: string | Buffer; ptt?: boolean; backgroundColor?: string };

/**
 * Posts a status visible to you + the mentioned users (+ every member of
 * mentioned groups), then sends each mention a status-mention notice.
 * `mentions` accepts user JIDs and group JIDs.
 */
export async function sendStatusMention(
  sock: WASocket,
  content: StatusContent,
  mentions: string[],
  opts: { delayMs?: number } = {},
): Promise<WAMessage> {
  const audience = new Set<string>([me(sock)]);
  for (const id of mentions) {
    if (isJidGroup(id)) {
      const meta = await sock.groupMetadata(id);
      meta.participants.forEach((p) => audience.add(jidNormalizedUser(p.id)));
    } else {
      audience.add(jidNormalizedUser(id));
    }
  }

  const randomColor = () => `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`;
  const src = (v: string | Buffer) => (typeof v === "string" ? { url: v } : v);

  let msgContent: AnyMessageContent;
  const extra: { font?: number; backgroundColor?: string; textColor?: string } = {};
  if ("text" in content) {
    msgContent = { text: content.text };
    extra.font = content.font ?? 0;
    extra.backgroundColor = content.backgroundColor ?? randomColor();
    extra.textColor = content.textColor ?? "#FFFFFF";
  } else if ("image" in content) {
    msgContent = { image: src(content.image), caption: content.caption };
  } else if ("video" in content) {
    msgContent = { video: src(content.video), caption: content.caption };
  } else {
    msgContent = { audio: src(content.audio), ptt: content.ptt ?? true, mimetype: "audio/ogg; codecs=opus" };
    extra.backgroundColor = content.backgroundColor ?? randomColor();
  }

  const status = await generateWAMessage(STATUS_JID, msgContent, {
    userJid: me(sock),
    upload: sock.waUploadToServer,
    ...extra,
  } as Parameters<typeof generateWAMessage>[2]);

  await sock.relayMessage(STATUS_JID, status.message!, {
    messageId: status.key.id!,
    statusJidList: [...audience],
    additionalNodes: [
      {
        tag: "meta",
        attrs: {},
        content: [
          {
            tag: "mentioned_users",
            attrs: {},
            content: mentions.map((jid) => ({ tag: "to", attrs: { jid: jidNormalizedUser(jid) }, content: undefined })),
          },
        ],
      },
    ],
  });

  for (const id of mentions) {
    const target = jidNormalizedUser(id);
    const isGroup = !!isJidGroup(target);
    const type = isGroup ? "groupStatusMentionMessage" : "statusMentionMessage";
    const notice = generateWAMessageFromContent(
      target,
      {
        [type]: { message: { protocolMessage: { key: status.key, type: 25 } } },
        messageContextInfo: { messageSecret: randomBytes(32) },
      } as proto.IMessage,
      { userJid: me(sock) },
    );
    await sock.relayMessage(target, notice.message!, {
      messageId: notice.key.id!,
      additionalNodes: [
        { tag: "meta", attrs: isGroup ? { is_group_status_mention: "true" } : { is_status_mention: "true" } },
      ],
    });
    await delay(opts.delayMs ?? 2000);
  }

  return status;
}
