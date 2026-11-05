# Integrations

Holm has two kinds of app support.

- **Tiles** work with any app that has a URL. List it under `apps:` in `config.yml` and Holm looks up its icon by name from [Dashboard Icons](https://github.com/homarr-labs/dashboard-icons) or [Simple Icons](https://simpleicons.org). No fixed list applies. See [configuration.md](configuration.md#apps).
- **Integrations** let users search *inside* an app from Holm's search bar, with each user's own credentials.

## Supported integrations

| App | What you can search | How users connect | Default scope |
|---|---|---|---|
| Immich | Photos (smart search) | URL + API key | `!photos` |
| Paperless-ngx | Documents (full text) | URL + API token | `!d` |
| Nextcloud | Files | URL + username + app password | `!f` |
| Jellyfin | Movies, shows and music | Quick Connect sign-in, no key to copy | `!jf` |
| Planka | Cards, by name (cached up to 5 minutes, `cache_ttl`) | URL + API key | `!p` |
| Karakeep | Bookmarks (full text); under `!b`, tags and lists to search inside | URL + API key | `!b` |
| Linkwarden | Links by name, URL, description and tags (full text with Meilisearch) | URL + access token | `!lw` |
| Plex | Movies, shows and music | Code at plex.tv/link, no key to copy | `!plex` |
| Navidrome | Artists, albums, playlists and songs; optional player for songs, albums and playlists | URL + username + password (only a derived token is kept) | `!nd` |
| Audiobookshelf | Audiobooks and podcasts | URL + API key (before 2.26, the account's API token) | `!abs` |
| Mealie | Recipes | URL + API token | `!r` |
| Seerr | Movies and shows: play what's there, request what isn't | Automatic through Jellyfin or Plex; otherwise a Quick Connect code | `!sr` |
| Calendar (CalDAV) | Events, by title, a month back to a year ahead; optional reminders and upcoming events on the page | URL + username + app password | `!cal` |
| Miniflux | Articles from the user's feeds (full text) | URL + API key | `!rss` |
| Komga | Comics, manga and book series (full text) | URL + API key (Komga 1.20 or later) | `!komga` |
| Kavita | Manga, comics and book series | URL + Auth Key (Kavita 0.8.9 or later) | `!kavita` |
| Papra | Documents, by name and content | URL + read-only API token + organization ID | `!papra` |
| Thingport | 3D models; under `!tp`, collections and tags too; "More" opens Thingport's results page | URL + API token | `!tp` |
| Memos | The user's own memos (full text), with tags, date and checklist progress; a memo opens in full, and its checklist boxes tick from Holm | URL + access token (Memos 0.26 or later, 26.10's `/api` included) | `!memo` |
| Plane | Work items, by title or ID (`WEB-42`), across the workspace's projects; a work item opens with its state, priority, assignees, labels, due date and description | URL + workspace + API key (Plane 1.1 or later) | `!plane` |
| GitHub | The user's repos (name, description), plus issues and PRs they're involved in, as one short section; under `!gh`, Issues, Pull requests and Repositories sections. Issues are searched once typing pauses, since GitHub allows 30 searches a minute | Read-only fine-grained token. A token covers one owner's repos (the user or one org) plus all public repos, so private repos of other owners don't show | `!gh` |
| Gitea | Repos, issues and PRs the token can see (title, name, description), as one short section; under `!gt`, Issues, Pull requests and Repositories sections | URL + read-only access token (Read on repository, issue and user) | `!gt` |
| Invidious | YouTube videos, in a row of 16:9 tiles under the posters; Enter opens the video on the Invidious server | Nothing: shared, set by the operator | `!yt` |

Integrations are marked Alpha in the UI. The widgets so far are Navidrome's player and the Calendar's reminders and upcoming events.

## Enabling an integration (operator)

An integration is invisible to users until it is listed under `integrations:` in `config.yml`:

```yaml
integrations:
  immich:
    enabled: true                             # false hides it; leaving the block out does too
    name: "Photos"                            # optional display name
    shortcut: "photos"                        # optional: !photos scopes the search bar to this integration
    default_url: "https://photos.example.com" # pins the server URL for every user
    tip: "Find the API key under Account settings"  # optional hint on the connect card
    surfaces:
      search: true
      widgets: false                          # Navidrome's player, the Calendar's reminders and upcoming events
```

The key (`immich`) must match the adapter id. If an app in `apps:` has the same `id`, the integration uses that app's icon. A block without `enabled` counts as enabled.

**Set `default_url` for every integration.** The server then uses that URL for every user, whatever the browser sends, including for connections saved before it was set. Without it, users may enter any `http:` or `https:` URL, and Holm, not the browser, makes the requests, so it can reach hosts inside your network; Holm logs a warning at startup for each integration without one. An app's `groups:` don't apply to its integration: every enabled integration is listed to every signed-in user.

**Invidious is shared.** It searches YouTube through one Invidious server for everyone, with no account, so there is nothing for users to connect: Settings shows it as "Set by your admin" and Connected, with no connect form; its ⋯ menu has only **Settings**, which opens the Search provider switch so each user can leave YouTube out of their search. It stays hidden until `default_url` is set:

```yaml
integrations:
  invidious:
    default_url: "https://invidious.example.com"
    open_url: "https://www.youtube.com"   # optional
```

Videos open on the Invidious server, unless `open_url` is set. Then a video opens at `<open_url>/watch?v=<id>`, and "More" opens that site's results page, while search and thumbnails still go through Invidious.

Public Invidious servers come and go, and many turn their API off or answer with a browser check, which Holm reports as "Couldn’t reach <host>". Check that `<default_url>/api/v1/search?q=test&type=video` returns JSON, or run your own.

## Connecting (users)

1. Open **Configure → Integrations**.
2. Pick an app and fill in the fields. Each field says where to find the key in that app, with a link to its settings page where Holm knows one.
3. Press **Connect**. The form tests the connection before saving it.

Jellyfin skips the form: Holm shows a code, the user approves it under Quick Connect in Jellyfin, and Holm receives that user's own token.

Plex works the same way: the user enters Holm's code at [plex.tv/link](https://plex.tv/link). Holm keeps only the access token for the server at the configured URL. For a server you only have shared access to, that token can't reach anything else. For a server you own, Plex returns your account token itself, so treat the stored connection as being as sensitive as your Plex account.

Seerr needs no sign-in of its own for users who connected Jellyfin or Plex: Holm asks Seerr for a Quick Connect code and approves it with the user's Jellyfin token, or passes Seerr the user's Plex token, and keeps the Seerr session that comes back. When that session lapses (Seerr keeps them 30 days), Holm renews it the same way. Holm only does this for the Seerr at `default_url`; a user who points Seerr at another URL signs in with a code. Holm asks Seerr which server it runs on, so the cards only point to the one that can sign in. When a user connects Plex, Holm lends Seerr that sign-in's account token once, so shared users connect too, not only the server's owner; the token isn't kept, so after the session lapses only the owner renews silently, and others sign in again with a code. Without Jellyfin or Plex in Holm, **Sign in** on the Seerr card gives a code for the app Seerr uses: a Jellyfin Quick Connect code, or a code to enter at plex.tv/link. Seerr on Emby isn't supported yet. If Seerr has no account for a Jellyfin user, the card says so instead of showing a code. Set `default_url` for Seerr, or the automatic connection can't know where Seerr is. Seerr must be able to log the user in: the Jellyfin or Plex account has to exist in Seerr, or Seerr's new-user import has to be on.

When results come from more than one of Jellyfin, Plex and Seerr, their movies and shows share one **Movies & TV** row, each title once: titles the user has first, then those they can request, then those already requested. Albums and artists stay in their own Jellyfin or Plex row. Music, from Navidrome or that row, shows as compact cards, three to a row on a wide window and two on a narrower one: a small cover on the left, the name on top and the details under it. Seerr results show each title once: if it's on the media server, it opens there (**Play**), and Jellyfin or Plex results for the same title are folded into it. When Jellyfin or Plex returned the title itself, its link is used and Seerr's status is ignored. Each poster has the icon of the app it opens in on its top-right corner, in the icon style picked for the apps: Jellyfin or Plex for a title the user has, Seerr for one they don't. Movies and shows the user has carry a play mark on the poster that plays them in Jellyfin or Plex. For a title that isn't there, hovering the poster shows a **Request** chip along its bottom that files the request in Seerr as that user; it spins while the request is filed and then stays as a disabled **Requested** with a clock, as it does for any title Seerr already has a request for. A show that's only partly there can still be requested from its Seerr result, and the request asks for just the missing seasons; when Jellyfin or Plex also returned the show, its result is the one shown and has no **Request**. Users whose Seerr account can't request (or can't request that kind of title) see no **Request** at all. Clicking anywhere else on a movie or show poster, from Seerr, Jellyfin or Plex, opens a detail view in the search panel (backdrop, year, runtime, rating, genres, overview, cast) with **Play on Jellyfin** or **Plex**, or **Request** and **Open in Seerr**; it never requests on its own. → opens it for the selected poster, and ← or Esc goes back to the results. While the row is still loading with nothing to show yet, it shows placeholder posters.

Navidrome has the first widget, a **Player**. The operator allows it with `surfaces: { widgets: true }` under `navidrome`, and each user turns it on with the **Player** switch on their Navidrome card; it starts off. Search also finds the user's playlists whose name contains the query, shown as `Playlist · 42 songs`. With it off, a song opens its album in Navidrome like any other result. With it on, a song, album or playlist plays in Holm itself: clicking it, or Enter, starts it in a small player in the bottom-right corner (above the search bar on a phone) with the cover, title, artist, time played and length, and play/pause, stop and mute. Reloading the page brings the song back where it was, paused, with one tap to carry on (browsers don't let a page start sound on its own before it's been clicked); this is per tab, and **Stop** clears it. An album plays in track order and a playlist in its own order, moving to the next track on their own and stopping after the last; **Stop** ends the whole album or playlist. While a playlist plays the player adds **Shuffle**, between play/pause and stop: it shuffles every track after the current one and jumps straight to the first of the new order, so tapping it right after starting a playlist gives a random song. It's an action, not a switch, so each tap reshuffles. There's no seeking or skip; picking another song, album or playlist replaces what's playing, and **Open in Navidrome** (⌘↵, or ⌘-click) still opens it. If an album or playlist can't be loaded, its card says why in place of its details. The audio comes through Holm's proxy with the user's own token, as the original file, so the browser has to support its format (MP3, AAC, FLAC and Ogg play everywhere; ALAC only in Safari).

The Calendar works with any CalDAV server: Nextcloud, Radicale, Baïkal, Stalwart, Fastmail, iCloud and others. The user gives the address their calendar app uses (for Nextcloud, `https://<host>/remote.php/dav`; a server root or a single calendar's URL works too), a username and an app password. Holm finds every calendar that holds events and skips task lists. Search matches event titles from 30 days back to a year ahead, upcoming events first, with recurring events listed once per occurrence; picking one opens the **Calendar web address**, under **Advanced** on the card. That is optional: for Nextcloud, iCloud and Fastmail Holm knows the calendar page, and anywhere else without one (Stalwart has no web calendar) picking an event shows its details: time, place and notes (its links clickable), a **Join call** button when the event has a video call link, with a chip naming the service (Stalwart, Nextcloud, iCloud, Fastmail) when Holm can tell it from the URL. Google Calendar has no app passwords for CalDAV, so it needs a sign-in of its own and isn't supported yet. The app password is stored encrypted like any other key. Holm follows the server's redirects only to the same origin or the same host over https, plus, for iCloud, to the account's own `pNN-caldav.icloud.com`, so the password never goes anywhere else. Changing the web address keeps the app password; changing the CalDAV URL to another server asks for it again. Recurring events rely on the server expanding them (CalDAV's `expand`), as Nextcloud, Radicale, Baïkal, Stalwart and Fastmail do (iCloud is untested); on a server that doesn't, a series shows up nowhere rather than only its first occurrence. Stalwart leaves the reminders out of the occurrences it expands, so for events that come back without one, Holm reads the stored event and gives each occurrence its reminders.

A user with calendars in more than one place (say iCloud for the family and Fastmail for work) adds the others with **+ Add account** under **Accounts** on the Calendar card, up to five more, each tested before it's saved. Each account is a row that opens its settings on click. Search, reminders and upcoming events read every account, and one that can't be reached is left out rather than hiding the rest. Each account's app password is stored encrypted and kept to its own server, like the first one's; disconnecting the Calendar removes them all. Each account has a **Color**, picked from the Mac's swatches (blue for the first, and a color none of the others has for each one added): its events show a dot in that color in the upcoming list, and a calendar icon tinted with it in reminders and search.

The Calendar's widgets are **Reminders** and **Upcoming events**. The operator allows them with `surfaces: { widgets: true }` under `caldav`, and connecting a calendar turns both on; each user can turn them off with the one widgets switch on their Calendar card.

**Upcoming events** puts the next event on a small line under the clock, the way a phone's "at a glance" does: its title and when ("in 20 min", "14:30", "tomorrow 10:00"), preferring a timed event over an all-day one. Clicking it opens the week ahead, grouped by day, with each event's time and place; picking one opens its details in search, the same as picking it from the results. It refreshes every 5 minutes and when the tab comes back into view.

With **Reminders** on, Holm shows each event's own reminders on the page, at the times set in the calendar app (15 minutes before, a day before, and so on); an event with no reminder set gets none. The page asks Holm for what's due in the next day every 5 minutes and when the tab comes back into view, so a reminder added in the calendar shows up within about 5 minutes. Each one appears in the bottom-right corner (above the search on a phone, and above the player while a song is playing) with the title, how soon it starts, the place, **Join call** for an event with a video call link, **Open**, **Snooze** and **Dismiss**. It shows in every open Holm tab and stays up, through reloads, until dismissed; dismissing or snoozing it in one tab clears it in all of them. **Snooze** brings it back in 10 minutes, or when the event starts if that's sooner, as the Mac's Calendar does. One that fell due while the page was closed still shows when it opens, as long as its event isn't over. Reminders that only send email are left to the calendar server.

Navidrome asks for a password once. Holm computes the Subsonic token `md5(password + salt)` with a random salt and stores the salt and token, encrypted at rest, never the password. The token works for the Subsonic API until the password changes, and anyone holding the salt and token can try to brute-force a weak password, so use a strong one. Changing the username asks for the password again.

An integration's widgets switch is also in **Configure → Widgets**. Once an integration with `surfaces.widgets` on is connected, it appears there next to Clock, Weather and Search, and both places flip the same switch.

After connecting, results from the app appear in the search bar. Typing `!<shortcut>` searches only that app.

## Security

- **Per-user credentials.** Each user connects with their own key, so search results respect that user's permissions in the app.
- **Encrypted at rest** with AES-256-GCM. Set `HOLM_SECRET_KEY` to 32 bytes, hex or base64 (`openssl rand -hex 32`). Without it, Holm generates `.integrations-key` next to the database, so anyone with a copy of the data directory also has the key. See [configuration.md](configuration.md#integration-credentials).
- **Never sent back to the browser.** API responses redact secret fields. Thumbnails and previews are fetched through Holm (`/api/integrations/<id>/proxy/…`), so the key never appears in an `<img src>`. The proxy passes on images and audio only (other binary replies only as a download).
- **Tied to their server.** Changing a connection's URL to another server (a different scheme, host or port) drops its stored key or token, so the new host has to be signed in to afresh.
- **Disconnect** deletes the stored credentials. A Seerr connected through Jellyfin or Plex is linked to it: disconnecting that Jellyfin or Plex disconnects Seerr too, and connecting it again brings Seerr back. A Seerr signed in with a code stays connected. A disconnected Seerr stays disconnected rather than reconnecting through Jellyfin or Plex on its own; **Sign in** on its card brings it back, and so does connecting Jellyfin or Plex again, through Jellyfin or Plex when it can and with a code otherwise. Jellyfin also revokes its token. To revoke a Plex sign-in, remove the "Holm" device under **Authorized Devices** in Plex. A Seerr code sign-in through plex.tv/link appears there as "Holm (Seerr sign-in)"; Holm doesn't keep that token, but Seerr saves it as the user's Plex token, so removing it leaves Holm alone and can stop Seerr's own Plex features for that user, such as watchlist sync.

## Adding an integration

An integration is one file plus one import line. The settings form, API routes and search bar discover it on their own.

1. Create `src/lib/server/integrations/<id>.js` that default-exports an adapter object:

   ```js
   /** @type {import('./_types.js').IntegrationAdapter} */
   export default {
   	id: 'myapp',                 // must match the config.yml key
   	name: 'My App',
   	shortcut: 'm',               // default !scope
   	description: 'One-line summary',

   	// Fields rendered in the connect form: url, text or secret; advanced: true
   	// folds one away under Advanced. type: 'color' with options: [{ value, label, hex }]
   	// is a row of swatches
   	configSchema: [
   		{ key: 'url', type: 'url', label: 'URL', required: true, fromOperatorDefault: 'default_url' },
   		{ key: 'apiKey', type: 'secret', label: 'API key', required: true }
   	],

   	// Runs on Test and before Connect; message is shown as-is
   	async test({ config, fetch }) {
   		return { ok: true, message: 'Connected' };
   	},

   	searchProviders: {
   		items: {
   			label: 'Items',
   			mode: 'inline',
   			kind: 'media',           // optional: 'media' = posters, 'photo' = a grid
   			// layout: 'tracks',     // optional: override the layout picked from kind
   			// shelf: 'video',       // optional: join the shared "Movies & TV" row
   			async query({ config, query, limit, fetch }) {
   				// more: optional, where "More in My App" goes (e.g. its results page)
   				return { results: [{ id, title, subtitle, thumbnail, href }], more };
   			}
   		}
   	},

   	// Optional: serve authenticated images through Holm
   	proxy: {
   		thumbnail: { async fetch({ config, params, fetch }) { /* return a Response */ } }
   	}
   };
   ```

   To let people search inside a tag, list or folder once they've scoped to
   the app, add a `scoped: true` provider whose results carry a `filter`, and
   mark the provider that searches inside it `filters: true`:

   ```js
   	tags: {
   		label: 'Tags',
   		mode: 'inline',
   		scoped: true,            // asked only under !m, never in an everyday search
   		                         // (plainOnly: true is the opposite: an everyday
   		                         // summary that !m swaps for the full sections)
   		async query({ config, query }) {
   			return { results: [{ id, title: '#recipes', href, filter: { label: '#recipes', params: { tag: 'recipes' } }, meta: { kind: 'tag' } }] };
   		}
   	},
   	items: {
   		label: 'Items',
   		mode: 'inline',
   		filters: true,           // the one asked inside a picked filter
   		async query({ config, query, filter }) {
   			// filter is the picked result's filter.params, sent back by the
   			// browser: check it. query may be empty: list what's inside.
   		}
   	}
   ```

   Picking `#recipes` turns the chip into `My App › #recipes` and asks only
   the `filters` providers again, with the filter. Typing narrows inside it;
   Backspace on an empty box or Escape steps back to the app's scope. The row's
   `href` stays one keypress away as "Open in My App" (⌘↵).

2. Import it in `src/lib/server/integrations/index.js` and add it to `KNOWN_ADAPTERS`.
3. Add an example entry under `integrations:` in `config.example.yml`.

The full contract, including `signIn` for device-code flows like Quick Connect, `signOut`, `linkedTo` / `connectFromLinked` for signing in through another integration, `actions` for writes from a search result, `details` for a result's detail view, and `prepareConfig` for swapping a typed secret for a derived one before it is saved, is documented in [`_types.js`](../src/lib/server/integrations/_types.js). [`karakeep.js`](../src/lib/server/integrations/karakeep.js) is a short, complete example.
