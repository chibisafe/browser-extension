export type ApiVersion = '6' | '7';

export type Destination = {
	uuid: string;
	name: string;
};

export type Credentials = {
	siteUrl: string;
	apiKey: string;
};

export type Account = {
	uuid: string;
	username: string;
};

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

export function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeCredentials(credentials: Credentials): Credentials {
	let url: URL;
	try {
		url = new URL(credentials.siteUrl.trim());
	} catch {
		throw new Error('Enter a valid chibisafe instance URL.');
	}
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
		throw new Error('Use an HTTP or HTTPS instance URL without credentials, a query, or a fragment.');
	}
	const apiKey = credentials.apiKey.trim();
	if (!apiKey) throw new Error('Enter your chibisafe API key.');
	return { siteUrl: url.href.replace(/\/+$/, ''), apiKey };
}

async function request(url: string, init: RequestInit = {}, timeout = 15_000): Promise<Response> {
	try {
		return await fetch(url, { ...init, credentials: 'omit', signal: AbortSignal.timeout(timeout) });
	} catch (error) {
		if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
			throw new Error('The instance did not respond in time. Please try again.');
		}
		throw new Error('Could not reach the instance. Check its URL and your connection.');
	}
}

async function readJson(response: Response): Promise<unknown> {
	let data: unknown;
	try {
		data = await response.json();
	} catch {
		if (response.ok) throw new Error('The instance returned an unexpected response.');
	}
	if (!response.ok) {
		const message = isRecord(data) && typeof data.message === 'string' ? data.message : undefined;
		throw new ApiError(
			response.status === 401 || response.status === 403
				? 'The API key is invalid or does not have permission for this action.'
				: (message ?? `The instance returned HTTP ${response.status}. Please try again.`),
			response.status
		);
	}
	return data;
}

function parseAccount(data: unknown, version: ApiVersion): Account {
	const user = version === '6' && isRecord(data) ? data.user : data;
	if (!isRecord(user) || typeof user.uuid !== 'string' || typeof user.username !== 'string') {
		throw new Error('The instance returned unexpected account information.');
	}
	if (user.banned === true) throw new Error('This account is banned.');
	if (version === '7' && isRecord(user.permissions) && user.permissions.canUploadFiles === false) {
		throw new Error('This API key does not allow file uploads.');
	}
	return { uuid: user.uuid, username: user.username };
}

const adapters = {
	'6': {
		userPath: '/api/user/me',
		destinationsPath: '/api/albums',
		destinationsKey: 'albums',
		uploadPath: '/api/upload',
		fileField: 'file[]',
		destinationHeader: 'albumuuid',
		pagination: (offset: number) => `page=${Math.floor(offset / 1000) + 1}&limit=1000`
	},
	'7': {
		userPath: '/api/v1/users/me',
		destinationsPath: '/api/v1/folders',
		destinationsKey: 'results',
		uploadPath: '/api/v1/upload',
		fileField: 'file',
		destinationHeader: 'chibi-folder-uuid',
		pagination: (offset: number) => `offset=${offset}&limit=1000`
	}
} satisfies Record<ApiVersion, object>;

export function createApiClient(credentials: Credentials, version: ApiVersion) {
	const adapter = adapters[version];
	const headers = { 'X-API-Key': credentials.apiKey };
	const get = async (path: string) => readJson(await request(`${credentials.siteUrl}${path}`, { headers }));

	return {
		async getAccount(): Promise<Account> {
			return parseAccount(await get(adapter.userPath), version);
		},
		async listDestinations(): Promise<{ destinations: Destination[]; count: number }> {
			const destinations: Destination[] = [];
			const seen = new Set<string>();
			let offset = 0;
			let count = 0;
			do {
				const data = await get(`${adapter.destinationsPath}?${adapter.pagination(offset)}`);
				if (!isRecord(data) || typeof data.count !== 'number' || !Number.isInteger(data.count) || data.count < 0) {
					throw new Error('The instance returned an unexpected destination list.');
				}
				const page = data[adapter.destinationsKey];
				if (!Array.isArray(page)) throw new Error('The instance returned an unexpected destination list.');
				count = data.count;
				const previousSize = seen.size;
				for (const item of page) {
					if (!isRecord(item) || typeof item.uuid !== 'string' || typeof item.name !== 'string') {
						throw new Error('The instance returned an unexpected destination list.');
					}
					if (!seen.has(item.uuid)) destinations.push({ uuid: item.uuid, name: item.name });
					seen.add(item.uuid);
				}
				// v6 pages advance by the requested limit; v7 uses the number of returned rows.
				offset += version === '6' ? 1000 : page.length;
				if (offset < count && seen.size === previousSize) {
					throw new Error('The instance returned an incomplete destination list. Please refresh it.');
				}
			} while (offset < count);
			return { destinations, count };
		},
		async upload(file: Blob, filename: string, destinationUuid?: string, source?: string): Promise<void> {
			const body = new FormData();
			if (version === '7' && source) body.append('source', source);
			body.append(adapter.fileField, file, filename);
			const response = await request(
				`${credentials.siteUrl}${adapter.uploadPath}`,
				{
					method: 'POST',
					headers: {
						...headers,
						...(destinationUuid && { [adapter.destinationHeader]: destinationUuid }),
						...(version === '6' && source && { 'x-source-url': source })
					},
					body
				},
				300_000
			);
			if (version === '6' && response.status === 204) return;
			const data = await readJson(response);
			if (
				!isRecord(data) ||
				(version === '6'
					? typeof data.url !== 'string'
					: typeof data.uuid !== 'string' || typeof data.identifier !== 'string' || typeof data.filename !== 'string')
			) {
				throw new Error('The upload returned an unexpected response. Check your instance before retrying.');
			}
		}
	};
}

export async function detectConnection(credentials: Credentials): Promise<{
	version: ApiVersion;
	appVersion?: string;
	account: Account;
}> {
	const response = await request(`${credentials.siteUrl}/api/version`);
	// Some reverse proxies serve the frontend HTML for an unknown API route.
	const missing =
		[404, 405].includes(response.status) ||
		(response.ok && response.headers.get('content-type')?.includes('text/html'));
	if (missing) {
		return { version: '7', account: await createApiClient(credentials, '7').getAccount() };
	}
	const data = await readJson(response);
	if (!isRecord(data) || typeof data.version !== 'string') {
		throw new Error('The instance returned an unexpected version response.');
	}
	if (!/^v?6(?:\.|$)/.test(data.version)) {
		throw new Error(`Unsupported chibisafe version: ${data.version}. This extension supports v6 and v7.`);
	}
	return { version: '6', appVersion: data.version, account: await createApiClient(credentials, '6').getAccount() };
}
