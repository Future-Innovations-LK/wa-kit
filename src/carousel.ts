import type { WASocket, WAMessage, proto } from "baileys";
import { relay, uploadMedia, viewOnce, type Media, type SendOptions } from "./core.js";
import type { NativeButton } from "./buttons.js";

export interface CarouselCard {
  /** Every card needs an image or video - WhatsApp rejects cards without media */
  media: Extract<Media, { image: unknown } | { video: unknown }>;
  title?: string;
  text?: string;
  footer?: string;
  buttons?: NativeButton[];
}

export interface CarouselMessage {
  text?: string;
  footer?: string;
  cards: CarouselCard[];
}

/** Swipeable cards, each with its own media, text and buttons. Max 10 cards. */
export async function sendCarousel(
  sock: WASocket,
  jid: string,
  m: CarouselMessage,
  opts: SendOptions = {},
): Promise<WAMessage> {
  if (!m.cards.length) throw new Error("wa-kit: carousel needs at least one card");
  if (m.cards.length > 10) throw new Error("wa-kit: carousel supports at most 10 cards");

  const cards: proto.Message.IInteractiveMessage[] = await Promise.all(
    m.cards.map(async (card, i) => {
      if (!card.media) throw new Error(`wa-kit: carousel card ${i} needs an image or video`);
      const uploaded = (await uploadMedia(sock, card.media)) as proto.Message.InteractiveMessage.IHeader;
      return {
        header: { title: card.title ?? "", hasMediaAttachment: true, ...uploaded },
        body: { text: card.text ?? "" },
        footer: { text: card.footer ?? "" },
        nativeFlowMessage: { buttons: card.buttons ?? [], messageParamsJson: "" },
      };
    }),
  );

  const interactiveMessage: proto.Message.IInteractiveMessage = {
    body: { text: m.text ?? "" },
    footer: { text: m.footer ?? "" },
    header: { title: "", hasMediaAttachment: false },
    carouselMessage: { cards, messageVersion: 1 },
  };

  return relay(sock, jid, viewOnce({ interactiveMessage }), { ...opts, biz: "native_flow" });
}

/** Chainable builder. */
export class Carousel {
  private m: CarouselMessage = { cards: [] };
  constructor(private readonly sock: WASocket) {}
  text(t: string) { this.m.text = t; return this; }
  footer(t: string) { this.m.footer = t; return this; }
  card(card: CarouselCard) { this.m.cards.push(card); return this; }
  send(jid: string, opts: SendOptions = {}) { return sendCarousel(this.sock, jid, this.m, opts); }
}
