# @future-innovations-lk/wa-kit

Buttons, lists, carousels, albums, events, rich tables/links and newsletter
helpers on top of **official Baileys** (`baileys@7.0.0-rc14`).

Replaces `ourin-baileys` (flagged malicious: MAL-2026-18412). **Nothing runs on
its own** — no timers, no auto-follow, no network calls except the message you send.

```ts
import { createKit, btn } from "@future-innovations-lk/wa-kit";

const kit = createKit(sock);

await kit.buttons()
  .text("Hello!").footer("My Bot")
  .image("https://example.com/banner.jpg")
  .reply("🧾 Menu", ".menu")
  .url("🌐 Site", "https://example.com")
  .copy("📋 Code", "ABC123")
  .select("📂 Select Menu", [{ title: "Main", rows: [{ id: ".ping", title: "Ping" }] }])
  .send(jid, { quoted: msg });
```

## What's inside

| Feature | Function | Tested (phone / web) |
|---|---|---|
| Native buttons: reply, url, copy, call, reminder, address, location | `Buttons`, `sendButtons`, `btn.*` | ✅ / ❌ web can't show |
| Select list (sections, highlight label) | `sendList`, `btn.select` | ✅ / ❌ web can't show |
| Legacy ButtonV2 | `sendButtonsV2` | ✅ / ❌ |
| Carousel | `Carousel`, `sendCarousel` | ✅ / ✅ |
| Album | `sendAlbum` | ✅ / ✅ |
| Event | `sendEvent` | ✅ / ✅ |
| Poll result | `sendPollResult` | ✅ / ✅ |
| Product card | `sendProduct` | untested |
| Status with mentions | `sendStatusMention` | untested |
| Table / key-value | `sendTable`, `sendKeyValue` | ✅ / ✅ |
| Inline links | `sendLink`, `sendLinkV2` | ✅ / ✅ |
| Channel badge ("View channel") | `channelBadge` | ✅ / ✅ |
| Newsletter: resolve link, follow/unfollow many, isFollowing, post | `resolveNewsletter`, `followNewsletters`, ... | resolve untested |
| Tap parsing | `getTapId`, `getText` | ✅ |

Official Baileys already covers the rest of the newsletter API
(`sock.newsletterCreate/Follow/Mute/Update/ReactMessage/FetchMessages/...`).

## Notes

- **Buttons need the `<biz>` stanza node** — wa-kit adds it automatically
  (`relay()` / `bizNode()`); that's the trick ourin used.
- Interactive messages (buttons/lists) render on phones, not on WhatsApp Web.
- `sendTable` / `sendLink*` mimic Meta AI rich responses — undocumented, may
  break; keep a plain-text fallback for anything important.
- Taps arrive as `interactiveResponseMessage`; `getText(msg)` returns the
  button/row `id`, so give every button a full command as its id.

## Build / publish

```bash
pnpm install && pnpm build
npm publish --access public   # needs an npm login with access to @future-innovations-lk
```
