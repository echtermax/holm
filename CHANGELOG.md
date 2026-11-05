# Changelog

What changed in each Holm release, newest first. Holm shows a version's
section in its "What's new" dialog, so each entry is written for the people
using it. Headings are `## <version> — <date>`. One line per change:
**New:**, **Improved:** or **Fixed:**, then a plain line of at most about
twelve words, ending with a link to its PR. Each pull request into `dev` adds
its line under `## Unreleased`; the release pull request renames that heading
to the version and date.

## Unreleased

- **Improved:** YouTube search can answer in a chosen country's language. ([#PR](https://github.com/man15h/holm/pull/PR))

## 0.12.0 — 2026-11-05

- **New:** Search YouTube with `!yt` through an Invidious server. ([#125](https://github.com/man15h/holm/pull/125))
- **New:** Search GitHub and Gitea repos, issues and PRs; `!gh` and `!gt` split them into sections. ([#123](https://github.com/man15h/holm/pull/123))
- **New:** Search Memos and Plane, open results in place, tick memo checklists. ([#122](https://github.com/man15h/holm/pull/122), [#127](https://github.com/man15h/holm/pull/127))
- **New:** Play Navidrome albums and playlists in the corner player, with Shuffle. ([#126](https://github.com/man15h/holm/pull/126))
- **New:** Set the corner player's volume with a slider. ([#126](https://github.com/man15h/holm/pull/126))
- **New:** Set each theme's page colour, like true black, in `config.yml`. ([#126](https://github.com/man15h/holm/pull/126))
- **Improved:** Opening a search result keeps the results open for the next one. ([#123](https://github.com/man15h/holm/pull/123))
- **Fixed:** No more iOS top blur in the installed app; phone search stays on screen. ([#120](https://github.com/man15h/holm/pull/120))
- **Fixed:** An app switched off for search still answers its `!` shortcut. ([#123](https://github.com/man15h/holm/pull/123))

## 0.11.0 — 2026-10-25

- **New:** Health check widgets built into apps, supporting Kener, Uptime Kuma, Gatus and Cachet. ([#114](https://github.com/man15h/holm/pull/114))
- **New:** Search Thingport 3D models with `!tp`, including collections and tags. ([#107](https://github.com/man15h/holm/pull/107))
- **New:** Under `!b`, pick a Karakeep tag or list to search deep inside it. ([#108](https://github.com/man15h/holm/pull/108))
- **Fixed:** The ⌘K actions panel fits short result lists and keeps search focused. ([#112](https://github.com/man15h/holm/pull/112))

## 0.10.1 — 2026-10-22

- **Fixed:** Runs on Node 22.23.4, which patches October's Node security issues. ([#109](https://github.com/man15h/holm/pull/109))

## 0.10.0 — 2026-10-20

- **New:** Search → Transparency: Match theme or Solid, with `search.transparency`. ([#103](https://github.com/man15h/holm/pull/103))
- **New:** Search → Hints: Rotating or Still, with `search.hints`. ([#103](https://github.com/man15h/holm/pull/103))
- **New:** Wallpapers from your own folder or a URL, with an optional resizer. ([#104](https://github.com/man15h/holm/pull/104))
- **New:** Wallpapers load at full resolution on screens wider than 1920px. ([#104](https://github.com/man15h/holm/pull/104))
- **Improved:** The resting search bar follows Glass; on Light it's frosted unless Solid. ([#103](https://github.com/man15h/holm/pull/103))
- **Improved:** Wallpapers load only for signed-in people, except today's on the sign-in page. ([#104](https://github.com/man15h/holm/pull/104))
- **Fixed:** Wallpaper thumbnails still load when the image resizer is down. ([#104](https://github.com/man15h/holm/pull/104))

## 0.9.0 — 2026-10-17

- **New:** Choose whether search slides to the top or stays put when focused. ([#98](https://github.com/man15h/holm/pull/98))
- **Improved:** Docs and screenshots match the current build. ([#99](https://github.com/man15h/holm/pull/99))

## 0.8.1 — 2026-10-17

- **Improved:** What's new links each change to its pull request, opening in a new tab. ([#96](https://github.com/man15h/holm/pull/96))
- **Fixed:** The Papra credit now names @pihomeserver. ([#96](https://github.com/man15h/holm/pull/96))

## 0.8.0 — 2026-10-17

- **New:** Papra document search, contributed by [@pihomeserver](https://github.com/pihomeserver). ([#92](https://github.com/man15h/holm/pull/92))
- **New:** `config.minimal.yml`, a quick-start config with no sign-in. ([#86](https://github.com/man15h/holm/pull/86))
- **Improved:** Search results and details animate in instead of snapping. ([#89](https://github.com/man15h/holm/pull/89))
- **Improved:** Search shows one loading line, documents first and a Top hit. ([#90](https://github.com/man15h/holm/pull/90))
- **Improved:** Sums and conversions no longer search your apps. ([#90](https://github.com/man15h/holm/pull/90))
- **Improved:** The Play button uses your accent colour. ([#89](https://github.com/man15h/holm/pull/89))
- **Fixed:** Apps set to `default_visible` now appear on a new person's page. ([#87](https://github.com/man15h/holm/pull/87))

## 0.7.0 — 2026-10-15

- **New:** Glass for the page: Clear, Frosted or Solid, in Configure → Appearance. ([#80](https://github.com/man15h/holm/pull/80))
- **New:** 12- or 24-hour clock and °C or °F, from their menus. ([#79](https://github.com/man15h/holm/pull/79))
- **New:** Apps can open a browser or mobile-app setup guide on click. ([#79](https://github.com/man15h/holm/pull/79))
- **New:** Change your password during onboarding, with a `password` slide. ([#82](https://github.com/man15h/holm/pull/82))
- **Fixed:** a shared browser no longer carries someone else's settings into your account. ([#82](https://github.com/man15h/holm/pull/82))

## 0.6.2 — 2026-10-13

- **Fixed:** upgrading from 0.5.0 shows every release since, not just the latest. ([#73](https://github.com/man15h/holm/pull/73))

## 0.6.1 — 2026-10-13

- **Fixed:** wallpaper missing after a reload. ([#71](https://github.com/man15h/holm/pull/71))

## 0.6.0 — 2026-10-13

- **Improved:** Phone: search sits above the apps and stays on top while typing. ([#65](https://github.com/man15h/holm/pull/65))
- **Improved:** Phone: the clock, weather and next event fit on the page. ([#65](https://github.com/man15h/holm/pull/65))
- **Improved:** Phone: reminders and the install prompt slide in under the account menu. ([#65](https://github.com/man15h/holm/pull/65))
- **New:** Your CalDAV calendar on the page: iCloud, Fastmail, Nextcloud, Stalwart and others. ([#59](https://github.com/man15h/holm/pull/59))
- **New:** Up to six calendar accounts in one card, each with its own color. ([#59](https://github.com/man15h/holm/pull/59))
- **New:** The next event sits under the clock, the week ahead a click away. ([#59](https://github.com/man15h/holm/pull/59))
- **New:** Event reminders in the corner, with Join call, Snooze and Dismiss. ([#59](https://github.com/man15h/holm/pull/59), [#66](https://github.com/man15h/holm/pull/66))
- **New:** `!cal` finds events by title and opens them, or shows their details. ([#59](https://github.com/man15h/holm/pull/59))
- **New:** Search Linkwarden links, Miniflux articles, and Komga and Kavita series. ([#55](https://github.com/man15h/holm/pull/55), [#56](https://github.com/man15h/holm/pull/56))
- **New:** After a reload, your song comes back, paused at the same spot. ([#60](https://github.com/man15h/holm/pull/60))
- **New:** Search answers sums, conversions and city times, like `3pm london in tokyo`. ([#57](https://github.com/man15h/holm/pull/57))
- **New:** Onboarding, privacy notice and What's new can each be limited to `groups:`. ([#68](https://github.com/man15h/holm/pull/68))
- **New:** Configure says when a newer Holm is out, checked every 6 hours. ([#69](https://github.com/man15h/holm/pull/69))
- **New:** `update_check` turns the update notice off or limits it to groups. ([#69](https://github.com/man15h/holm/pull/69))
- **New:** `security.frame_ancestors` lets other pages embed Holm. ([#63](https://github.com/man15h/holm/pull/63))
- **New:** This What's new dialog after an update; Configure's version links to GitHub. ([#62](https://github.com/man15h/holm/pull/62))

## 0.5.0 — 2026-10-09

- **New:** Navidrome songs from search play in a small corner player. ([#46](https://github.com/man15h/holm/pull/46))
- **New:** The music player is a widget you can turn off. ([#46](https://github.com/man15h/holm/pull/46))
- **New:** Apps in `config.yml` can list the groups that see their tile. ([#47](https://github.com/man15h/holm/pull/47))
- **Improved:** Holm refuses to start, rather than run open, without its config or key. ([#48](https://github.com/man15h/holm/pull/48))
- **Improved:** Sessions are signed with Holm's own key and expire after 30 days. ([#48](https://github.com/man15h/holm/pull/48))
- **Improved:** Integration URLs are checked on the server. ([#48](https://github.com/man15h/holm/pull/48))
- **Improved:** The image runs as the `node` user. ([#48](https://github.com/man15h/holm/pull/48))
- **Improved:** The media proxy serves only images and audio; other files download. ([#48](https://github.com/man15h/holm/pull/48))
- **Improved:** Every page sends security headers. ([#48](https://github.com/man15h/holm/pull/48))
- **Improved:** The privacy notice, security policy and config reference match the code. ([#48](https://github.com/man15h/holm/pull/48))
