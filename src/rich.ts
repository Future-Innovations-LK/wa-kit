import { randomBytes, randomUUID } from "node:crypto";
import type { WASocket, WAMessage, proto } from "baileys";
import { relay, type SendOptions } from "./core.js";

/**
 * "Meta AI style" rich messages (tables, links). These render as a message
 * forwarded from WhatsApp's AI bot - it's an undocumented format WhatsApp can
 * change or stop rendering any time. Use them for fun extras, and keep a
 * plain-text fallback for anything important.
 */

const META_AI_BOT = "867051314767696@bot";

interface Submessage {
  messageType: number;
  messageText?: string;
  tableMetadata?: { title: string; rows: { items: string[]; isHeading?: boolean }[] };
}

function richContext(forwardingScore = 1): proto.IContextInfo {
  return {
    forwardingScore,
    isForwarded: true,
    forwardedAiBotMessageInfo: { botJid: META_AI_BOT },
    forwardOrigin: 4,
  } as proto.IContextInfo;
}

function richMessage(submessages: Submessage[], ctx: proto.IContextInfo, unifiedData?: object): proto.IMessage {
  return {
    messageContextInfo: { messageSecret: randomBytes(32) },
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          submessages,
          contextInfo: ctx,
          ...(unifiedData
            ? { unifiedResponse: { data: Buffer.from(JSON.stringify(unifiedData)) } }
            : {}),
        },
      },
    },
  } as proto.IMessage;
}

export interface RichOptions extends SendOptions {
  headerText?: string;
  footer?: string;
}

function wrapText(subs: Submessage[], opts: RichOptions): Submessage[] {
  return [
    ...(opts.headerText ? [{ messageType: 2, messageText: opts.headerText }] : []),
    ...subs,
    ...(opts.footer ? [{ messageType: 2, messageText: opts.footer }] : []),
  ];
}

/** A real table bubble with a heading row. */
export function sendTable(
  sock: WASocket,
  jid: string,
  title: string,
  headers: string[],
  rows: (string | number)[][],
  opts: RichOptions = {},
): Promise<WAMessage> {
  const table: Submessage = {
    messageType: 4,
    tableMetadata: {
      title,
      rows: [{ items: headers, isHeading: true }, ...rows.map((r) => ({ items: r.map(String) }))],
    },
  };
  return relay(sock, jid, richMessage(wrapText([table], opts), richContext()), { quoted: opts.quoted });
}

/** Key/value list rendered as a borderless table, e.g. [["Name", "Bot"], ["Version", "2"]]. */
export function sendKeyValue(
  sock: WASocket,
  jid: string,
  title: string,
  items: (string | number)[][],
  opts: RichOptions = {},
): Promise<WAMessage> {
  const table: Submessage = {
    messageType: 4,
    tableMetadata: { title, rows: items.map((r) => ({ items: r.map(String) })) },
  };
  return relay(sock, jid, richMessage(wrapText([table], opts), richContext()), { quoted: opts.quoted });
}

export interface LinkItem {
  url: string;
  /** Text shown for the link */
  displayName?: string;
}

/**
 * Text with inline clickable links. Mark them in the text as
 * `{{IE_0}}click here{{/IE_0}}`, `{{IE_1}}...{{/IE_1}}` matching `links` order.
 */
export function sendLink(
  sock: WASocket,
  jid: string,
  text: string,
  links: (string | LinkItem)[],
  opts: RichOptions & { forwardingScore?: number } = {},
): Promise<WAMessage> {
  const items = links.map((l) => (typeof l === "string" ? { url: l } : l));
  const sections: object[] = [
    {
      view_model: {
        primitive: {
          text,
          inline_entities: items.map((l, i) => ({
            key: `IE_${i}`,
            metadata: {
              display_name: l.displayName ?? `Link ${i + 1}`,
              is_trusted: false,
              url: l.url,
              __typename: "GenAIInlineLinkItem",
            },
          })),
          __typename: "GenAIMarkdownTextUXPrimitive",
        },
        __typename: "GenAISingleLayoutViewModel",
      },
    },
  ];
  if (opts.footer) {
    sections.push({
      view_model: {
        primitive: { text: opts.footer, __typename: "GenAIMarkdownTextUXPrimitive" },
        __typename: "GenAISingleLayoutViewModel",
      },
    });
  }
  const score = opts.forwardingScore ?? 3;
  const ctx = { ...richContext(score), botMessageSharingInfo: { forwardScore: score } } as proto.IContextInfo;
  const plain = opts.footer ? `${text}${opts.footer}` : text;
  return relay(
    sock,
    jid,
    richMessage([{ messageType: 2, messageText: plain }], ctx, { response_id: randomUUID(), sections }),
    { quoted: opts.quoted },
  );
}

export interface SearchLinkItem extends LinkItem {
  sourceName?: string;
  sourceSubtitle?: string;
}

/** Like sendLink, plus a "sources" strip under the text (search-result style). */
export function sendLinkV2(
  sock: WASocket,
  jid: string,
  text: string,
  links: SearchLinkItem[],
  opts: RichOptions & { searchEngine?: string } = {},
): Promise<WAMessage> {
  const source = (l: SearchLinkItem, i: number) => ({
    source_type: "THIRD_PARTY",
    source_display_name: l.sourceName ?? `Source ${i + 1}`,
    source_subtitle: l.sourceSubtitle ?? "",
    source_url: l.url,
  });
  const sections: object[] = [
    {
      view_model: {
        primitive: {
          text,
          inline_entities: links.map((l, i) => ({
            key: `IE_${i}`,
            metadata: {
              reference_id: i + 1,
              reference_url: l.url,
              reference_title: l.displayName ?? `Link ${i + 1}`,
              reference_display_name: l.displayName ?? `Link ${i + 1}`,
              sources: [source(l, i)],
              __typename: "GenAISearchCitationItem",
            },
          })),
          __typename: "GenAIMarkdownTextUXPrimitive",
        },
        __typename: "GenAISingleLayoutViewModel",
      },
    },
    {
      view_model: {
        primitive: {
          sources: links.map(source),
          search_engine: opts.searchEngine ?? "MAME",
          __typename: "GenAISearchResultPrimitive",
        },
        __typename: "GenAISingleLayoutViewModel",
      },
    },
  ];
  if (opts.footer) {
    sections.push({
      view_model: {
        primitive: { text: opts.footer, __typename: "GenAIMarkdownTextUXPrimitive" },
        __typename: "GenAISingleLayoutViewModel",
      },
    });
  }
  const plain = opts.footer ? `${text}${opts.footer}` : text;
  return relay(
    sock,
    jid,
    richMessage([{ messageType: 2, messageText: plain }], richContext(3), { response_id: randomUUID(), sections }),
    { quoted: opts.quoted },
  );
}
