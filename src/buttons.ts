import { randomUUID } from "node:crypto";
import type { WASocket, WAMessage, proto } from "baileys";
import { relay, uploadMedia, viewOnce, type Media, type SendOptions } from "./core.js";

// ---------------------------------------------------------------------------
// Native-flow button factories (every type ourin's Button builder supported,
// minus payments)
// ---------------------------------------------------------------------------

export interface NativeButton {
  name: string;
  buttonParamsJson: string;
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
  header?: string;
}

export interface ListSection {
  title: string;
  highlightLabel?: string;
  rows: ListRow[];
}

const nb = (name: string, params: object): NativeButton => ({ name, buttonParamsJson: JSON.stringify(params) });

export const btn = {
  /** Tap sends `id` back as an interactiveResponseMessage - see getTapId() */
  reply: (text: string, id: string) => nb("quick_reply", { display_text: text, id }),
  url: (text: string, url: string, opts: { inApp?: boolean } = {}) =>
    nb("cta_url", { display_text: text, url, merchant_url: url, webview_interaction: !!opts.inApp }),
  copy: (text: string, code: string) => nb("cta_copy", { display_text: text, id: code, copy_code: code }),
  call: (text: string, phoneNumber: string) => nb("cta_call", { display_text: text, phone_number: phoneNumber }),
  reminder: (text: string, id: string = randomUUID()) => nb("cta_reminder", { display_text: text, id }),
  cancelReminder: (text: string, id: string = randomUUID()) => nb("cta_cancel_reminder", { display_text: text, id }),
  /** Asks the user for a delivery address */
  address: (text: string, id: string = randomUUID()) => nb("address_message", { display_text: text, id }),
  /** Asks the user to share their location */
  location: () => nb("send_location", {}),
  /** The "📂 Select Menu" list */
  select: (title: string, sections: ListSection[]) =>
    nb("single_select", {
      title,
      sections: sections.map((s) => ({
        title: s.title,
        ...(s.highlightLabel ? { highlight_label: s.highlightLabel } : {}),
        rows: s.rows.map((r) => ({
          id: r.id,
          title: r.title,
          ...(r.description ? { description: r.description } : {}),
          ...(r.header ? { header: r.header } : {}),
        })),
      })),
    }),
  /** Escape hatch for any native-flow button not listed here */
  raw: (name: string, params: object | string): NativeButton => ({
    name,
    buttonParamsJson: typeof params === "string" ? params : JSON.stringify(params),
  }),
};

// ---------------------------------------------------------------------------
// sendButtons - one call for buttons, lists and media headers
// ---------------------------------------------------------------------------

export interface ButtonsMessage {
  text: string;
  footer?: string;
  title?: string;
  subtitle?: string;
  media?: Media;
  /** Show a map pin as the header instead of media */
  location?: { latitude: number; longitude: number; name?: string };
  buttons: NativeButton[];
}

export async function buildInteractive(sock: WASocket, m: ButtonsMessage): Promise<proto.Message.IInteractiveMessage> {
  let headerContent: proto.Message.InteractiveMessage.IHeader = {};
  let hasMedia = false;

  if (m.media) {
    headerContent = (await uploadMedia(sock, m.media)) as proto.Message.InteractiveMessage.IHeader;
    hasMedia = true;
  } else if (m.location) {
    headerContent = {
      locationMessage: {
        degreesLatitude: m.location.latitude,
        degreesLongitude: m.location.longitude,
        name: m.location.name ?? "",
      },
    };
    hasMedia = true;
  }

  return {
    body: { text: m.text },
    footer: { text: m.footer ?? "" },
    header: { title: m.title ?? "", subtitle: m.subtitle ?? "", hasMediaAttachment: hasMedia, ...headerContent },
    nativeFlowMessage: { buttons: m.buttons, messageParamsJson: "" },
  };
}

export async function sendButtons(
  sock: WASocket,
  jid: string,
  m: ButtonsMessage,
  opts: SendOptions = {},
): Promise<WAMessage> {
  if (!m.buttons.length) throw new Error("wa-kit: sendButtons needs at least one button");
  const interactiveMessage = await buildInteractive(sock, m);
  return relay(sock, jid, viewOnce({ interactiveMessage }), { ...opts, biz: "native_flow" });
}

