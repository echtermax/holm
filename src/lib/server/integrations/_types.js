// JSDoc types for the integration adapter contract.
// Adapters are plain modules — there's no class to extend, no interface to
// implement. They default-export an object that matches `IntegrationAdapter`.
//
// Adding a new integration is one new file in this directory plus one line
// in `index.js` to import it. The rest of the framework — settings UI, API
// routes, search bar — discovers it generically through this contract.

/**
 * @typedef {Object} ConfigField
 * @property {string} key                       Stable id (used as the form name and the stored config key)
 * @property {'url'|'text'|'secret'|'color'} type  Renders as <input type="...">; 'secret' redacts to bullets in API responses; 'color' is a row of swatches from `options`
 * @property {string} label                     Human-readable label
 * @property {boolean} [required]               Defaults to false
 * @property {string} [placeholder]
 * @property {string} [help]                    Small helper text shown under the field
 * @property {{ baseKey: string, path: string, label: string }} [helpUrl]  Clickable link built from config[baseKey] + path
 * @property {string} [fromOperatorDefault]     If set, the form pre-fills from `integrations.<id>.<value>` in config.yml
 * @property {{ value: string, label: string, hex: string }[]} [options]  The swatches of a 'color' field; the value stored is `value`
 * @property {string} [default]                 Shown, and saved, when the field has no value yet
 * @property {boolean} [advanced]               Shown folded away under Advanced on the form, for fields most users leave empty
 * @property {boolean} [hidden]                 Stored and redacted like any field, but never rendered — filled by `signIn`
 * @property {boolean} [trim]                   Defaults to true; set false where surrounding spaces matter (a password)
 * @property {boolean} [link]                   A 'url' field the browser only opens (a web page) and Holm never sends credentials to, so changing its origin keeps the stored secrets
 */

/**
 * @typedef {Object} TestResult
 * @property {boolean} ok
 * @property {string} message                   Shown verbatim in the UI — keep it short and human
 */

/**
 * @typedef {Object} SearchResultItem
 * @property {string} id
 * @property {string} title
 * @property {string} [subtitle]                Secondary text (e.g. URL, tags, category)
 * @property {string} [thumbnail]               URL of an image; rendered as a tile
 * @property {string} href                      Where to send the user when they click
 * @property {string} [openLabel]               Label for opening `href`, e.g. 'Play'; defaults to 'Open'
 * @property {object} [detail]                  Params for the adapter's `details`; a click opens the detail view instead of `href`
 * @property {{ key: string, label: string, params: object }} [action]  Runs `actions[key]` with `params` from a button on the result (e.g. 'Request'); a click still opens `href`
 * @property {{ label: string, params: object }} [filter]  A tag, list or folder to search inside: picking the result scopes the bar to `<app> › label` and asks the app's `filters` providers again with `params` as `filter`; `href` moves to "Open in <app>"
 * @property {Object} [meta]
 * @property {string} [meta.kind]               'photo' triggers the photo-grid variant in SearchResults
 * @property {string} [meta.takenAt]
 * @property {string} [meta.duration]         A video's length, shown on its thumbnail, e.g. '2:32'
 * @property {string} [meta.info]             A third line under a video's title, e.g. '9.2M views · 12 years ago'
 * @property {string} [meta.color]              A hex color the result's icon is tinted with (a calendar event's account)
 * @property {string} [meta.status]             Short badge, e.g. 'Available'
 * @property {string} [meta.tmdb]               '<movie|tv>:<tmdb id>' — identifies the title across providers
 * @property {{ title: string, artist?: string, duration?: number, stream: string, cover?: string }} [meta.track]  A song Holm can play itself: `stream` is a proxy URL for the audio, `duration` in seconds
 * @property {{ done: number, total: number } | null} [meta.progress]  A checklist's ticked and total boxes, shown on the row as 'N/M done'
 * @property {object} [meta.queue]             Params for the adapter's `queue`: an album or playlist Holm can play itself, in turn
 * @property {boolean} [meta.merge]             This result stands for its title: other providers' results with the same `meta.tmdb` are hidden
 */

