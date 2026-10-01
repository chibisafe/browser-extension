import { expect, test } from 'bun:test';
import { createApiClient } from '../lib/api';

test.each(['6', '7'] as const)('serializes the v%s upload contract over HTTP', async version => {
	let received: { path: string; headers: Headers; body: FormData } | undefined;
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		async fetch(request) {
			received = { path: new URL(request.url).pathname, headers: request.headers, body: await request.formData() };
			return Response.json(
				version === '6'
					? { url: 'https://safe.example/file.png' }
					: { uuid: 'file-1', identifier: 'abc', filename: 'abc.png' },
				{ status: version === '6' ? 200 : 201 }
			);
		}
	});
	try {
		const source = 'https://www.pixiv.net/artworks/123456';
		await createApiClient({ siteUrl: server.url.origin, apiKey: 'key' }, version).upload(
			new Blob(['image'], { type: 'image/png' }),
			'art.png',
			'destination-1',
			source
		);
		expect(received?.path).toBe(version === '6' ? '/api/upload' : '/api/v1/upload');
		expect(received?.headers.get('X-API-Key')).toBe('key');
		expect(received?.headers.get(version === '6' ? 'albumuuid' : 'chibi-folder-uuid')).toBe('destination-1');
		expect(received?.headers.get('content-type')).toContain('multipart/form-data; boundary=');
		expect(version === '6' ? received?.headers.get('x-source-url') : received?.body.get('source')).toBe(source);
		const file = received?.body.get(version === '6' ? 'file[]' : 'file') as File;
		expect(file.name).toBe('art.png');
		expect(await file.text()).toBe('image');
	} finally {
		await server.stop(true);
	}
});
