export { relay, bizNode, uploadMedia, viewOnce, type Media, type SendOptions, type BizKind } from "./core.js";
export {
  btn,
  Buttons,
  sendButtons,
  sendList,
  sendButtonsV2,
  buildInteractive,
  type NativeButton,
  type ListRow,
  type ListSection,
  type ButtonsMessage,
  type LegacyButtonsMessage,
} from "./buttons.js";
export { Carousel, sendCarousel, type CarouselCard, type CarouselMessage } from "./carousel.js";
export {
  sendAlbum,
  sendEvent,
  sendPollResult,
  sendProduct,
  sendStatusMention,
  type AlbumItem,
  type EventMessage,
  type ProductMessage,
  type StatusContent,
} from "./messages.js";
export {
  sendTable,
  sendKeyValue,
  sendLink,
  sendLinkV2,
  type RichOptions,
  type LinkItem,
  type SearchLinkItem,
} from "./rich.js";
export {
  parseChannelLink,
  resolveNewsletter,
  newsletterIdFromLink,
  followNewsletters,
  unfollowNewsletters,
  isFollowing,
  channelBadge,
  postToNewsletter,
  type NewsletterMeta,
  type BulkResult,
} from "./newsletter.js";
export { getTapId, getText, getQuotedId } from "./taps.js";

import type { WASocket } from "baileys";
import { Buttons, sendButtons, sendList, sendButtonsV2 } from "./buttons.js";
import { Carousel, sendCarousel } from "./carousel.js";
import { sendAlbum, sendEvent, sendPollResult, sendProduct, sendStatusMention } from "./messages.js";
import { sendTable, sendKeyValue, sendLink, sendLinkV2 } from "./rich.js";
import { resolveNewsletter, followNewsletters, unfollowNewsletters, isFollowing, postToNewsletter } from "./newsletter.js";

export type Tail<F> = F extends (sock: WASocket, ...rest: infer R) => infer Ret ? (...args: R) => Ret : never;
const bind = <F extends (sock: WASocket, ...a: never[]) => unknown>(sock: WASocket, fn: F) =>
  ((...args: unknown[]) => (fn as unknown as (...a: unknown[]) => unknown)(sock, ...args)) as Tail<F>;

/**
 * Everything bound to one socket:
 *   const kit = createKit(sock)
 *   await kit.buttons().text("Hi").reply("Menu", ".menu").send(jid)
 *   await kit.sendCarousel(jid, { cards: [...] })
 */
export function createKit(sock: WASocket): Kit {
  return {
    sock,
    buttons: () => new Buttons(sock),
    carousel: () => new Carousel(sock),
    sendButtons: bind(sock, sendButtons),
    sendList: bind(sock, sendList),
    sendButtonsV2: bind(sock, sendButtonsV2),
    sendCarousel: bind(sock, sendCarousel),
    sendAlbum: bind(sock, sendAlbum),
    sendEvent: bind(sock, sendEvent),
    sendPollResult: bind(sock, sendPollResult),
    sendProduct: bind(sock, sendProduct),
    sendStatusMention: bind(sock, sendStatusMention),
    sendTable: bind(sock, sendTable),
    sendKeyValue: bind(sock, sendKeyValue),
    sendLink: bind(sock, sendLink),
    sendLinkV2: bind(sock, sendLinkV2),
    newsletter: {
      resolve: bind(sock, resolveNewsletter),
      followMany: bind(sock, followNewsletters),
      unfollowMany: bind(sock, unfollowNewsletters),
      isFollowing: bind(sock, isFollowing),
      post: bind(sock, postToNewsletter),
    },
  };
}

export interface Kit {
  sock: WASocket;
  buttons(): Buttons;
  carousel(): Carousel;
  sendButtons: Tail<typeof sendButtons>;
  sendList: Tail<typeof sendList>;
  sendButtonsV2: Tail<typeof sendButtonsV2>;
  sendCarousel: Tail<typeof sendCarousel>;
  sendAlbum: Tail<typeof sendAlbum>;
  sendEvent: Tail<typeof sendEvent>;
  sendPollResult: Tail<typeof sendPollResult>;
  sendProduct: Tail<typeof sendProduct>;
  sendStatusMention: Tail<typeof sendStatusMention>;
  sendTable: Tail<typeof sendTable>;
  sendKeyValue: Tail<typeof sendKeyValue>;
  sendLink: Tail<typeof sendLink>;
  sendLinkV2: Tail<typeof sendLinkV2>;
  newsletter: {
    resolve: Tail<typeof resolveNewsletter>;
    followMany: Tail<typeof followNewsletters>;
    unfollowMany: Tail<typeof unfollowNewsletters>;
    isFollowing: Tail<typeof isFollowing>;
    post: Tail<typeof postToNewsletter>;
  };
}
