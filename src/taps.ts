import { normalizeMessageContent, type WAMessage, type proto } from "baileys";

/**
 * The id behind a button / list tap, whatever shape the tapper's WhatsApp
 * version sends it in. Returns undefined for normal messages.
 * Disappearing-message, view-once, edited... wrappers are unwrapped first.
 */
export function getTapId(message: proto.IMessage | null | undefined): string | undefined {
  const m = normalizeMessageContent(message);
  if (!m) return undefined;

  const paramsJson = m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (paramsJson) {
    try {
      const params = JSON.parse(paramsJson) as { id?: string };
      if (params.id) return params.id;
    } catch {
      // fall through to legacy shapes
    }
  }

  return (
    m.buttonsResponseMessage?.selectedButtonId ??
    m.listResponseMessage?.singleSelectReply?.selectedRowId ??
    m.templateButtonReplyMessage?.selectedId ??
    undefined
  );
}

/** Text the user "said": typed text, caption, or a tap id. */
export function getText(msg: WAMessage | proto.IWebMessageInfo): string {
  const inner = normalizeMessageContent(msg.message);
  if (!inner) return "";
  return (
    inner.conversation ??
    inner.extendedTextMessage?.text ??
    getTapId(inner) ??
    inner.imageMessage?.caption ??
    inner.videoMessage?.caption ??
    inner.documentMessage?.caption ??
    ""
  );
}

/** The quoted message's id - also for taps, whose contextInfo points at the button message. */
export function getQuotedId(msg: WAMessage | proto.IWebMessageInfo): string | undefined {
  const m = normalizeMessageContent(msg.message);
  if (!m) return undefined;
  const withCtx = Object.values(m).find(
    (v): v is { contextInfo?: proto.IContextInfo } => !!v && typeof v === "object" && "contextInfo" in v,
  );
  return withCtx?.contextInfo?.stanzaId ?? undefined;
}
