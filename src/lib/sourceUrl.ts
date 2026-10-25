// Tofu (new file, 2026-10-25): AGPL-3.0 section 13 asks a changed copy that people use over a network to offer them
// its source code. PUBLIC_SOURCE_URL says where this copy's source is; Tofu's app gallery sets it to the exact commit the
// copy was made from. Unset (or not a web address), the links open Tofu's fork of Cactoide, on its `tofu` branch.
import { env } from '$env/dynamic/public';

const FORK_SOURCE_URL = 'https://github.com/tofu-gallery/cactoide/tree/tofu';

export function sourceUrl(): string {
	const url = env.PUBLIC_SOURCE_URL?.trim();
	return url && /^https?:\/\//i.test(url) ? url : FORK_SOURCE_URL;
}
