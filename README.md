# Chibisafe Uploader

<p align="center">
  <img height="300" src="https://chibisafe.moe/xjoghu.png">
</p>

Companion extension for the chibisafe v6 and v7 service.

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
