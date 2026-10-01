import type { Destination } from '@/lib/api';
import {
	ComboboxButton,
	ComboboxInput,
	ComboboxOption,
	ComboboxOptions,
	Combobox as ComboboxPrimitive
} from '@headlessui/react';
import clsx from 'clsx';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

export const Combobox = ({
	albums,
	portalRef,
	onChange,
	selected,
	destinationName
}: {
	albums: Destination[];
	portalRef: React.RefObject<HTMLDivElement | null>;
	onChange: (album: Destination, triggerUpload: boolean) => void;
	selected: Destination | null;
	destinationName: string;
}) => {
	const [query, setQuery] = useState('');
	const [hasUserPressedEnter, setHasUserPressedEnter] = useState(false);

	const handleSelect = (album: Destination, triggerUpload: boolean) => {
		onChange(album, triggerUpload || hasUserPressedEnter);
		setHasUserPressedEnter(false);
	};

	const filteredDestinations =
		query === ''
			? albums
			: albums.filter(album => {
					return album.name.toLowerCase().includes(query.toLowerCase());
				});

	// small hack to move the portal to the correct location since headlessui doesn't support portals apparently
	useEffect(() => {
		const movePortal = () => {
			const portal = document.getElementById('headlessui-portal-root');
			if (portal && portalRef.current) {
				portalRef.current.appendChild(portal);
			}
		};

		movePortal();

		const observer = new MutationObserver(movePortal);
		observer.observe(document.body, { childList: true, subtree: true });

		return () => observer.disconnect();
	}, [portalRef]);

	return (
		<ComboboxPrimitive
			value={selected}
			by="uuid"
			onChange={value => value && handleSelect(value, false)}
			onClose={() => setQuery('')}
		>
			<div className="relative">
				<ComboboxInput
					className={clsx(
						'w-full rounded-lg border-none bg-white/5 py-1.5 pr-8 pl-3 text-sm/6 text-white',
						'focus:not-data-focus:outline-none data-focus:outline-2 data-focus:-outline-offset-2 data-focus:outline-white/25'
					)}
					displayValue={(album: Destination) => album?.name}
					onChange={event => setQuery(event.target.value)}
					onKeyDown={event => {
						if (event.key === 'Enter' && selected) {
							handleSelect(selected, true);
							setHasUserPressedEnter(true);
						}
					}}
					placeholder={`Select ${destinationName === 'folders' ? 'a folder' : 'an album'}`}
					aria-label={`Select ${destinationName === 'folders' ? 'a folder' : 'an album'}`}
					autoFocus
				/>
				<ComboboxButton className="group absolute inset-y-0 right-0 px-2.5">
					<ChevronDownIcon className="size-4 fill-white/60 group-data-hover:fill-white" />
				</ComboboxButton>
			</div>

			<ComboboxOptions
				anchor="bottom"
				transition
				className={clsx(
					'w-(--input-width) rounded-xl border border-background bg-background p-1 [--anchor-gap:--spacing(1)] empty:invisible',
					'transition duration-100 ease-in data-leave:data-closed:opacity-0'
				)}
			>
				{filteredDestinations.map(album => (
					<ComboboxOption
						key={album.uuid}
						value={album}
						className="group flex cursor-default items-center gap-2 rounded-lg px-3 py-1.5 select-none data-focus:bg-white/10"
					>
						<CheckIcon className="invisible size-4 fill-white group-data-selected:visible" />
						<div className="text-sm/6 text-white">{album.name}</div>
					</ComboboxOption>
				))}
			</ComboboxOptions>
		</ComboboxPrimitive>
	);
};