/** Shortcut for a single "📂 Select Menu" list. */
export function sendList(
  sock: WASocket,
  jid: string,
  m: Omit<ButtonsMessage, "buttons"> & { buttonText: string; sections: ListSection[] },
  opts: SendOptions = {},
): Promise<WAMessage> {
  const { buttonText, sections, ...rest } = m;
  return sendButtons(sock, jid, { ...rest, buttons: [btn.select(buttonText, sections)] }, opts);
}

/** Chainable builder, same feel as ourin's `new Button(sock)`. */
export class Buttons {
  private m: ButtonsMessage = { text: "", buttons: [] };
  constructor(private readonly sock: WASocket) {}

  text(t: string) { this.m.text = t; return this; }
  footer(t: string) { this.m.footer = t; return this; }
  title(t: string) { this.m.title = t; return this; }
  subtitle(t: string) { this.m.subtitle = t; return this; }
  image(src: string | Buffer) { this.m.media = { image: src }; return this; }
  video(src: string | Buffer) { this.m.media = { video: src }; return this; }
  document(src: string | Buffer, opts: { mimetype?: string; fileName?: string } = {}) {
    this.m.media = { document: src, ...opts };
    return this;
  }
  locationHeader(latitude: number, longitude: number, name?: string) {
    this.m.location = { latitude, longitude, name };
    return this;
  }

  reply(text: string, id: string) { this.m.buttons.push(btn.reply(text, id)); return this; }
  url(text: string, url: string, inApp = false) { this.m.buttons.push(btn.url(text, url, { inApp })); return this; }
  copy(text: string, code: string) { this.m.buttons.push(btn.copy(text, code)); return this; }
  call(text: string, phone: string) { this.m.buttons.push(btn.call(text, phone)); return this; }
  reminder(text: string, id?: string) { this.m.buttons.push(btn.reminder(text, id)); return this; }
  cancelReminder(text: string, id?: string) { this.m.buttons.push(btn.cancelReminder(text, id)); return this; }
  address(text: string, id?: string) { this.m.buttons.push(btn.address(text, id)); return this; }
  location() { this.m.buttons.push(btn.location()); return this; }
  select(title: string, sections: ListSection[]) { this.m.buttons.push(btn.select(title, sections)); return this; }
  raw(b: NativeButton) { this.m.buttons.push(b); return this; }

  /** Returns the interactiveMessage proto (e.g. to use as a carousel card) */
  build() { return buildInteractive(this.sock, this.m); }
  send(jid: string, opts: SendOptions = {}) { return sendButtons(this.sock, jid, this.m, opts); }
}

// ---------------------------------------------------------------------------
// ButtonV2 - legacy buttonsMessage with a thumbnail (older clients)
// ---------------------------------------------------------------------------

export interface LegacyButtonsMessage {
  text: string;
  footer?: string;
  /** Shown as the "location" title beside the thumbnail */
  title?: string;
  subtitle?: string;
  /** Small JPEG thumbnail (keep it ~300x300) */
  thumbnail?: Buffer;
  buttons: { id: string; text: string }[];
}

export function sendButtonsV2(
  sock: WASocket,
  jid: string,
  m: LegacyButtonsMessage,
  opts: SendOptions = {},
): Promise<WAMessage> {
  if (!m.buttons.length) throw new Error("wa-kit: sendButtonsV2 needs at least one button");
  const message: proto.IMessage = {
    buttonsMessage: {
      contentText: m.text,
      footerText: m.footer ?? "",
      headerType: 6, // LOCATION header = title + thumbnail
      locationMessage: {
        degreesLatitude: 0,
        degreesLongitude: 0,
        name: m.title ?? "",
        address: m.subtitle ?? "",
        ...(m.thumbnail ? { jpegThumbnail: m.thumbnail } : {}),
      },
      buttons: m.buttons.map((b) => ({ buttonId: b.id, buttonText: { displayText: b.text }, type: 1 })),
    },
  };
  return relay(sock, jid, message, { ...opts, biz: "legacy_buttons" });
}
