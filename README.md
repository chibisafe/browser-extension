# Chibisafe Uploader

<p align="center">
  <img height="300" src="https://chibisafe.moe/xjoghu.png">
</p>

Companion extension for the chibisafe service.

Supports chibisafe v6 and the v7 API. Saving settings validates the instance URL,
API key, account, and destination list before replacing the saved configuration.
The settings page displays the detected version and uses albums for v6 or folders
for v7.

Detection checks `/api/version` for a v6 version string. If the route is missing
(404/405, or a successful HTML frontend fallback), an authenticated
`/api/v1/users/me` response confirms v7 API compatibility. Network failures,
authentication failures, server errors, and unsupported reported versions do not
change the saved configuration. A missing saved account or destination endpoint
triggers one fresh detection during a refresh, allowing instance upgrades without
automatically retrying uploads.

API differences live in `lib/api.ts`. V6 uploads retain the `file[]` multipart
field, `albumuuid` destination header, and `x-source-url` source-page header.
V7 uploads use `chibi-folder-uuid` and append the multipart `source` field before
the `file` field, following the backend team's source metadata contract.
Destination lists are paginated with v6's `page` or v7's `offset` parameter.

`lib/settings.ts` orders settings saves and cache updates. Existing `albums` and
`recentAlbums` storage keys remain shared by both API adapters for compatibility
with older installations. Changing the instance, authenticated account, or API
generation clears recent destinations. Successful uploads add destinations to
the recent list.

Run `bun test` for API, settings, background-message, and multipart HTTP tests,
and `bun run compile` for TypeScript checks. The tests use local fixtures and a
local HTTP server; they do not upload to a real chibisafe instance.

Chibisafe is an open-source self-hosted file hosting service that allows for fast and easy file uploads. This extension aims to make it easy to upload to a chibisafe instance by adding a few new options to the context menu for quick uploading.

## Features

The extension adds a new item in the browser context menu that allows you to:
 - Send the currently select file to your safe
 - Alternatively, upload it to a specific album
 - Access to your chibisafe extension settings

## Install new v3 extension

The new versions are not on the store yet, so if you want to install them right away you can download the [chrome](https://github.com/chibisafe/chibisafe-extension/actions/runs/22151355045/artifacts/5560202790) or the [firefox](https://github.com/chibisafe/chibisafe-extension/actions/runs/22151355045/artifacts/5560202909) version, unzip them, and load them as an unpackaged extension on your browser.

These versions were built by a [GitHub workflow](https://github.com/chibisafe/chibisafe-extension/actions/runs/22151355045)

## Install old v2 version

<p>
	<a href="https://chrome.google.com/webstore/detail/chibisafe-uploader/enkkmplljfjppcdaancckgilmgoiofnj"><img src="https://raw.githubusercontent.com/alrra/browser-logos/ce0aac8/src/chrome/chrome.svg" valign="middle" height="55"></a>
	<a href="https://chrome.google.com/webstore/detail/chibisafe-uploader/enkkmplljfjppcdaancckgilmgoiofnj"><img src="https://img.shields.io/chrome-web-store/v/enkkmplljfjppcdaancckgilmgoiofnj.svg" valign="middle"></a>
	&nbsp;
	<a href="https://addons.mozilla.org/en-US/firefox/addon/chibisafe-uploader/"><img src="https://raw.githubusercontent.com/alrra/browser-logos/ce0aac8/src/firefox/firefox.svg" valign="middle" height="55"></a>
	<a href="https://addons.mozilla.org/en-US/firefox/addon/chibisafe-uploader/"><img src="https://img.shields.io/amo/v/chibisafe-uploader.svg" valign="middle"></a>
</p>

<p>
	Chrome version can be used in Edge, Vivaldi and other Chromium based browsers.
</p>

## Building

If you want to build the extension yourself and use it as an unpackaged extension, you can do so by doing the following:

* Clone the repository.
* Run `bun install` to install dependencies.
* Run `bun run build` or `bun run build:firefox` to build the extension.

The built extension will be located in the `.output` directory. Load the appropriate subdirectory as an unpackaged extension in your browser.
