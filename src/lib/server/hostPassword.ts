// Tofu (new file, 2026-10-25): an optional host password, so the owner of a copy can keep event creation to their own
// hosts (see TOFU.md). HOST_PASSWORD is a hidden setting. Unset, the default, anyone who opens the site can create
// events, as upstream. Set, /create asks for it once per browser; guests still open, RSVP to and leave events without it.
//
// A browser that typed the password keeps a pass cookie: an HMAC of a fixed label keyed by the password, so the cookie
// never carries the password itself, and changing HOST_PASSWORD ends every pass at once.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const PASS_COOKIE = 'cactoideHostPass';
const PASS_MAX_AGE = 60 * 60 * 24 * 400; // the same bound the app gives its own cookie

/** The host password, or null while none is set (leading and trailing spaces are ignored). */
export function hostPassword(): string | null {
	const value = env.HOST_PASSWORD?.trim();
	return value ? value : null;
}

const passFor = (password: string) =>
	createHmac('sha256', password).update('cactoide host pass v1').digest('hex');

// Compares digests, so neither the length nor the content of the secret side shows in the time it takes.
const same = (a: string, b: string) =>
	timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/** Whether this browser may create events: always while no host password is set. */
export function mayCreateEvents(cookies: Cookies): boolean {
	const password = hostPassword();
	if (!password) return true;
	const held = cookies.get(PASS_COOKIE);
	return typeof held === 'string' && same(held, passFor(password));
}

/**
 * Checks a typed host password and, when it matches, gives this browser its pass. A wrong one answers only after a
 * second, which slows down guessing.
 */
export async function unlockHost(cookies: Cookies, typed: string): Promise<boolean> {
	const password = hostPassword();
	if (!password) return true;
	if (!same(typed.trim(), password)) {
		await new Promise((resolve) => setTimeout(resolve, 1000));
		return false;
	}
	cookies.set(PASS_COOKIE, passFor(password), {
		path: '/',
		maxAge: PASS_MAX_AGE,
		httpOnly: true,
		sameSite: 'lax'
	});
	return true;
}
