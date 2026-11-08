import { randomBytes } from "node:crypto";
import {
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  type BinaryNode,
  type WASocket,
  type WAMessage,
  type proto,
} from "baileys";

/**
 * Everything in wa-kit funnels through relay(): build the proto with
 * official Baileys' generateWAMessageFromContent, then relayMessage() it with
 * optional extra stanza nodes. Nothing here runs on its own - no timers,
 * no auto-follow, no network calls other than the message you asked to send.
 */

export type Media =
  | { image: string | Buffer }
  | { video: string | Buffer }
  | { document: string | Buffer; mimetype?: string; fileName?: string; jpegThumbnail?: Buffer };

export interface SendOptions {
  quoted?: WAMessage | proto.IWebMessageInfo;
  /** Merged into the message's contextInfo (mentions, channel badge, ...) */
  contextInfo?: proto.IContextInfo;
  /** Extra stanza nodes for relayMessage (wa-kit adds the <biz> node itself) */
  additionalNodes?: BinaryNode[];
}

/** Which <biz> node a message needs for WhatsApp to render it. */
export type BizKind = "native_flow" | "legacy_buttons" | "none";

/**
 * The <biz> stanza node is what makes WhatsApp actually render buttons/lists
 * sent from a non-business client. Ported from ourin-baileys'
 * getAdditionalNode() (generic-utils.js) - official Baileys leaves this to you.
 */
export function bizNode(kind: BizKind, flowName = "mixed"): BinaryNode[] {
  if (kind === "none") return [];
  const nativeFlow: BinaryNode = {
    tag: "interactive",
    attrs: { type: "native_flow", v: "1" },
    content: [{ tag: "native_flow", attrs: { v: "9", name: flowName }, content: [] }],
  };
  if (kind === "legacy_buttons") return [{ tag: "biz", attrs: {}, content: [nativeFlow] }];
  return [
    {
      tag: "biz",
      attrs: {
        actual_actors: "2",
        host_storage: "2",
        privacy_mode_ts: String(Math.floor(Date.now() / 1000) - 77980457),
      },
      content: [
        { tag: "engagement", attrs: { customer_service_state: "open", conversation_state: "open" } },
        nativeFlow,
      ],
    },
  ];
}

/** Upload media once and return the ready proto (imageMessage / videoMessage / documentMessage). */
export async function uploadMedia(sock: WASocket, media: Media): Promise<proto.IMessage> {
  const src = (v: string | Buffer) => (typeof v === "string" ? { url: v } : v);
  if ("image" in media) return prepareWAMessageMedia({ image: src(media.image) }, { upload: sock.waUploadToServer });
  if ("video" in media) return prepareWAMessageMedia({ video: src(media.video) }, { upload: sock.waUploadToServer });
  const doc = await prepareWAMessageMedia(
    { document: src(media.document), mimetype: media.mimetype ?? "application/octet-stream", fileName: media.fileName },
    { upload: sock.waUploadToServer },
  );
  if (media.jpegThumbnail && doc.documentMessage) doc.documentMessage.jpegThumbnail = media.jpegThumbnail;
  return doc;
}

/** Wraps content the way WhatsApp expects interactive messages: viewOnce + messageSecret. */
export function viewOnce(message: proto.IMessage): proto.IMessage {
  return {
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2, messageSecret: randomBytes(32) },
        ...message,
      },
    },
  };
}

function myJid(sock: WASocket): string {
  const id = sock.user?.id;
  if (!id) throw new Error("wa-kit: socket is not logged in yet");
  return id;
}

/** Merge extra contextInfo into the first real content key of a (possibly wrapped) message. */
function applyContextInfo(message: proto.IMessage, ctx?: proto.IContextInfo): void {
  if (!ctx) return;
  const inner = (message.viewOnceMessage?.message ?? message) as Record<string, { contextInfo?: proto.IContextInfo } | undefined>;
  const key = Object.keys(inner).find((k) => k !== "messageContextInfo" && inner[k] && typeof inner[k] === "object");
  if (!key) return;
  inner[key]!.contextInfo = { ...(inner[key]!.contextInfo ?? {}), ...ctx };
}

export async function relay(
  sock: WASocket,
  jid: string,
  message: proto.IMessage,
  opts: SendOptions & { biz?: BizKind } = {},
): Promise<WAMessage> {
  applyContextInfo(message, opts.contextInfo);

  const msg = generateWAMessageFromContent(jid, message, {
    userJid: myJid(sock),
    quoted: opts.quoted as WAMessage | undefined,
  });

  const isNewsletter = jid.endsWith("@newsletter");
  const isStatus = jid === "status@broadcast";
  const biz = isNewsletter || isStatus ? [] : bizNode(opts.biz ?? "none");

  await sock.relayMessage(jid, msg.message!, {
    messageId: msg.key.id!,
    additionalNodes: [...biz, ...(opts.additionalNodes ?? [])],
  });
  return msg;
}
