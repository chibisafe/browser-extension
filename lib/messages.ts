import type { Credentials } from './api';
import type { Connection } from './settings';

export type BackgroundMessage =
	| { type: 'saveSettings'; data: Credentials & { showRecentAlbums: boolean } }
	| { type: 'getAlbums' | 'openSettingsPage' | 'close' }
	| { type: 'upload'; data: { albumUuid?: string; pageUrl: string } };

export type ContentMessage =
	| { type: 'loadUI' | 'unloadUI' }
	| { type: 'uploadSuccess' }
	| { type: 'uploadError'; data: string };

export type SettingsResult = { ok: true; connection: Connection } | { ok: false; error: string };
