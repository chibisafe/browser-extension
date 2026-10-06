import {
	ApiError,
	type ApiVersion,
	type Credentials,
	type Destination,
	createApiClient,
	detectConnection,
	normalizeCredentials
} from './api';

export type Connection = Credentials & {
	version: ApiVersion;
	userUuid: string;
	username: string;
	appVersion?: string;
	albumCount: number;
	showRecentAlbums: boolean;
};

export interface SettingsStorage {
	get(keys: string[]): Promise<Record<string, unknown>>;
	set(items: Record<string, unknown>): Promise<void>;
}

const connectionKeys = [
	'siteUrl',
	'apiKey',
	'version',
	'userUuid',
	'username',
	'appVersion',
	'albumCount',
	'showRecentAlbums'
];

export function readConnection(data: Record<string, unknown>): Connection | undefined {
	if (
		typeof data.siteUrl !== 'string' ||
		!data.siteUrl ||
		typeof data.apiKey !== 'string' ||
		!data.apiKey ||
		(data.version !== '6' && data.version !== '7') ||
		typeof data.userUuid !== 'string' ||
		typeof data.username !== 'string' ||
		typeof data.albumCount !== 'number'
	)
		return;
	return {
		siteUrl: data.siteUrl,
		apiKey: data.apiKey,
		version: data.version,
		userUuid: data.userUuid,
		username: data.username,
		appVersion: typeof data.appVersion === 'string' ? data.appVersion : undefined,
		albumCount: data.albumCount,
		showRecentAlbums: data.showRecentAlbums === true
	};
}

export class ConnectionManager {
	private pending: Promise<unknown> = Promise.resolve();

	constructor(private readonly storage: SettingsStorage) {}

	// Keep settings saves and cache refreshes ordered, including messages from different tabs.
	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.pending.then(operation, operation);
		this.pending = result.catch(() => {});
		return result;
	}

	private async persist(connection: Connection, albums: Destination[]): Promise<void> {
		const previous = await this.storage.get(connectionKeys);
		const changedAccount =
			previous.siteUrl !== connection.siteUrl ||
			(previous.userUuid ? previous.userUuid !== connection.userUuid : previous.apiKey !== connection.apiKey) ||
			previous.version !== connection.version;
		await this.storage.set({
			...connection,
			appVersion: connection.appVersion ?? null,
			albums,
			...(changedAccount && { recentAlbums: [] })
		});
	}

	private async validateAndSave(input: Credentials & { showRecentAlbums: boolean }): Promise<Connection> {
		const credentials = normalizeCredentials(input);
		const { version, appVersion, account } = await detectConnection(credentials);
		const { destinations, count } = await createApiClient(credentials, version).listDestinations();
		const connection: Connection = {
			...credentials,
			version,
			appVersion,
			userUuid: account.uuid,
			username: account.username,
			albumCount: count,
			showRecentAlbums: input.showRecentAlbums
		};
		await this.persist(connection, destinations);
		return connection;
	}

	private async load(): Promise<Connection> {
		const data = await this.storage.get(connectionKeys);
		const connection = readConnection(data);
		if (connection) return connection;
		if (typeof data.siteUrl !== 'string' || !data.siteUrl || typeof data.apiKey !== 'string' || !data.apiKey) {
			throw new Error('Set your chibisafe instance URL and API key in settings first.');
		}
		// Older installations may have no version, or a version selected by the old heuristic.
		return this.validateAndSave({
			siteUrl: data.siteUrl,
			apiKey: data.apiKey,
			showRecentAlbums: data.showRecentAlbums === true
		});
	}

	save(input: Credentials & { showRecentAlbums: boolean }): Promise<Connection> {
		return this.enqueue(() => this.validateAndSave(input));
	}

	async get(): Promise<Connection> {
		// Uploads use the last validated settings without waiting for folder refreshes.
		const connection = readConnection(await this.storage.get(connectionKeys));
		if (connection) return connection;
		// Initial validation and legacy migration still run with the other writes.
		return this.enqueue(() => this.load());
	}

	rememberDestination(connection: Connection, destinationUuid?: string): Promise<void> {
		return this.enqueue(async () => {
			if (!destinationUuid) return;
			const data = await this.storage.get([...connectionKeys, 'albums', 'recentAlbums']);
			const current = readConnection(data);
			if (
				!current ||
				current.siteUrl !== connection.siteUrl ||
				current.userUuid !== connection.userUuid ||
				current.version !== connection.version
			)
				return;
			const albums = data.albums as Destination[] | undefined;
			const destination = albums?.find(album => album.uuid === destinationUuid);
			if (!destination) return;
			const recent = (data.recentAlbums as Destination[] | undefined) ?? [];
			await this.storage.set({
				recentAlbums: [destination, ...recent.filter(album => album.uuid !== destinationUuid)].slice(0, 5)
			});
		});
	}

	refresh(): Promise<Connection> {
		return this.enqueue(async () => {
			const connection = await this.load();
			const client = createApiClient(connection, connection.version);
			try {
				const account = await client.getAccount();
				const { destinations, count } = await client.listDestinations();
				const updated = { ...connection, userUuid: account.uuid, username: account.username, albumCount: count };
				await this.persist(updated, destinations);
				return updated;
			} catch (error) {
				// Recheck once when a read endpoint disappears after an instance upgrade.
				if (!(error instanceof ApiError) || ![404, 405].includes(error.status)) throw error;
				return this.validateAndSave(connection);
			}
		});
	}
}
