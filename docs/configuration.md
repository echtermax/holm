# Configuration

Everything is in a single `config.yml`, found at `CONFIG_PATH` (default `config.yml` in the working directory; `/app/config.yml` in the image). [`config.minimal.yml`](../config.minimal.yml) is the smallest working config, [`config.example.yml`](../config.example.yml) is an annotated example of everything, [`config.demo.yml`](../config.demo.yml) runs the demo with no sign-in, and the [reference table](#reference) below lists every key.

**Reloading.** Holm watches the file and rereads it on the next request after a save: apps, branding, search, integrations, onboarding and the rest take effect without a restart. These are read once and need a restart: `auth.oidc` (the provider is discovered once), `database`, and the encryption key. A save that breaks the file (bad YAML, an unset `${VAR}`, an unknown `search.on_focus`, `search.transparency` or `search.hints`, a bad `wallpapers` value) makes every request fail with the reason in the log until it's fixed.

**Failing closed.** Holm refuses to start, and logs why, when the config is missing or unreadable, isn't valid YAML, names an unset or empty `${VAR}`, when `HOLM_SECRET_KEY` is malformed, or when the data directory isn't writable. That directory holds the database and, without `HOLM_SECRET_KEY`, the key file, so it must be writable even with `database.enabled: false` unless you set `HOLM_SECRET_KEY`. It never falls back to defaults with sign-in off.

## Environment variables

| Variable | Purpose |
|---|---|
| `CONFIG_PATH` | Path to `config.yml`. |
| `DATABASE_PATH` | SQLite file. Overrides `database.path`. Default `./data/holm.db`. |
| `HOLM_SECRET_KEY` | 32 bytes, hex or base64 (`openssl rand -hex 32`). Encrypts integration credentials and signs sessions. Without it, Holm generates `.integrations-key` next to the database. Set but malformed = Holm won't start. |
| `PORT` | Listening port (`3000` in the image). |
| anything in `${…}` | Substituted into `config.yml` at load. Unset or empty = Holm won't start. |

## Branding

```yaml
branding:
  name: "My Homelab"
  short_name: "homelab"
  description: "Personal dashboard"
  logo: "/icons/logo.svg"
  favicon: "/icons/favicon.svg"
  font:
    family: "JetBrains Mono"
    url: null   # JetBrains Mono is bundled; set a stylesheet URL only for another font
  theme_color: "#09090b"
```

## Authentication

```yaml
auth:
  enabled: true
  oidc:
    issuer: "https://auth.example.com"
    client_id: "${OIDC_CLIENT_ID}"
    client_secret: "${OIDC_CLIENT_SECRET}"
    scopes: "openid profile groups"
    redirect_base: "https://dash.example.com"
  password_change_url: null
  registration:
    enabled: false
    url: null
```

Secrets use `${ENV_VAR}` syntax, substituted at load, so they stay out of the file. Session cookies are HMAC-signed with a key derived from Holm's master key (`HOLM_SECRET_KEY` or the key file) and expire after 30 days; groups are read at sign-in. The cookies are `Secure`, so sign-in needs Holm served over HTTPS (or `localhost`).

Any OIDC provider works. Two details trip people up:

- **The issuer must match the provider's exactly.** Copy it from the provider's `/.well-known/openid-configuration`. Holm retries once with or without a trailing slash. If discovery still fails, clicking Sign in shows a "Sign-in is unavailable" page and the server log has the reason.
- **Log out ends the provider session only if the provider supports it.** When the discovery document lists an `end_session_endpoint`, Log out sends the user there, so the next login asks for a password. Without one (Authelia, for example), Log out only clears Holm's session, and the next login goes straight back in while the provider session lasts.

### Authentik

1. **Applications → Applications → Create with provider**, provider type **OAuth2/OpenID**.
2. Client type **Confidential**. Copy the client ID and secret into `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`. If the provider lists grant types (Authentik 2026.x), make sure **Authorization Code** is enabled. A provider without it rejects the login with "The request is otherwise malformed".
3. Redirect URI (strict): `https://dash.example.com/auth/callback`, the same host as `redirect_base`.
   On Authentik 2026.5 or later, also add `https://dash.example.com/` as a redirect URI of type **Logout**, so Log out returns to Holm. Without it, users end up on Authentik's login page. Earlier versions always do that.
4. **Invalidation flow: `default-invalidation-flow`.** The default `default-provider-invalidation-flow` logs the user out of Holm only and offers an Authentik logout as an extra button. On a shared device you want the full logout.
5. Leave the default scopes (`openid`, `email`, `profile`). Authentik sends `groups` as part of `profile`, so app `groups:` work without a `groups` scope.

```yaml
auth:
  enabled: true
  oidc:
    issuer: "https://authentik.example.com/application/o/holm/"   # the application slug, trailing slash included
    client_id: "${OIDC_CLIENT_ID}"
    client_secret: "${OIDC_CLIENT_SECRET}"
    scopes: "openid profile email"
    redirect_base: "https://dash.example.com"
```

## Database

```yaml
database:
  enabled: true          # false = localStorage-only, no SQLite
  # path: "./data/holm.db"   # can also set via DATABASE_PATH env var
```

SQLite is built in (one file in the data volume), so there's no separate database to run. When enabled, user preferences persist there and sync across devices.

When disabled, Holm runs browser-only: preferences live in each browser's localStorage and integrations are switched off, since they have nowhere to keep credentials.

## Apps

```yaml
apps:
  - id: photos                             # stable — user prefs key off it
    name: "Photos"
    url: "https://photos.example.com"
    icon: "di:immich"                      # colored icon (required)
    icon_mono: "si:immich"                 # mono icon for white/grayed styles (optional)
    tile_color: "#4250AF"                  # brand tile background (optional)
    self_hosted: true                      # listed in onboarding's services slide
    default_visible: true                  # placed on a new user's surface
    on_click: getting_started              # optional: open (default) | getting_started | menu
    app_store:
      ios: "https://apps.apple.com/..."
      android: "https://play.google.com/..."
    setup_guide:
      subtitle: "Auto backup your photos"
      steps:
        - label: "Download"
          desc: "Get the app from your store."
```

A setup guide opens as a **Getting started** card from the tile's right-click or long-press menu. It asks how the user wants to use the app: **In the browser** opens it, **In the mobile app** shows the server URL, store links and the steps. The line under the app name is the app's `onboarding.services[].desc`, or `setup_guide.subtitle` when there is none.

`on_click` sets what a plain click (or tap) on the tile does:

- `open`, or unset: opens the app.
- `getting_started`: opens the Getting started card instead, until the user ticks **Don't show again**; a tip says the right-click / long-press menu brings it back. Needs a `setup_guide` or `app_store` links; with neither, the click opens the app.
- `menu`: opens the tile's right-click / long-press menu.

Ctrl/⌘-click always opens the app in a new tab. Any other value opens the app, and Holm logs a warning at startup.

### Who sees an app

Give an app `groups:` to show it only to users in at least one of those OIDC groups. An app without `groups` is shown to everyone.

```yaml
  - id: sonarr
    name: "Sonarr"
    url: "https://sonarr.example.com"
    icon: "di:sonarr"
    groups: ["arr"]
```

The server drops apps a user can't see before the page reaches the browser, so their tiles and URLs never reach it. This covers the app grid only. Integrations aren't covered by `groups:`: every enabled integration is still listed to every signed-in user, with its URL, and anyone can connect it. With auth disabled everyone is a guest with no groups, so every app with `groups:` disappears. Groups come from the provider's `groups` claim (add the `groups` scope; Authentik includes it in `profile`) and are read at login, so a group change applies the next time the user signs in.

`admin_only: true` and the `admin_groups` / `admin_usernames` settings are gone. An app that still has `admin_only: true` and no `groups` is hidden from everyone, with a warning in the log; replace it with something like `groups: ["admins"]`.

Apps are a flat list. The older `category:` / `items:` shape still loads, flattened, with a deprecation warning in the log at startup.

### App health

A tile can show whether its app is working. Up shows nothing. Down is a red dot, and the tile fades but still opens. Slow, or under maintenance, is amber. A check that didn't work is a grey ring. Hovering says what's wrong and, when the source says, why; on a phone, long-press puts the same at the top of the tile's menu. With `page` set the tip ends its top line with **Check →**, and clicking the tip (or **Status page** in the menu) opens that app's page there: `<page>/monitors/<tag>` for Kener, `<page>/endpoints/<key>` for Gatus, the page itself for Uptime Kuma and Cachet. Screen readers hear it in the tile's name ("Cloud, down").

Pick where the answers come from once, at the top level:

```yaml
health:
  source: kener                       # kener | uptime_kuma | gatus | cachet | http
  url: "https://status.example.com"
  api_key: "${KENER_API_KEY}"
  every: 60s                          # 30s or more; default 60s
  page: "https://status.example.com"  # optional: the status page people can open
```

Then opt each app in. An app without `health:`, or with `health: false`, gets no dot.

```yaml
apps:
  - id: photos
    health: true                      # the monitor for this app, found as below
  - id: cloud
    health: nextcloud                 # this monitor, by its tag (Kener) or name
  - id: music
    health:
      url: "http://navidrome:4533/ping"  # Holm checks this itself
      every: 5m
      enabled: true                   # false turns it off and keeps the rest
```

- **`true` finds the monitor** whose checked URL is on the app's host, then one whose name or tag is the app's name or id (ignoring case and punctuation). An app whose monitor isn't found is named in the log at startup and gets no dot.
- **The mapping** takes `monitor` or `url`, not both: Holm refuses to start and names the app. With neither, it matches as `true` does.
- **`url`** is checked by Holm's server: 2xx, redirects, 401, 403 and 429 are up; any other answer is down, with its status as the reason (`answered 404 Not Found`); no answer in 10s is down; over 3s is slow. Use it for apps your status page doesn't watch, or to see why one is down: Kener's API says a monitor is down but not why.
- **Without a `health:` block**, `health: true` checks the app's own URL as `url` would.

Holm's server does every check and keeps the answer, so one check per `every` serves everyone, however many are looking. People only get health for apps they can see (`groups:`), from `/api/health`, which needs a session. The URL and key stay on the server.

**Kener** (v4): create a key under Manage → API Keys. Kener's keys can't be limited to reading, so this key can also change monitors; keep it in an environment variable, never in `config.yml`. Holm reads the monitor list (each monitor's URL comes with it, which is how `true` matches) every 10 minutes, and each matched monitor's latest result once per `every`. Results older than 30 minutes count as a failed check. A Kener **maintenance** happening now, or an **incident** not yet resolved, outranks the last result: the tile shows its impact (maintenance amber, degraded amber, or down) with its title and a maintenance's end time. Both are read once per `every`; a maintenance wins over an incident.

**Uptime Kuma**: create a key under Settings → API Keys; Holm reads `/metrics` with it once per `every` for all apps. Pending (a failed check being retried) shows amber.

**Gatus**: Holm reads `/api/v1/endpoints/statuses` once per `every` for all apps. Gatus doesn't say which URL an endpoint checks, so `true` matches by name or key (`media_jellyfin` for Jellyfin in group media). A failed status condition reads `answered 502 Bad Gateway`; when only a `[RESPONSE_TIME]` condition fails, the tile is slow. `api_key` is only needed when Gatus asks for a login: `user:password` for its basic auth.

**Cachet** (v3): Holm reads `/api/components` once per `every`. Each component's link is its URL, which is how `true` matches. Operational is up; performance issues and partial outage are slow; major outage is down; under maintenance is maintenance; unknown is a failed check. `api_key` is only needed when the API is protected (Settings → API protected): a token from Manage → API Keys.

Each person can turn the dots off in Configure → Widgets → **App status**; that card only appears when one of their apps has a check.

## Icons

Holm fetches `di:` / `si:` icons from their CDNs and serves them itself, so visitors' browsers never reach the CDNs; a full URL loads from wherever it points. Users choose Colored, White, or Grayed in the Configure panel.

**Colored mode** displays full-color dashboard icons by default. Apps with an explicit `tile_color` field get iOS-style brand tiles (mono glyph on colored background).

**White/Grayed modes** use the mono icon source with CSS filters. Without `icon_mono`, Holm tries the Simple Icons icon of the same name, and grayscales the colored icon only if there is none.

| Field | Purpose | Example |
|-------|---------|---------|
| `icon` | Full-color icon (required) | `"di:immich"`, `"https://example.com/icon.svg"` |
| `icon_mono` | Mono icon for white/grayed styles (optional) | `"si:immich"`, `"di:immich-light"` |
| `tile_color` | Brand tile background hex (optional) | `"#FF0000"` |

**Prefixes:**

| Prefix | Source | Example |
|--------|--------|---------|
| `di:` | [Dashboard Icons](https://github.com/homarr-labs/dashboard-icons) | `di:nextcloud` |
| `si:` | [Simple Icons](https://simpleicons.org) | `si:youtube` |

Direct URLs also work: `"https://cdn.example.com/icon.svg"`.

## Onboarding

Onboarding shows only with `auth.enabled: true`. Without `slides`, it plays `welcome` then `services`.

Onboarding uses a composable `slides` array. Each slide has a `type` — built-in types (`welcome`, `services`) have special behavior, while `privacy`, `security`, `password`, and `list` all render through a generic list engine with per-type defaults.

```yaml
onboarding:
  enabled: true
  welcome_text: "Your data stays on your hardware."
  slides:
    - type: welcome                        # greeting with brand logo
    - type: services                       # auto-derived from self-hosted apps
    - type: privacy                        # defaults: shield icon, privacy claims
      items:                               # override default items
        - text: "Your data lives on **our hardware**"
        - text: "**No tracking**, no ads — ever"
    - type: security                       # defaults: lock icon, security tips
    - type: password                       # defaults: key icon, "Change password", tips
    - type: list                           # fully custom slide (no defaults)
      icon: info                           # any Lucide icon name or direct URL
      title: "House Rules"
      subtitle: "A few things to know"
      list_icon: arrow-right               # default icon for all items (default: check)
      items:
        - text: "Be **respectful** to everyone"        # {text} format — supports **bold**
        - title: "Report issues"                       # {title, desc} format
          desc: "Contact the admin if something breaks"
          icon: alert-circle                           # per-item icon override
      footer: "Thanks for being here"
```

All list-based types (`privacy`, `security`, `password`, `list`) support: `icon`, `title`, `subtitle`, `items`, `footer`, `list_icon`. Items auto-detect format: `{text}` renders with bold markdown, `{title, desc}` renders as **title** — desc. Both formats can coexist in one slide.

**Password slide:** `password` asks a new user to replace the password they were given. It shows only when auth is on, `auth.password_change_url` is set and the user has not confirmed yet; it is never added on its own, so list it to use it. Under the list it adds a "Change password" button that opens `password_change_url` in a new tab, and "Done, continue" unlocks once that tab has been opened. Listing it also turns on a standalone version for users who are already onboarded.

**Icons:** Use any [Lucide](https://lucide.dev/icons) icon by name (e.g., `shield-check`, `lock`, `info`). Direct URLs also work. Browse 1400+ icons at [lucide.dev/icons](https://lucide.dev/icons).

Add `groups:` to show onboarding only to some users; see [Groups for onboarding, privacy and What's new](#groups-for-onboarding-privacy-and-whats-new).

## Optional Features

```yaml
search:
  enabled: true
  url: "https://www.google.com/search"
  param: "q"
  name: "Google"
  icon: "di:google"

integrations:
  immich:
    enabled: true
    name: "Photos"
    default_url: "https://immich.example.com"
    surfaces:
      search: true
      widgets: false
  karakeep:
    enabled: true
    name: "Bookmarks"
    default_url: "https://karakeep.example.com"
    surfaces:
      search: true
      widgets: false

wallpapers:
  enabled: true

weather:
  enabled: true                # users set their location from the weather pill
                               # and their units under Configure → Widgets

privacy:
  enabled: true
  last_updated: "April 2026"
  file: "privacy.md"
  groups: ["family"]           # optional: only these groups see it
```

Set `default_url` for every integration you enable: it pins the server URL for every user. Without it, users can point the integration at any http(s) host Holm can reach, and Holm logs a warning at startup.

### What's new

After an update, each user gets a **What's new in vX.Y.Z** dialog the first time they open Holm, with that release's notes from `CHANGELOG.md` (bundled at build time; Holm never asks GitHub). Once closed, it stays closed until the next version. Someone who skipped versions sees every release since the one they last closed it on, and someone signed in who used Holm before 0.6.0 (which added the dialog) sees every release since 0.5.0; a brand-new user doesn't get it at all. Signed-in users' last version is kept on the server, so it follows them across devices. With auth off, everyone is the shared guest, so each browser keeps its own in `localStorage` instead (and so does every user when the database is off).

`changelog: { enabled: false }` turns the dialog off for everyone, and `changelog: { groups: ["admins"] }` shows it only to those groups. The version still shows at the bottom of Configure as "Holm vX.Y.Z", whatever `branding.name` is, and links to Holm on GitHub. Configure, and with it the version and the update notice, needs `customization.enabled: true`.

### Groups for onboarding, privacy and What's new

`onboarding`, `privacy` and `changelog` each take `groups:`, matched the same way as `groups:` on [apps](#apps):

```yaml
changelog:  { enabled: true, groups: ["admins"] }
onboarding: { enabled: true, groups: ["family"], slides: [...] }
privacy:    { enabled: true, groups: ["family"], file: "privacy.md" }
```

- `enabled: false` hides it from everyone.
- `enabled` without `groups` shows it to everyone.
- `enabled` with `groups` shows it only to users in at least one of them.

The server decides. Someone outside the groups gets no slides, no privacy text and no release notes in the page or from `/api/changelog`. With auth off, everyone is a guest with no groups, so a section with `groups:` is hidden from everyone.

The sign-in screen asks visitors to agree to the Privacy & Terms only when they can open the privacy notice. Nobody is signed in there yet, so with `groups:` on `privacy` (or `privacy` off) that box doesn't show. Members open the notice from the footer once signed in.

### Update notice

At most every 6 hours, Holm's server asks GitHub for Holm's latest release (`api.github.com/repos/…/holm/releases/latest`); visitors' browsers never do. When it's newer than the running version, Configure shows `v0.7.0 available` under the version, linking to that release's notes. If GitHub can't be reached or answers with an error, there's no notice, just one line in the log, and Holm asks again 6 hours later. A page load never waits for the check.

```yaml
update_check:
  enabled: true                # default; false = never ask GitHub
  groups: ["admins"]           # optional: only these groups see the notice
```

`groups` works as in [Groups for onboarding, privacy and What's new](#groups-for-onboarding-privacy-and-whats-new). GitHub is asked only once someone who can see the notice opens Holm, so with auth off and `groups` set it never is.

`tips` is accepted but has no effect: the first-week tips are switched off in this release.

### Wallpapers

`wallpapers: { enabled: true }` alone shows DistroTube's set of 326 wallpapers from GitLab, resized through the public [wsrv.nl](https://wsrv.nl) proxy. To show your own images, or to keep Holm from calling outside services, set **either** `path` **or** `url`:

```yaml
wallpapers:
  enabled: true

  # A) A folder mounted into the container. Every .jpg, .jpeg, .png, .webp
  #    and .avif in it, sorted by name (img2 before img10). Holm counts them.
  path: /wallpapers

  # B) Or a URL pattern, numbered from start to start + count - 1.
  # url: "https://images.example.com/walls/{id}.jpg"
  # count: 120
  # pad: 4                     # {id} zero-padded to 4 digits: 0001
  # start: 1

  # Resizer. Built-in set: wsrv.nl, as today. Your own path or url:
  # originals, unless you set resize.
  # resize: wsrv           # the public wsrv.nl (url only; it can't reach a folder)
  # resize: none           # originals
  # resize: "http://imgproxy:8080/insecure/rs:fit:{width}/plain/local:///{file}@webp"
```

Users still pick wallpapers by number in Configure → Appearance, and the daily rotation runs through the whole set. Extensions match in any case (`.JPG` too). A photo added to the folder shows up on the next page load, with no restart. Folder images are served by their number in the sorted list, never by a filename from the request. Hidden files, subfolders and symlinks are skipped. Adding or removing files renumbers the ones after them. Wallpaper URLs carry a version that changes whenever the folder's files or any `wallpapers` setting do, so browsers fetch fresh images instead of ones cached under the same number. To replace an image, give the new one a new name: overwriting a file under the same name keeps the old one in browsers for up to a week. If someone's pick runs past the end of a smaller set, they get the wallpaper of the day.

Holm serves only JPEG, PNG, WebP and AVIF, up to 25 MB each, with `X-Content-Type-Options: nosniff`. It checks the type the server sends for `url` images and the extension for folder images. Anything else, including SVG, gets a 404.

**Who can see them.** Numbered wallpapers, thumbnails and originals need a signed-in session (with sign-in off, everyone is the guest and can), and they're sent `Cache-Control: private` so shared caches don't keep them. Only `/api/wallpaper/today`, at 1920px, is public, because the sign-in page and other apps' login screens show it. With `path`, that means one folder image a day is visible before sign-in.

**Resizing.** Full wallpapers are asked for at 1920px wide and picker thumbnails at 200px. Holm shows the 1920px image first. On a screen wider than that (screen width × pixel ratio), it then loads the original in the background and fades to it, so the resizer mainly serves thumbnails and the first paint. With `resize: none` the first image already is the original. `resize` is a URL template for any weserv- or imgproxy-style service: `{width}` is the width, `{url}` is the original image's URL (with `url`), and `{file}` is the folder image's file name (with `path`, for a resizer that mounts the same folder). `resize: wsrv` is shorthand for the public [wsrv.nl](https://wsrv.nl), with no sidecar to run; it works with `url` only, since wsrv.nl can't reach a folder on your server. If the resizer is down, errors, or answers with something that isn't an image, Holm serves the original. Without `resize`, the built-in set keeps using wsrv.nl, and `path` and `url` serve originals.

**A folder of photos needs a resizer.** Without one, the picker loads every full-size original as a thumbnail: 200 phone photos at ~5 MB each is about 1 GB per pass through the picker.

A self-hosted [imgproxy](https://imgproxy.net) sidecar handles both sources. Mount the same folder read-only into both containers. The `/insecure/` URLs below are unsigned, so imgproxy will resize anything for anyone who can reach it. Keep it on the Docker network Holm shares with it: give it no `ports:` and no reverse-proxy route.

```yaml
services:
  holm:
    # ...
    volumes:
      - ./wallpapers:/wallpapers:ro
  imgproxy:
    image: ghcr.io/imgproxy/imgproxy:latest
    restart: unless-stopped
    environment:
      IMGPROXY_LOCAL_FILESYSTEM_ROOT: /wallpapers
      IMGPROXY_ENFORCE_WEBP: "true"
    volumes:
      - ./wallpapers:/wallpapers:ro
    # No ports: Holm reaches it as http://imgproxy:8080 on the shared network.
```

```yaml
wallpapers:
  enabled: true
  path: /wallpapers
  resize: "http://imgproxy:8080/insecure/rs:fit:{width}/plain/local:///{file}@webp"
  # With url instead of path:
  # resize: "http://imgproxy:8080/insecure/rs:fit:{width}/plain/{url}@webp"
```

To resize a `url` set with a weserv sidecar instead, add `image: ghcr.io/weserv/images:5.x` as `weserv` (it listens on port 80) and set `resize: "http://weserv/?url={url}&w={width}&we&output=webp&q=80"`. weserv only fetches URLs, so it can't resize a folder. Keep the sidecar off your public network, since it fetches whatever URL it's given.

Holm checks `wallpapers` when it loads the config, like `search.on_focus`. Any of these makes every request fail, with the reason in the log, until it's fixed: both `path` and `url`; a relative `path`, or one that isn't a readable folder; a `url` without `{id}`, not http(s), or not ending in an image extension; `count` missing or not a whole number from 1 to 100000 with `url`; `count` with `path`; `pad` or `start` without `url`; `pad` outside 0–8; a negative `start`; a `resize` that isn't `none`, `wsrv` or an http(s) URL with `{width}` and `{url}` (or `{file}` with `path`); and `resize: wsrv` with `path`.

## Integration credentials

Users connect integrations with their own credentials, encrypted at rest with AES-256-GCM. Set `HOLM_SECRET_KEY` (32 bytes, hex or base64: `openssl rand -hex 32`) in production. Without it, Holm generates `.integrations-key` in the same directory as the database, so anyone with a copy of the data directory also has the key. The same key signs sessions, so changing it signs everyone out.

For the list of supported apps, how users connect and how to add a new integration, see [integrations.md](integrations.md).

## Embedding Holm in another page

By default no other site can show Holm in a frame: every page answers `X-Frame-Options: DENY` and `frame-ancestors 'none'`. To embed it in a dashboard such as Dynacat or Homepage, list the pages' origins:

```yaml
security:
  frame_ancestors:
    - "https://dash.example.com"
```

Holm then answers `frame-ancestors 'self' https://dash.example.com` and drops `X-Frame-Options`. Each entry is a scheme and host with an optional port (`https://*.example.com` covers its subdomains). Anything else, such as a path or a bare `*`, is ignored with a warning at startup.

Sign-in cookies are `SameSite=Lax`, so the browser only sends them into a frame whose parent page is on the same site. `dash.example.com` framing `home.example.com` works once you've signed in to Holm in a normal tab. Other sites, and a parent on a bare IP, get a signed-out page. Sign-in itself can't happen inside the frame, because identity providers refuse to be framed.

## Reference

Every key Holm reads. "Reload" means a save takes effect without a restart.

| Key | Type | Default | Reload | Notes |
|---|---|---|---|---|
| `branding.name` / `short_name` / `description` | string | `Holm` / `holm` / `Self-hosted dashboard` | yes | Header, footer, PWA manifest, meta description |
| `branding.logo` / `favicon` | path or URL | built-in | yes | Favicon falls back to the logo |
| `branding.font.family` / `font.url` | string / URL | `JetBrains Mono` / none | yes | The default font is bundled; a URL is only for another font |
| `branding.theme_color` | hex | `#09090b` | yes | PWA theme color |
| `branding.accent_color` | hex | `#f5b942` | yes | Focus rings, selected states, hover halos |
| `branding.background.dark` / `background.light` | `#rrggbb` | `#09090b` / `#ffffff` | yes | Page colour on the Dark and Light themes; Dynamic without a wallpaper uses `dark`. Rejected unless the theme's dim text reaches 4.5:1 on it |
| `branding.show_footer` | bool | `true` | yes | Footer with the brand name and register / privacy links |
| `auth.enabled` | bool | `false` | yes | `false` = every visitor is the same Guest with no groups |
| `auth.oidc.issuer` / `client_id` / `client_secret` / `scopes` / `redirect_base` | string | none (`scopes`: `openid profile`) | restart | Endpoints are discovered from the issuer |
| `auth.password_change_url` | URL | none | yes | Adds "Change password" to the user menu; also the target of the `password` onboarding slide |
| `auth.registration.enabled` / `url` | bool / URL | `false` | yes | A "Register" link on the sign-in screen, when both are set |
| `database.enabled` | bool | `true` | restart | `false` = preferences in each browser only, integrations off |
| `database.path` | path | `./data/holm.db` | restart | `DATABASE_PATH` wins |
| `customization.enabled` | bool | `false` | yes | Without it there is no Configure panel and the grid is fixed |
| `apps[]` | list | `[]` | yes | Fields under [Apps](#apps): `id`, `name`, `url`, `icon`, `icon_mono`, `tile_color`, `self_hosted`, `default_visible`, `on_click`, `groups`, `tags` (shown on search results), `app_store`, `browser_extension`, `setup_guide`, `health` ([App health](#app-health)) |
| `health.source` / `url` / `api_key` / `every` / `page` | | none; `every` `60s` | yes | Where tile health comes from: `kener`, `uptime_kuma`, `gatus`, `cachet` or `http`. Any bad value, or an app with both `monitor` and `url`, is rejected like bad YAML. See [App health](#app-health) |
| `search.enabled` / `url` / `param` / `name` / `icon` | | on, Google, `q` when the block is missing | yes | The fallback web search. A `search:` block needs `enabled: true` |
| `search.on_focus` | `top` \| `in_place` | `top` | yes | Where the bar goes when it opens on desktop: slides up toward the top, or stays put. The default for everyone; each person can override it in Configure → Widgets → Search. Phones always pin it above the keyboard. Any other value is rejected like bad YAML, with the reason in the log |
| `search.transparency` | `theme` \| `solid` | `theme` | yes | How see-through the bar and its results are. `theme` follows Configure → Appearance → Glass on every theme; `solid` keeps the bar solid whatever Glass says. The default for everyone; each person can override it in Configure → Widgets → Search. Any other value is rejected like bad YAML |
| `search.hints` | `rotating` \| `still` | `rotating` | yes | The hints in the empty bar: typed out in turn, or the first one kept still. The default for everyone; each person can override it in Configure → Widgets → Search → Hints. Any other value is rejected like bad YAML |
| `integrations.<id>.enabled` | bool | on when the block exists | yes | `false` hides it; so does leaving the block out |
| `integrations.<id>.name` / `shortcut` / `tip` | string | adapter's | yes | Display name, `!scope`, a hint on the connect card |
| `integrations.<id>.default_url` | URL | none | yes | Pins the server URL for every user. Set it for every integration |
| `integrations.<id>.surfaces.search` / `widgets` | bool | `true` / `false` | yes | Widgets so far: Navidrome's player, the Calendar's reminders and upcoming events |
| `integrations.planka.cache_ttl` | seconds | `300` | yes | How long Planka cards are cached per user |
| `wallpapers.enabled` | bool | `false` | yes | Wallpaper picker and daily rotation |
| `wallpapers.path` | absolute path | none | yes | A mounted folder of jpg/png/webp/avif images, sorted by name. Not with `url`. See [Wallpapers](#wallpapers) |
| `wallpapers.url` | URL with `{id}` | none | yes | An http(s) image URL pattern; needs `count`. Not with `path` |
| `wallpapers.count` / `pad` / `start` | whole numbers | none / `0` / `1` | yes | With `url`: how many images, `{id}`'s zero-padding (0–8), and the first `{id}` |
| `wallpapers.resize` | URL template \| `wsrv` \| `none` | `wsrv` for the built-in set, else `none` | yes | A resizer with `{width}` and `{url}` (or `{file}` with `path`); `wsrv` is the public wsrv.nl, `url` only. Holm serves the original when it fails |
| `weather.enabled` | bool | `false` | yes | Users set their own location |
| `onboarding.enabled` / `welcome_text` / `services` / `slides` | | off | yes | Needs `auth.enabled: true`. See [Onboarding](#onboarding) |
| `onboarding.groups` / `privacy.groups` / `changelog.groups` | list | everyone | yes | Only these OIDC groups see it. See [Groups](#groups-for-onboarding-privacy-and-whats-new) |
| `privacy.enabled` / `last_updated` / `file` / `sections` | | off | yes | `file` is relative to `config.yml` |
| `security.frame_ancestors` | list of origins | none | yes | Pages allowed to show Holm in a frame. See [Embedding](#embedding-holm-in-another-page) |
| `tips.*` | | | | Accepted, no effect in this release |
| `changelog.enabled` | bool | `true` | yes | The "What's new" dialog after an update |
| `update_check.enabled` / `groups` | bool / list | `true` / everyone | yes | Asks GitHub every 6 hours for a newer release and shows it in Configure. See [Update notice](#update-notice) |
