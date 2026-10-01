import { Combobox } from '@/components/ui/Combobox';
import { Button } from '@/components/ui/button';
import { type ApiVersion, type Destination, getErrorMessage } from '@/lib/api';
import type { ContentMessage, SettingsResult } from '@/lib/messages';
import { enableShadowDOM } from '@react-stately/flags';
import { Settings2Icon, XIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { browser } from 'wxt/browser';

type Album = Destination;

export default function App() {
	enableShadowDOM();
	const [albums, setAlbums] = useState<Album[]>([]);
	const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isClosing, setIsClosing] = useState(false);
	const [showRecentAlbums, setShowRecentAlbums] = useState<boolean>(false);
	const [recentAlbums, setRecentAlbums] = useState<Album[]>([]);

	const [version, setVersion] = useState<ApiVersion>('6');
	const [isRefreshing, setIsRefreshing] = useState(true);
	const destinationName = version === '7' ? 'folders' : 'albums';
	const portalRef = useRef<HTMLDivElement>(null);

	const handleClose = useCallback(
		({ fromKey = false }: { fromKey?: boolean } = {}) => {
			if (fromKey && (isLoading || isClosing)) return;
			setIsClosing(true);
			setIsLoading(false);
			setSelectedAlbum(null);
			toast.dismiss('toast-upload-success');
			toast.dismiss('toast-upload-error');
			toast.dismiss('toast-uploading');
			portalRef.current?.remove();
			browser.runtime.sendMessage({ type: 'close' });
		},
		[isLoading, isClosing]
	);

	const handleRefreshAlbums = useCallback(async () => {
		const { albums, version, showRecentAlbums, recentAlbums } = await browser.storage.local.get([
			'albums',
			'version',
			'showRecentAlbums',
			'recentAlbums'
		]);
		const destinations: Album[] = albums ?? [];
		setAlbums(destinations);
		setSelectedAlbum(selected => (selected && destinations.find(album => album.uuid === selected.uuid)) || null);
		setVersion(version === '7' ? '7' : '6');
		setShowRecentAlbums(showRecentAlbums === true);
		setRecentAlbums(
			(recentAlbums ?? []).filter((album: Album) => destinations.some(destination => destination.uuid === album.uuid))
		);
	}, []);

	const requestAlbums = useCallback(async () => {
		setIsRefreshing(true);
		try {
			const result: SettingsResult = await browser.runtime.sendMessage({ type: 'getAlbums' });
			if (!result.ok) throw new Error(result.error);
			await handleRefreshAlbums();
		} catch (error) {
			toast.error(getErrorMessage(error));
		} finally {
			setIsRefreshing(false);
		}
	}, [handleRefreshAlbums]);

	const handleUpload = useCallback(
		(album?: Album) => {
			setIsLoading(true);
			browser.runtime.sendMessage({
				type: 'upload',
				data: {
					albumUuid: album?.uuid ?? selectedAlbum?.uuid,
					pageUrl: window.location.href
				}
			});

			toast.loading('Uploading…', {
				id: 'toast-uploading'
			});
		},
		[selectedAlbum]
	);

	const handleSelectAlbum = useCallback(
		(album: Album, triggerUpload: boolean) => {
			setSelectedAlbum(album);
			if (triggerUpload && !isRefreshing) handleUpload(album);
		},
		[handleUpload, isRefreshing]
	);

	useEffect(() => {
		const handleMessage = (message: ContentMessage) => {
			switch (message.type) {
				case 'uploadSuccess':
				case 'uploadError':
					setIsClosing(true);
					setIsLoading(false);
					toast.dismiss('toast-uploading');
					if (message.type === 'uploadSuccess') {
						toast.success('Uploaded to chibisafe', { id: 'toast-upload-success', onDismiss: () => handleClose() });
					} else {
						toast.error('Error uploading to chibisafe', {
							id: 'toast-upload-error',
							description: message.data,
							onDismiss: () => handleClose()
						});
					}
					break;
			}
		};
		browser.runtime.onMessage.addListener(handleMessage);
		return () => browser.runtime.onMessage.removeListener(handleMessage);
	}, [handleClose]);

	useEffect(() => {
		void handleRefreshAlbums();
		void requestAlbums();
	}, [handleRefreshAlbums, requestAlbums]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				handleClose({ fromKey: true });
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [handleClose]);

	return (
		<>
			<Toaster position="bottom-right" richColors theme="dark" className="fixed z-[2147483647] bottom-4 right-4" />
			{!isLoading && !isClosing && (
				<div
					className="fixed z-[2147483647] top-0 left-0 flex flex-col items-center justify-center w-full h-full bg-background/90 text-foreground font-sans gap-4"
					id="chibisafe-ui"
				>
					<div className="flex flex-col gap-4 max-w-3xl">
						<div className="card">
							<div className="p-4 flex flex-col gap-4">
								<div className="flex justify-between">
									<h2 className="text-highlight font-bold text-xl flex items-center">chibisafe uploader</h2>
									<div className="flex gap-2">
										<Button
											variant="discreet"
											size="icon"
											aria-label="Settings"
											onPress={() => browser.runtime.sendMessage({ type: 'openSettingsPage' })}
										>
											<Settings2Icon size={16} aria-hidden="true" />
										</Button>
										<Button variant="discreet" size="icon" aria-label="Close" onPress={() => handleClose()}>
											<XIcon size={32} aria-hidden="true" />
										</Button>
									</div>
								</div>

								<p className="text-default text-sm">
									Select {version === '7' ? 'a folder' : 'an album'} for your upload or leave empty to upload without
									one. <br />
									The popup will close and upload will continue in the background.
								</p>

								{showRecentAlbums && recentAlbums.length ? (
									<div className="flex flex-col gap-2">
										<p className="text-default text-sm">
											Or upload directly to one of the recent {destinationName} you used.
										</p>
										<ul className="list-none pl-4 text-sm">
											{recentAlbums.map(album => (
												// biome-ignore lint/a11y/useKeyWithClickEvents: <explanation>
												<li
													key={album.uuid}
													className="text-default hover:text-highlight cursor-pointer"
													onClick={() => handleSelectAlbum(album, true)}
												>
													- {album.name}
												</li>
											))}
										</ul>
									</div>
								) : null}
								<div className="flex flex-row gap-4" ref={portalRef}>
									{albums.length ? (
										<Combobox
											portalRef={portalRef}
											albums={albums}
											selected={selectedAlbum}
											onChange={handleSelectAlbum}
											destinationName={destinationName}
										/>
									) : (
										<div className="flex items-center justify-center bg-background px-8">
											<p className="text-default text-sm">No {destinationName} found</p>
										</div>
									)}
									<Button variant="discreet" onPress={requestAlbums} isDisabled={isRefreshing} isPending={isRefreshing}>
										Refresh {destinationName}
									</Button>
									<div className="flex-1" />
									<Button variant="filled" onPress={() => handleUpload()} isDisabled={isRefreshing}>
										Upload
									</Button>
								</div>
							</div>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
