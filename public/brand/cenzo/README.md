# Cenzo — brand mascot of Regalos Que Cantan

**Cenzo** is a Mexican cenzontle (northern mockingbird — the legendary "bird of 400
voices," from the Nahuatl poem attributed to Nezahualcóyotl) with **alebrije
folk-art painted wings**: turquoise, magenta, marigold and indigo patterns with
white dot-work on a natural gray body, cream-yellow chest with an orange throat
wash. He perches on a classical guitar headstock in a warm Mexican courtyard.

Brand story: *"Cenzo, el cenzontle de las 400 voces — el pájaro que canta tu
historia."* An ordinary bird with extraordinary wings = an ordinary story turned
into an extraordinary song. He signs social posts "— Cenzo 🎶".

## Two render tiers (same character)

- **Movie-real tier** (`cenzo-master.png` and everything derived from it):
  cute live-action look — photoreal feathers, oversized head, huge amber eyes.
  This is the tier for social media where Cenzo talks/sings on camera.
- **Pixar tier** (`cenzo-pixar-master.png`): fully animated cartoon version,
  for Animado-style and illustrated/branded content.

## Files

| File | What it is |
|---|---|
| `cenzo-master.png` | THE master character reference (movie-real tier). Pass as `image_urls` ref for all new generations. |
| `cenzo-pixar-master.png` | Master for the Pixar cartoon tier |
| `cenzo-hero-9x16.png` | Vertical hero for TikTok/Reels (headroom for text) |
| `cenzo-wave.png` | 1:1 greeting/intro frame (waving at camera) |
| `cenzo-side.png` | Side-profile turnaround reference |
| `cenzo-back-wings.png` | Back 3/4 turnaround, full wing/tail patterns |
| `cenzo-expressions.png` | 2x2 expression sheet: laugh / tender / surprised / proud-singing |
| `cenzo-sing.mp4` | 5s acting test: sings to camera (silent) |
| `cenzo-talk.mp4` | 5s acting test: talks/hosts to camera (silent) |
| `cenzo-intro.mp4` | HIS OFFICIAL INTRO — 10s, VOICED: "¡Hola! Soy Cenzo…" (owner-chosen voice) |
| `cenzo-voice-reference.mp3` | Canonical voice sample extracted from the intro — use for voice cloning / matching |

## Brand kit

| File | Use |
|---|---|
| `cenzo-avatar.png` | 1:1 social profile picture (all platforms) |
| `cenzo-logo-lockup.png` | Logo + "Regalos Que Cantan" wordmark |
| `cenzo-icon.png` | App icon / favicon (fan-wing mark on terracotta) |
| `cenzo-mark-flat.png` | Flat mark v1 (deprecated — too close to the Twitter bird; prefer `cenzo-icon.png`) |
| `cenzo-cover-banner.png` | Wide cover banner, text space on the left |
| `cenzo-outro-9x16.png` | Reel/TikTok outro card (papel picado header + text space) |
| `cenzo-reel-frame.png` | 9:16 overlay frame with Cenzo in the corner |
| `cenzo-stickers.png` | 6 WhatsApp stickers (kiss, happy tears, singing, pointing, rose, celebration) — split into individual 512px stickers before use |
| `cenzo-pattern.png` | Seamless feather/note pattern for backgrounds |
| `cenzo-brand-board.png` | Brand board: character + palette + motifs |
| `cenzo-merch-preview.png` | Mug + tote mockup |

Palette (from the board): terracotta, marigold gold, magenta, turquoise, cream.

**Never AI-render the wordmark.** The v1 lockup came back as "Regalos Rue Cantan".
`cenzo-logo-lockup.png` (v2) is spelled correctly, but for any new lockup set the
type in real fonts (Playfair Display) over the bird instead of generating text.

## Voice (owner-chosen 2026-08-11)

Cenzo's voice is a **kind elderly male voice in Mexican Spanish, 70s, warm and
grandfatherly like an abuelo telling stories in the plaza — slightly raspy,
wise, affectionate, unhurried.** Use that exact description in every Seedance
`generate_audio` prompt, and A/B the result by ear against
`cenzo-voice-reference.mp3`. Seedance voices drift between generations; for
strict consistency, clone the reference mp3 into a fixed TTS voice.
(Owner first picked the playful-young voice, then switched to this elder voice
same day — the elder is final.)

## How to generate more Cenzo (the recipe that made all of this)

Same pipeline as the Ace agent persona, via the `test-kie-video` edge function:

1. **Images**: Kie `google/nano-banana-edit` with `image_urls: [<public URL of
   cenzo-master.png>]` + a prompt starting "Keep the EXACT same bird character:
   same cute realistic style, same gray head, huge amber eyes, cream-yellow chest
   with orange throat wash, same alebrije-painted wing and tail feathers…".
   Note: nano-banana-edit will NOT change art style (cartoon→real fails);
   to switch tiers, generate from scratch with `google/nano-banana`.
2. **Video**: Kie `bytedance/seedance-2` with `first_frame_url` = the image
   (set `last_frame_url` to the same image for perfect loops).

Owner decisions (2026-08-11): plain/undecorated bird designs rejected — the
alebrije decoration IS the identity. Name "Cenzo" chosen over Canto/Trino.
