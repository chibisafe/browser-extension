import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { type ApiVersion, createApiClient, detectConnection, normalizeCredentials } from '../lib/api';
import { type Connection, ConnectionManager, type SettingsStorage } from '../lib/settings';

const credentials = { siteUrl: 'https://safe.example', apiKey: 'test-key' };
const account = { uuid: 'user-1', username: 'senchou', permissions: { canUploadFiles: true } };
const destinations = [{ uuid: 'destination-1', name: 'Art' }];
const uploadResult = { uuid: 'file-1', identifier: 'abc', filename: 'abc.png' };

let respond: (url: URL, init: RequestInit) => Response | Promise<Response>;
let requests: { url: URL; init: RequestInit }[];
const originalFetch = globalThis.fetch;

beforeEach(() => {
	requests = [];
	respond = url => {
		throw new Error(`Unexpected request: ${url.pathname}`);
	};
	const fetchMock = Object.assign(
		async (input: RequestInfo | URL, init: RequestInit = {}) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			requests.push({ url, init });
			return respond(url, init);
		},
		{ preconnect: originalFetch.preconnect }
	);
	spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function serve(version: ApiVersion, user = account) {
	respond = url => {
		if (url.pathname === '/api/version')
			return version === '6'
				? Response.json({ version: '6.5.5' })
				: Response.json({ message: 'Not found' }, { status: 404 });
		if (url.pathname === '/api/user/me') return Response.json({ user });
		if (url.pathname === '/api/v1/users/me') return Response.json(user);
		if (url.pathname === '/api/albums') return Response.json({ albums: destinations, count: 1 });
		if (url.pathname === '/api/v1/folders') return Response.json({ results: destinations, count: 1 });
		throw new Error(`Unexpected request: ${url.pathname}`);
	};
}

class MemoryStorage implements SettingsStorage {
	writes: Record<string, unknown>[] = [];
	constructor(public data: Record<string, unknown> = {}) {}
	async get(keys: string[]) {
		return Object.fromEntries(keys.map(key => [key, this.data[key]]));
	}
	async set(items: Record<string, unknown>) {
		this.writes.push(items);
		Object.assign(this.data, items);
	}
}

const saved: Connection = {
	...credentials,
	version: '6',
	userUuid: account.uuid,
	username: account.username,
	appVersion: '6.5.5',
	albumCount: 1,
	showRecentAlbums: true
};

describe('connection detection', () => {
	test.each(['6.0.0', '6.5.5', 'v6.9.0-beta.1'])('recognizes v6 revision %s and validates its key', async version => {
		respond = url => (url.pathname === '/api/version' ? Response.json({ version }) : Response.json({ user: account }));
		expect(await detectConnection(credentials)).toEqual({
			version: '6',
			appVersion: version,
			account: { uuid: account.uuid, username: account.username }
		});
		expect(requests.map(request => request.url.pathname)).toEqual(['/api/version', '/api/user/me']);
		expect(requests[0].init.headers).toBeUndefined();
		expect(new Headers(requests[1].init.headers).get('X-API-Key')).toBe(credentials.apiKey);
		expect(requests[1].init.credentials).toBe('omit');
	});

	test('confirms v7 using its authenticated account endpoint', async () => {
		serve('7');
		expect((await detectConnection(credentials)).version).toBe('7');
		expect(requests.map(request => request.url.pathname)).toEqual(['/api/version', '/api/v1/users/me']);
	});

	test('handles an HTML frontend fallback without treating it as v6', async () => {
		respond = url =>
			url.pathname === '/api/version'
				? new Response('<html></html>', { headers: { 'content-type': 'text/html' } })
				: Response.json(account);
		expect((await detectConnection(credentials)).version).toBe('7');
	});

	test.each([401, 403, 500, 503])('does not classify HTTP %s failures as v7', async status => {
		respond = () => Response.json({ message: 'Unavailable' }, { status });
		await expect(detectConnection(credentials)).rejects.toThrow();
		expect(requests).toHaveLength(1);
	});

	test.each([{ message: 'Hello' }, { version: '5.0.0' }, { version: '8.0.0' }])(
		'rejects unexpected or unsupported version data %j',
		async data => {
			respond = () => Response.json(data);
			await expect(detectConnection(credentials)).rejects.toThrow();
			expect(requests).toHaveLength(1);
		}
	);

	test('rejects a non-chibisafe response at the v7 probe', async () => {
		respond = url =>
			url.pathname === '/api/version' ? new Response(null, { status: 404 }) : Response.json({ message: 'Hello' });
		await expect(detectConnection(credentials)).rejects.toThrow('unexpected account');
	});

	test('reports an invalid v7 key without saving a classification', async () => {
		respond = url => new Response(null, { status: url.pathname === '/api/version' ? 404 : 401 });
		await expect(detectConnection(credentials)).rejects.toThrow('API key');
	});

	test('reports timeouts without probing another API', async () => {
		respond = () => {
			throw new DOMException('Timed out', 'TimeoutError');
		};
		await expect(detectConnection(credentials)).rejects.toThrow('in time');
		expect(requests).toHaveLength(1);
	});

	test('rejects a key without upload permission', async () => {
		serve('7', { ...account, permissions: { canUploadFiles: false } });
		await expect(detectConnection(credentials)).rejects.toThrow('does not allow file uploads');
	});

	test('normalizes trailing slashes and trims the key while preserving base paths', () => {
		expect(normalizeCredentials({ siteUrl: ' https://safe.example/chibi/// ', apiKey: ' key ' })).toEqual({
			siteUrl: 'https://safe.example/chibi',
			apiKey: 'key'
		});
	});

	test.each([
		'invalid',
		'ftp://safe.example',
		'https://user:pass@safe.example',
		'https://safe.example?key=secret',
		'https://safe.example/#dashboard'
	])('rejects invalid instance URL %s', siteUrl => {
		expect(() => normalizeCredentials({ ...credentials, siteUrl })).toThrow();
	});
});

describe('destination pagination', () => {
	test.each(['6', '7'] as const)('loads more than 1,000 destinations on v%s', async version => {
		const firstPage = Array.from({ length: 1000 }, (_, index) => ({
			uuid: `destination-${index}`,
			name: `Art ${index}`
		}));
		respond = url => {
			const isFirst = version === '6' ? url.searchParams.get('page') === '1' : url.searchParams.get('offset') === '0';
			return Response.json({
				[version === '6' ? 'albums' : 'results']: isFirst ? firstPage : [{ uuid: 'last', name: 'Last' }],
				count: 1001
			});
		};
		const result = await createApiClient(credentials, version).listDestinations();
		expect(result.destinations).toHaveLength(1001);
		expect(result.destinations.at(-1)?.uuid).toBe('last');
		expect(requests[1].url.searchParams.get(version === '6' ? 'page' : 'offset')).toBe(version === '6' ? '2' : '1000');
	});

	test('accepts an account with no destinations', async () => {
		respond = () => Response.json({ results: [], count: 0 });
		expect(await createApiClient(credentials, '7').listDestinations()).toEqual({ destinations: [], count: 0 });
	});

	test('rejects pagination that stops making progress', async () => {
		respond = () => Response.json({ results: destinations, count: 1001 });
		await expect(createApiClient(credentials, '7').listDestinations()).rejects.toThrow('incomplete');
		expect(requests).toHaveLength(2);
	});
});

describe('upload contracts', () => {
	const file = new Blob(['media'], { type: 'image/png' });
	const source = 'https://www.pixiv.net/artworks/123456';

	test('preserves v6 multipart and source headers', async () => {
		respond = () => Response.json({ uuid: 'file-1', name: 'upload.png', url: 'https://safe.example/file.png' });
		await createApiClient(credentials, '6').upload(file, 'upload.png', 'album-1', source);
		const { url, init } = requests[0];
		expect(url.pathname).toBe('/api/upload');
		expect(new Headers(init.headers).get('albumuuid')).toBe('album-1');
		expect(new Headers(init.headers).get('x-source-url')).toBe(source);
		expect(init.body).toBeInstanceOf(FormData);
		const body = init.body as FormData;
		expect((body.get('file[]') as File).name).toBe('upload.png');
		expect(body.has('source')).toBe(false);
		expect(body.has('file')).toBe(false);
	});

	test.each([200, 201])('sends v7 source before file and accepts HTTP %s', async status => {
		respond = () => Response.json(uploadResult, { status });
		await createApiClient(credentials, '7').upload(file, 'upload.png', 'folder-1', source);
		const { url, init } = requests[0];
		expect(url.pathname).toBe('/api/v1/upload');
		const headers = new Headers(init.headers);
		expect(headers.get('chibi-folder-uuid')).toBe('folder-1');
		expect(headers.has('albumuuid')).toBe(false);
		expect(headers.has('x-source-url')).toBe(false);
		expect(headers.has('content-type')).toBe(false);
		const body = init.body as FormData;
		expect([...body.keys()]).toEqual(['source', 'file']);
		expect(body.get('source')).toBe(source);
		expect((body.get('file') as File).name).toBe('upload.png');
		expect(await (body.get('file') as File).text()).toBe('media');
	});

	test.each(['6', '7'] as const)('uploads without a destination on v%s', async version => {
		respond = () => Response.json(version === '6' ? { url: 'https://safe.example/file.png' } : uploadResult);
		await createApiClient(credentials, version).upload(file, 'upload.png', undefined, source);
		const headers = new Headers(requests[0].init.headers);
		expect(headers.has('albumuuid')).toBe(false);
		expect(headers.has('chibi-folder-uuid')).toBe(false);
	});

	test('keeps v6 empty success responses working', async () => {
		respond = () => new Response(null, { status: 204 });
		await createApiClient(credentials, '6').upload(file, 'upload.png');
	});

	test.each([400, 401, 404, 413, 500])('rejects HTTP %s upload errors without retrying', async status => {
		respond = () => Response.json({ message: 'Upload failed' }, { status });
		await expect(createApiClient(credentials, '7').upload(file, 'upload.png')).rejects.toThrow();
		expect(requests).toHaveLength(1);
	});
});

describe('saved settings and cache ownership', () => {
	test('validates everything before writing the complete configuration once', async () => {
		serve('7');
		const storage = new MemoryStorage({ ...saved, albums: destinations, recentAlbums: destinations });
		const result = await new ConnectionManager(storage).save({ ...credentials, showRecentAlbums: true });
		expect(result.version).toBe('7');
		expect(storage.writes).toHaveLength(1);
		expect(storage.data).toMatchObject({
			version: '7',
			userUuid: account.uuid,
			albums: destinations,
			recentAlbums: [],
			appVersion: null
		});
	});

	test('preserves a working configuration and its caches when new details fail', async () => {
		respond = () => Response.json({ message: 'Unavailable' }, { status: 500 });
		const previous = { ...saved, albums: destinations, recentAlbums: destinations };
		const storage = new MemoryStorage({ ...previous });
		await expect(
			new ConnectionManager(storage).save({
				siteUrl: 'https://other.example',
				apiKey: 'new-key',
				showRecentAlbums: false
			})
		).rejects.toThrow();
		expect(storage.writes).toHaveLength(0);
		expect(storage.data).toEqual(previous);
	});

	test('preserves settings when destination validation fails after authentication', async () => {
		serve('7');
		const handler = respond;
		respond = (url, init) =>
			url.pathname === '/api/v1/folders'
				? Response.json({ message: 'Unavailable' }, { status: 503 })
				: handler(url, init);
		const storage = new MemoryStorage({ ...saved });
		await expect(new ConnectionManager(storage).save({ ...credentials, showRecentAlbums: false })).rejects.toThrow();
		expect(storage.writes).toHaveLength(0);
	});

	test('keeps recents when rotating a key for the same account', async () => {
		serve('6');
		const storage = new MemoryStorage({ ...saved, recentAlbums: destinations });
		await new ConnectionManager(storage).save({ ...credentials, apiKey: 'rotated-key', showRecentAlbums: true });
		expect(storage.data.recentAlbums).toEqual(destinations);
	});

	test.each(['instance', 'account'])('clears recents when the %s changes', async change => {
		serve('6', change === 'account' ? { ...account, uuid: 'user-2' } : account);
		const storage = new MemoryStorage({ ...saved, recentAlbums: destinations });
		await new ConnectionManager(storage).save({
			...credentials,
			siteUrl: change === 'instance' ? 'https://other.example' : credentials.siteUrl,
			showRecentAlbums: true
		});
		expect(storage.data.recentAlbums).toEqual([]);
	});

	test('migrates old settings even if their stored version was incorrect', async () => {
		serve('7');
		const storage = new MemoryStorage({
			...credentials,
			version: '6',
			showRecentAlbums: true,
			recentAlbums: destinations
		});
		expect((await new ConnectionManager(storage).get()).version).toBe('7');
		expect(storage.data.albums).toEqual(destinations);
		expect(storage.data.recentAlbums).toEqual([]);
	});

	test('redetects an instance upgrade when a saved read endpoint disappears', async () => {
		serve('7');
		const handler = respond;
		respond = (url, init) =>
			url.pathname === '/api/user/me' ? new Response(null, { status: 404 }) : handler(url, init);
		const storage = new MemoryStorage({ ...saved, recentAlbums: destinations });
		expect((await new ConnectionManager(storage).refresh()).version).toBe('7');
		expect(requests.map(request => request.url.pathname)).toEqual([
			'/api/user/me',
			'/api/version',
			'/api/v1/users/me',
			'/api/v1/folders'
		]);
	});

	test('keeps the saved generation when a refresh fails with a server error', async () => {
		respond = () => new Response(null, { status: 500 });
		const storage = new MemoryStorage({ ...saved });
		await expect(new ConnectionManager(storage).refresh()).rejects.toThrow();
		expect(storage.data.version).toBe('6');
		expect(storage.writes).toHaveLength(0);
		expect(requests).toHaveLength(1);
	});

	test('orders a new settings save after an in-flight refresh', async () => {
		serve('6');
		const handler = respond;
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		respond = async (url, init) => {
			if (requests.length === 1) {
				started.resolve();
				await release.promise;
			}
			return handler(url, init);
		};
		const storage = new MemoryStorage({ ...saved });
		const manager = new ConnectionManager(storage);
		const refresh = manager.refresh();
		await started.promise;
		const save = manager.save({ ...credentials, siteUrl: 'https://other.example', showRecentAlbums: false });
		expect(storage.writes).toHaveLength(0);
		release.resolve();
		await Promise.all([refresh, save]);
		expect(storage.data.siteUrl).toBe('https://other.example');
		expect(storage.data.showRecentAlbums).toBe(false);
	});
});
