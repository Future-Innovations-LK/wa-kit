# Changelog

## 0.2.0

- **New `postToChannel()`** (also `kit.newsletter.postToChannel`): text, image
  and video posts to a channel you own/administer. Uploads channel media to
  the unencrypted `/newsletter/` endpoint with the media handle and waits for
  WhatsApp's ack, returning the post's `serverId`. With baileys
  7.0.0-rc14's `sendMessage` (and so `postToNewsletter`) image/video posts
  never appeared and failures looked like successes.
- **New `newsletterInfo()`**: newsletter metadata as plain fields (name,
  description, followers, invite link, role, muted, verified, picture URL),
  whichever response shape WhatsApp used.
- `getText` / `getTapId` / `getQuotedId` now unwrap every wrapper through
  Baileys' `normalizeMessageContent` (view-once v2, ephemeral inside
  view-once, document-with-caption...). Before, taps and captions inside
  those came back empty.
- `postToNewsletter` is documented as text-only (deprecated for media).

## 0.1.0

- First release: buttons, lists, carousels, albums, events, poll results,
  product cards, status mentions, rich tables/links, newsletter helpers and
  tap parsing on top of official Baileys.
