# Pear v3 mobile catalogue boundary

PearBrowser mobile is a Hyperdrive browser and a local-first web-app host. It is not a desktop Pear v3 installer or a compatibility host for Pear v2 executables.

| Catalogue entry | Mobile action | Why |
| --- | --- | --- |
| `hyper://` site or drive key | **Open** | Content is loaded through the local Hyper proxy, with relay and P2P paths. |
| v3 native desktop package (`generation: 3` or native delivery plus a desktop target) | **Desktop only** | Native packages must be verified and installed by the supported desktop host. |
| `pear://` or `file://` v2 executable | **Migration required** | Mobile retains the record for discovery but never invokes it as a browser URL or runtime entrypoint. |

This protects users from a misleading “Install” button and prevents a remote executable link from crossing into a local runtime boundary. App owners migrate legacy releases on desktop, preserving user data with the Pear migration tooling; browser users keep browsing the sites that remain ordinary Hyperdrive content.
