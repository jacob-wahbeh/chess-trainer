// "Log in with Lichess" via OAuth 2 + PKCE. Lichess accepts any client_id without registering an app, and
// no scopes are requested: the token only proves identity, which the masters explorer requires.

export interface LichessAuth {
	token: string;
	username: string;
}

const CLIENT_ID = 'openings-trainer';
const PENDING_KEY = 'chess-trainer/lichess-oauth';
const redirectUri = () => `${location.origin}/lichess`;

const base64url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');

/** PKCE needs crypto.subtle, which browsers only expose on https:// and localhost. */
export const canUseOAuth = () => typeof crypto !== 'undefined' && !!crypto.subtle;

export async function startLichessLogin() {
	const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
	const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
	const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
	sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state }));
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: CLIENT_ID,
		redirect_uri: redirectUri(),
		code_challenge_method: 'S256',
		code_challenge: challenge,
		state
	});
	location.assign(`https://lichess.org/oauth?${params}`);
}

/** Completes the login on the redirect page (/lichess?code=...&state=...). */
export async function finishLichessLogin(url: URL): Promise<LichessAuth> {
	const error = url.searchParams.get('error');
	if (error) throw new Error(url.searchParams.get('error_description') ?? error);
	const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null') as { verifier: string; state: string } | null;
	sessionStorage.removeItem(PENDING_KEY);
	if (!pending || pending.state !== url.searchParams.get('state')) throw new Error('The login link expired. Please try again.');
	const res = await fetch('https://lichess.org/api/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code: url.searchParams.get('code') ?? '',
			code_verifier: pending.verifier,
			redirect_uri: redirectUri(),
			client_id: CLIENT_ID
		})
	});
	if (!res.ok) throw new Error(`Lichess login failed (HTTP ${res.status})`);
	const { access_token: token } = (await res.json()) as { access_token: string };
	return { token, username: await lichessUsername(token) };
}

/** Validates a token (OAuth or personal) and returns its username. */
export async function lichessUsername(token: string): Promise<string> {
	const res = await fetch('https://lichess.org/api/account', { headers: { Authorization: `Bearer ${token}` } });
	if (res.status === 401) throw new Error('Lichess rejected that token.');
	if (!res.ok) throw new Error(`Lichess: HTTP ${res.status}`);
	return ((await res.json()) as { username: string }).username;
}

/** Revokes a token on logout (best effort). */
export function revokeToken(token: string) {
	void fetch('https://lichess.org/api/token', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
}
