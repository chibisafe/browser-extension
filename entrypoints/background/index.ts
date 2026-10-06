import { createApiClient, getErrorMessage } from '@/lib/api';
import type { BackgroundMessage, ContentMessage, SettingsResult } from '@/lib/messages';
import { ConnectionManager } from '@/lib/settings';
import { getFileExtension } from '@/lib/utils';
import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

export default defineBackground(() => {
	const connections = new ConnectionManager(browser.storage.local);
	const mediaUrls = new Map<number, string>();
	let nextRuleId = 1;

	const notify = async (tabId: number, message: ContentMessage) => {
		try {
			await browser.tabs.sendMessage(tabId, message);
		} catch {
			// The user may close or navigate the source tab while a request is running.
		}
	};

	const upload = async (albumUuid: string | undefined, pageUrl: string, tabId: number) => {
		let ruleId: number | undefined;
		try {
			const connection = await connections.get();
			const mediaUrl = mediaUrls.get(tabId);
			if (!mediaUrl) throw new Error('Select media from the browser context menu again.');

			const activeRules = await browser.declarativeNetRequest.getSessionRules();
			while (activeRules.some(rule => rule.id === nextRuleId)) nextRuleId++;
			const candidateRuleId = nextRuleId++;
			await browser.declarativeNetRequest.updateSessionRules({
				addRules: [
					{
						id: candidateRuleId,
						priority: 1,
						action: {
							type: 'modifyHeaders',
							requestHeaders: [{ header: 'Referer', operation: 'set', value: pageUrl }]
						},
						condition: { urlFilter: mediaUrl }
					}
				]
			});
			ruleId = candidateRuleId;

			const response = await fetch(mediaUrl);
			if (!response.ok) throw new Error(`Could not download the selected media (HTTP ${response.status}).`);
			const file = await response.blob();
			const extension = getFileExtension(mediaUrl, file);
			await createApiClient(connection, connection.version).upload(file, `upload${extension}`, albumUuid, pageUrl);
			// Recent destinations describe successful uploads, rather than attempted uploads.
			// Cache writes may wait for a refresh; upload completion must not.
			void connections.rememberDestination(connection, albumUuid).catch(() => {});
			await notify(tabId, { type: 'uploadSuccess' });
		} catch (error) {
			await notify(tabId, { type: 'uploadError', data: getErrorMessage(error) });
		} finally {
			if (ruleId !== undefined) {
				await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => {});
			}
		}
	};

	browser.contextMenus.create({
		id: 'chibisafe',
		title: 'Upload to chibisafe',
		contexts: ['image', 'video', 'audio']
	});

	browser.runtime.onMessage.addListener(
		async (message: BackgroundMessage, sender): Promise<SettingsResult | undefined> => {
			// Options pages do not have a sender tab. Only content-tab actions require one.
			if (message.type === 'saveSettings') {
				try {
					return { ok: true, connection: await connections.save(message.data) };
				} catch (error) {
					return { ok: false, error: getErrorMessage(error) };
				}
			}
			if (message.type === 'openSettingsPage') {
				await browser.runtime.openOptionsPage();
				return;
			}
			const tabId = sender.tab?.id;
			if (tabId === undefined) return;
			switch (message.type) {
				case 'close':
					mediaUrls.delete(tabId);
					await notify(tabId, { type: 'unloadUI' });
					break;
				case 'getAlbums':
					try {
						return { ok: true, connection: await connections.refresh() };
					} catch (error) {
						return { ok: false, error: getErrorMessage(error) };
					}
				case 'upload':
					await upload(message.data.albumUuid, message.data.pageUrl, tabId);
					break;
			}
		}
	);

	browser.tabs.onRemoved.addListener(tabId => mediaUrls.delete(tabId));
	browser.contextMenus.onClicked.addListener(async (info, tab) => {
		if (info.menuItemId !== 'chibisafe' || !info.srcUrl || tab?.id === undefined) return;
		const { siteUrl, apiKey } = await browser.storage.local.get(['siteUrl', 'apiKey']);
		if (!siteUrl || !apiKey) {
			await browser.runtime.openOptionsPage();
			return;
		}
		mediaUrls.set(tab.id, info.srcUrl);
		await notify(tab.id, { type: 'loadUI' });
	});
});