/**
 * @typedef {Object} SearchProvider
 * @property {string} label                     Shown in the provider switcher dropdown
 * @property {'inline'|'redirect'} mode         inline = dropdown of results; redirect = form-submit to an external URL
 * @property {'media'|'photo'|'video'} [kind]  Results are posters, photos or videos, so the bar shows placeholders of that shape while the first ones load
 * @property {'poster'|'tracks'|'grid'|'video'|'list'} [layout]  Overrides the layout picked from kind: media = poster, photo = grid, else list. video = 16:9 tiles with `meta.duration` on the art and `meta.info` under the title
 * @property {'video'} [shelf]                Movies and shows from every provider with shelf 'video' share one "Movies & TV" row
 * @property {boolean} [scoped]                Asked only once the user has scoped the bar to this app (`!<shortcut>`): sections such as Tags or Lists that would crowd an everyday search
 * @property {boolean} [plainOnly]             The opposite of `scoped`: asked only in an everyday search, and dropped once the bar is scoped to this app, whose other sections then answer instead (GitHub's short summary)
 * @property {number} [delay]                  Ms after the last keystroke before this provider is asked, for an API with a tight rate limit; never less than the bar's 250 ms
 * @property {boolean} [filters]               Searches inside a picked `filter`: it receives `filter`, and is the only kind of provider asked while one is picked
 * @property {(config: object) => string} [failMessage]  Shown instead of "Search failed: …" when the query throws or times out (Invidious: "Couldn’t reach <host>…")
 * @property {(ctx: AdapterContext & { query: string, limit: number, filter?: object }) => Promise<{ results: SearchResultItem[], more?: string }>} query
 *   `more` is where "More in <app>" goes when there are more results than the
 *   section shows, e.g. the app's own results page for this query. Without it
 *   the link opens the app's URL. `filter` is a picked result's
 *   `filter.params`, sent back by the browser: check it before use. With a
 *   filter, `query` may be empty: list what is inside it.
 */

/**
 * @typedef {Object} AdapterContext
 * @property {object} config                     The user's stored config
 * @property {typeof fetch} fetch
 * @property {Record<string, object>} [linked]   Only for `linkedTo` adapters: the user's configs for those integrations, when connected
 * @property {(config: object) => Promise<void>} [saveConfig]  Only for `linkedTo` adapters: replaces the stored config (e.g. a renewed session)
 * @property {string} [timeZone]                 Search only: the user's IANA time zone, from the browser (UTC when it sent none)
 */

/**
 * @typedef {Object} Reminder
 * @property {string} id                         Stable across polls: the page keeps each id up until it is dismissed
 * @property {string} title
 * @property {number} at                         When to show it, ms since the epoch
 * @property {number} start                      When the event starts, ms
 * @property {number|null} [end]
 * @property {boolean} [allDay]
 * @property {string} [location]
 * @property {string} [href]                     Opened by the reminder's Open button
 * @property {string|null} [call]               The event's video call link, for a Join button
 */

/**
 * @typedef {Object} UpcomingEvent
 * @property {string} id
 * @property {string} title
 * @property {number} start                      ms since the epoch
 * @property {number|null} [end]
 * @property {boolean} [allDay]
 * @property {string} [location]
 * @property {string|null} [href]                Where the event opens, if anywhere
 * @property {object} [detail]                    Params for the integration's `details`, as on a search result
 */

/**
 * @typedef {Object} Action
 * A write the user triggers from a search result (`SearchResultItem.action`),
 * run by POST /api/integrations/:id/action/:key. `params` come from the
 * browser, so validate them.
 * @property {(ctx: AdapterContext & { params: object }) => Promise<TestResult>} run
 */

/**
 * @typedef {Object} ProxyHandler
 * Proxies an authenticated upstream resource through Holm so the browser
 * never sees the integration's API key. Used for thumbnails, previews,
 * downloads — anything that needs to land in an `<img src>` or `<a href>`
 * without leaking credentials.
 *
 * The handler returns a Response (or anything `fetch()`-compatible) and the
 * generic /api/integrations/:id/proxy/:key/* route streams it back to the
 * browser with content-type and cache headers preserved.
 *
 * @property {(ctx: { config: object, params: Record<string,string>, request: Request, fetch: typeof fetch }) => Promise<Response>} fetch
 * @property {string} [defaultCacheControl]                    Cache-Control header to set if upstream doesn't provide one
 * @property {boolean} [stream]                                 Audio or video: the deadline covers the response headers only, so the body can play for as long as it lasts
 */

/**
 * @typedef {Object} SignIn
 * A device-code style sign-in (e.g. Jellyfin Quick Connect): Holm shows a
 * code, the user approves it inside the other app, and the adapter trades the
 * approval for that user's own token. No password or admin key passes through
 * Holm. The generic /api/integrations/:id/signin route keeps `state`
 * server-side and saves the connection when `poll` reports done.
 *
 * @property {string} label                                    Button text, e.g. 'Sign in with Quick Connect'
 * @property {string} [help]                                   Markdown shown next to the code
 * @property {(ctx: { config: object, linked?: Record<string, object>, fetch: typeof fetch }) => Promise<{ code: string, link?: string, help?: string, state: object } | { error: string }>} start  `link` is where the user enters the code; `help` replaces `signIn.help` while the code shows
 * @property {(ctx: { config: object, state: object, fetch: typeof fetch }) => Promise<{ status: 'pending' } | { status: 'done', config: object, forLinked?: object } | { status: 'error', error: string }>} poll  `forLinked` is lent to `linkedTo` adapters for one connect and never saved (Plex: the account token)
 */

