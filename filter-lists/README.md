# P2P filter lists — seed data

Content Shield rules are distributed the same way as every other PearBrowser
artifact: as Hyperdrives, pinned on the relay, synced peer-to-peer. No CDN,
no vendor list-fetch fingerprint, fully offline after first sync.

## Live drives (published, pinned, verified 2026-07-16)

| Artifact | Drive key |
|---|---|
| pear-default filter list | `842fb9e64c1c2092ec426151fd4f9ffb23a2efcae26ff3dd61d5d564ed58d99f` |

Subscribe in the browser: Settings → Content Shield → *Filter lists from the
swarm* → paste `842fb9e6…`. Rule text is persisted locally (user-data
settings), so the list keeps blocking with no network at all; the
subscription metadata (version/checksum) lives alongside it. Subscribed
browsers verify the manifest sha256 and hot-swap on their refresh sweep
(every 30 minutes, or immediately via **Refresh** in Settings).

## Drive format

A filter-list drive contains:

```text
/filters.txt      the rules (Content Shield syntax subset)
/manifest.json    { name, version, filters, sha256, rules, builtAt }
```

`pear-default/` here is the seed copy of the default list (rules +
manifest). The publishing/build tooling (`build-shield-list.mjs`,
`publish-and-pin.js`, `reseed-drive.js`) lives in the desktop repo
(`01-browser/pearbrowser-desktop/scripts/`); updates are published from
there and reach mobile over the swarm like any other drive update.

See `backend/content-shield.cjs` for the supported rule syntax
(`||host^`, substrings, `@@` exceptions, `##` cosmetic, `##+js()` scriptlets,
hosts-file lines) and `backend/shield-list-sync.cjs` for the
subscribe/verify/hot-swap lifecycle.
