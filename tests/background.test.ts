import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { fakeBrowser } from 'wxt/testing';
import type { ContentMessage, SettingsResult } from '../lib/messages';

mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
const { default: background } = await import('../entrypoints/background');
const originalFetch = globalThis.fetch;
const account = { uuid: 'user-1', username: 'senchou', permissions: { canUploadFiles: true } };
const albums = [{ uuid: 'folder-1', name: 'Art' }];
const credentials = { siteUrl: 'https://safe.example', apiKey: 'key' };
let messages: { tabId: number; message: ContentMessage }[];
let uploadStatus: number;
let uploadBodies: FormData[];
let removedRules: number[];
type MediaClickListener = Parameters<typeof fakeBrowser.contextMenus.onClicked.addListener>[0];
let onMediaClicked: MediaClickListener;

beforeEach(() => {
	fakeBrowser.reset();
	messages = [];
	uploadStatus = 201;
	uploadBodies = [];
	removedRules = [];
	spyOn(fakeBrowser.contextMenus, 'create').mockImplementation(() => 'chibisafe');
	spyOn(fakeBrowser.contextMenus.onClicked, 'addListener').mockImplementation((listener: MediaClickListener) => {
		onMediaClicked = listener;
	});
	spyOn(fakeBrowser.tabs, 'sendMessage').mockImplementation(async (tabId: number, message: ContentMessage) => {
		messages.push({ tabId, message });
	});
	spyOn(fakeBrowser.declarativeNetRequest, 'getSessionRules').mockImplementation(async () => []);
	spyOn(fakeBrowser.declarativeNetRequest, 'updateSessionRules').mockImplementation(
		async (options: Parameters<typeof fakeBrowser.declarativeNetRequest.updateSessionRules>[0]) => {
			removedRules.push(...(options.removeRuleIds ?? []));
		}
	);
	const fetchMock = Object.assign(
		async (input: RequestInfo | URL, init: RequestInit = {}) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (url.hostname === 'media.example') return new Response('media', { headers: { 'content-type': 'image/png' } });
			if (url.pathname === '/api/version') return new Response(null, { status: 404 });
			if (url.pathname === '/api/v1/users/me') return Response.json(account);
			if (url.pathname === '/api/v1/folders') return Response.json({ results: albums, count: 1 });
			if (url.pathname === '/api/v1/upload') {
				uploadBodies.push(init.body as FormData);
				return Response.json(
					uploadStatus === 201
						? { uuid: 'file-1', identifier: 'abc', filename: 'abc.png' }
						: { message: 'File is too large' },
					{ status: uploadStatus }
				);
			}
			throw new Error(`Unexpected request: ${url.pathname}`);
		},
		{ preconnect: originalFetch.preconnect }
	);
	spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
	background.main();
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	mock.restore();
});

async function saveSettings() {
	const results = await fakeBrowser.runtime.onMessage.trigger(
		{ type: 'saveSettings', data: { ...credentials, showRecentAlbums: true } },
		{}
	);
	return results[0] as SettingsResult;
}

async function selectMedia(tabId: number) {
	const window = await fakeBrowser.windows.create({ url: 'https://page.example' });
	const tab = await fakeBrowser.tabs.create({ windowId: window.id, url: 'https://page.example' });
	await onMediaClicked(
		{ menuItemId: 'chibisafe', srcUrl: 'https://media.example/image.png', editable: false },
		{ ...tab, id: tabId }
	);
}

test('settings messages without a sender tab validate and save successfully', async () => {
	expect(await saveSettings()).toMatchObject({
		ok: true,
		connection: { version: '7', username: 'senchou', albumCount: 1 }
	});
	expect(await fakeBrowser.storage.local.get(['version', 'albums'])).toEqual({ version: '7', albums });
});

test('background uploads include the page source and remember a successful destination', async () => {
	await saveSettings();
	await selectMedia(12);
	await fakeBrowser.runtime.onMessage.trigger(
		{ type: 'upload', data: { albumUuid: 'folder-1', pageUrl: 'https://www.pixiv.net/artworks/123456' } },
		{ tab: { id: 12 } }
	);
	expect(uploadBodies[0].get('source')).toBe('https://www.pixiv.net/artworks/123456');
	expect(messages.at(-1)?.message.type).toBe('uploadSuccess');
	expect((await fakeBrowser.storage.local.get('recentAlbums')).recentAlbums).toEqual(albums);
	expect(removedRules).toHaveLength(1);
});

test('background upload failures report the server error and clean up without recording a recent destination', async () => {
	await saveSettings();
	await selectMedia(12);
	uploadStatus = 413;
	await fakeBrowser.runtime.onMessage.trigger(
		{ type: 'upload', data: { albumUuid: 'folder-1', pageUrl: 'https://page.example' } },
		{ tab: { id: 12 } }
	);
	expect(messages.at(-1)?.message).toEqual({ type: 'uploadError', data: 'File is too large' });
	expect((await fakeBrowser.storage.local.get('recentAlbums')).recentAlbums).toEqual([]);
	expect(uploadBodies).toHaveLength(1);
	expect(removedRules).toHaveLength(1);
});

test('a failed settings change preserves the configured instance', async () => {
	await saveSettings();
	const before = await fakeBrowser.storage.local.get();
	const results = await fakeBrowser.runtime.onMessage.trigger(
		{ type: 'saveSettings', data: { siteUrl: 'invalid', apiKey: 'key', showRecentAlbums: false } },
		{}
	);
	expect(results[0]).toMatchObject({ ok: false });
	expect(await fakeBrowser.storage.local.get()).toEqual(before);
});

test('uploads and reports success while a folder refresh is still pending', async () => {
	await saveSettings();
	await selectMedia(12);
	const started = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const fetchMediaAndUpload = spyOn(globalThis, 'fetch').getMockImplementation();
	if (!fetchMediaAndUpload) throw new Error('The fetch fixture is missing');
	spyOn(globalThis, 'fetch').mockImplementation(
		Object.assign(
			async (input: RequestInfo | URL, init: RequestInit = {}) => {
				const url = new URL(input instanceof Request ? input.url : String(input));
				if (url.pathname === '/api/v1/folders') {
					started.resolve();
					await release.promise;
				}
				return fetchMediaAndUpload(input, init);
			},
			{ preconnect: originalFetch.preconnect }
		)
	);
	const refresh = fakeBrowser.runtime.onMessage.trigger({ type: 'getAlbums' }, { tab: { id: 12 } });
	await started.promise;
	const upload = fakeBrowser.runtime.onMessage.trigger(
		{ type: 'upload', data: { albumUuid: 'folder-1', pageUrl: 'https://page.example' } },
		{ tab: { id: 12 } }
	);
	const deadline = Promise.withResolvers<never>();
	const timer = setTimeout(() => deadline.reject(new Error('Upload waited for the folder refresh')), 1000);
	try {
		await Promise.race([upload, deadline.promise]);
		expect(uploadBodies).toHaveLength(1);
		expect(messages.at(-1)?.message.type).toBe('uploadSuccess');
		expect(removedRules).toHaveLength(1);
		// Recents remain serialized with refresh writes and are recorded afterward.
		expect((await fakeBrowser.storage.local.get('recentAlbums')).recentAlbums).toEqual([]);
	} finally {
		clearTimeout(timer);
		release.resolve();
		await Promise.all([refresh, upload]);
	}
});