/**
 * @typedef {Object} IntegrationAdapter
 * @property {string} id                                       Must match the config.yml key
 * @property {string} name                                     Display name
 * @property {string} [icon]                                   Fallback icon — normally resolved from the app with the same id in config.yml
 * @property {string} description                              One-line summary
 * @property {ConfigField[]} configSchema                      Fields rendered in the connect form
 * @property {(ctx: { config: object, fetch: typeof fetch }) => Promise<TestResult>} test
 * @property {SignIn} [signIn]                                 Replaces the Test/Connect buttons with a code-approval flow
 * @property {(ctx: { config: object, fetch: typeof fetch }) => Promise<void>} [signOut]  Best-effort token revoke on disconnect
 * @property {string[]} [linkedTo]                       Ids of integrations this one can sign in through (Seerr: jellyfin, plex)
 * @property {(ctx: { config: object, linked: Record<string, object>, fetch: typeof fetch }) => Promise<object|{ error: string }|null>} [connectFromLinked]  Connects the user without asking, from a linked connection; returns the config to save, null to fall back to `signIn`, or `{ error }` when a code would fail the same way
 * @property {(ctx: { config: object, fetch: typeof fetch }) => Promise<string[]>} [linkedVia]  Which of `linkedTo` can sign in at the operator's URL (Seerr: the server it runs on), for the cards' wording
 * @property {Record<string, Action>} [actions]             Writes triggered from search results
 * @property {(ctx: AdapterContext & { params: object }) => Promise<{ title: string, facts?: string[], rating?: number|null, genres?: string[], tagline?: string, overview?: string, cast?: string[], thumbnail?: string, backdrop?: string, link?: { label: string, href: string } | null, pinned?: boolean, fields?: { label: string, value?: string, color?: string, warn?: boolean, chips?: { text: string, color?: string, initials?: string }[] }[], markdown?: string, html?: string, checklist?: { key: string, params: object } } | null>} [details]  Detail view for a result's `detail` params; null when they're invalid. `fields` is a label/value grid (a work item's state, assignees); `markdown` or `html` is a body the browser sanitizes; with `checklist`, its task boxes are live and a tick runs `actions[key]` with `params` plus `{ index, checked, text }`
 * @property {(ctx: { config: object, params: object, fetch: typeof fetch }) => Promise<Array<{ title: string, artist?: string, duration?: number, stream: string, cover?: string }> | null>} [queue]  The tracks for a result's `meta.queue` params, in play order, shaped like `meta.track`; null when the params are invalid
 * @property {(ctx: { config: object }) => object} [prepareConfig]  Rewrites the merged config just before it is saved, e.g. swapping a password for a derived token
 * @property {Record<string, SearchProvider>} [searchProviders]
 * @property {Record<string, ProxyHandler>} [proxy]            Optional proxy handlers keyed by name (e.g. 'thumbnail')
 * @property {Record<string, { label: string, description?: string }>} [widgets]  Widgets behind the `widgets` surface, e.g. Navidrome's player; the user's switch is `surfaces.widgets`
 * @property {boolean} [shared]  The operator's, not the user's: every user is connected to the URL in config.yml (`fromOperatorDefault` fields), with nothing to connect; only the user's Use for switches are stored; hidden until the operator sets `default_url`
 * @property {boolean} [multiAccount]  The user can add more accounts under the first (up to 5), stored as `config.accounts`: each a config of the same schema plus an `id`, checked and redacted like the first. The adapter reads them all (see accountsOf in caldav.js)
 * @property {boolean} [widgetsOnConnect]  Turn the widgets switch on when the user first connects (where the operator allows widgets); otherwise it starts off
 * @property {(ctx: { config: object, fetch: typeof fetch, timeZone: string }) => Promise<Reminder[]>} [reminders]  Reminders due in the next day, or already due for an event not yet over, for GET /api/reminders; asked only while the user's widgets switch is on
 * @property {(ctx: { config: object, fetch: typeof fetch, timeZone: string }) => Promise<UpcomingEvent[]>} [upcoming]  The next events, still on now to a week ahead, for GET /api/upcoming; asked only while the user's widgets switch is on
 */

export {};
