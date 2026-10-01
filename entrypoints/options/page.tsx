import Logo from '@/assets/logo.svg';
import { Panel } from '@/components/Panel';
import { Checkbox } from '@/components/ui/Checkbox';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/api';
import type { SettingsResult } from '@/lib/messages';
import { type Connection, readConnection } from '@/lib/settings';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

export default function Page() {
	const [siteUrl, setSiteUrl] = useState('');
	const [apiKey, setApiKey] = useState('');
	const [showRecentAlbums, setShowRecentAlbums] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [connection, setConnection] = useState<Connection>();
	const [error, setError] = useState<string>();
	const [status, setStatus] = useState<string>();
	const destinationName = connection?.version === '7' ? 'folders' : 'albums';

	const checkDetails = async () => {
		setIsLoading(true);
		setError(undefined);
		setStatus(undefined);
		try {
			const result: SettingsResult = await browser.runtime.sendMessage({
				type: 'saveSettings',
				data: { siteUrl, apiKey, showRecentAlbums }
			});
			if (!result.ok) throw new Error(result.error);
			setConnection(result.connection);
			setSiteUrl(result.connection.siteUrl);
			setApiKey(result.connection.apiKey);
			setStatus('Settings saved and connection verified.');
		} catch (error) {
			setError(getErrorMessage(error));
		} finally {
			setIsLoading(false);
		}
	};

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		await checkDetails();
	};

	useEffect(() => {
		browser.storage.local
			.get()
			.then(data => {
				setSiteUrl(typeof data.siteUrl === 'string' ? data.siteUrl : '');
				setApiKey(typeof data.apiKey === 'string' ? data.apiKey : '');
				setShowRecentAlbums(data.showRecentAlbums === true);
				setConnection(readConnection(data));
			})
			.catch(error => setError(getErrorMessage(error)));
	}, []);

	return (
		<div className="flex flex-col gap-8 justify-center items-center">
			<img src={Logo} alt="chibisafe logo" className="w-32" />
			<h1 className="font-inter text-2xl font-bold">chibisafe settings</h1>
			<p className="text-default text-base text-center">
				This chibisafe uploader is a tool that allows you to upload files to a chibisafe instance directly from your
				browser.
				<br />
				Make sure to set the instance URL and API key in the form below so that the extension can upload files and pull
				album or folder information from your chibisafe instance.
			</p>

			{connection && (
				<Panel title="Account information" className="flex flex-col gap-4">
					<div className="flex flex-col gap-4 text-sm">
						<p>
							Logged in as <span className="font-bold">{connection.username}</span>
						</p>
						<p>
							Number of {destinationName}: <span className="font-bold">{connection.albumCount}</span>
						</p>
						<p>
							Instance: <span className="font-bold">{connection.appVersion ?? `v${connection.version} API`}</span>
						</p>
						<Button variant="filled" onPress={checkDetails} isDisabled={isLoading}>
							Check details
						</Button>
					</div>
				</Panel>
			)}

			{error && (
				<p role="alert" className="text-red-400 text-sm max-w-xl">
					{error}
				</p>
			)}
			{status && <output className="text-default text-sm">{status}</output>}

			<form className="*:not-first:mt-2 w-full max-w-xl flex flex-col gap-4" onSubmit={handleSubmit}>
				<Panel title="Settings" className="flex flex-col gap-4">
					<TextField
						label="chibisafe instance URL"
						name="siteUrl"
						placeholder="https://your-chibisafe-instance.com"
						value={siteUrl}
						isRequired
						isDisabled={isLoading}
						onChange={setSiteUrl}
					/>
					<TextField
						label="chibisafe API key"
						name="apiKey"
						placeholder="API key"
						value={apiKey}
						isRequired
						isDisabled={isLoading}
						onChange={setApiKey}
					/>

					<Checkbox
						description={`Show recent ${destinationName} in the uploader popup for quick access`}
						label={`Show recent ${destinationName}`}
						isDisabled={isLoading}
						isSelected={showRecentAlbums}
						onChange={value => setShowRecentAlbums(value)}
					/>
				</Panel>
				<div className="flex flex-row justify-end">
					<Button variant="filled" type="submit" isPending={isLoading} isDisabled={isLoading}>
						Save
					</Button>
				</div>
			</form>
		</div>
	);
}
