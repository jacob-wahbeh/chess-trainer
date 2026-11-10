// Haptic feedback for drill answers. Where the Vibration API exists (Android), it plays a pattern. Safari has
// never had it; since iOS 18, though, flipping a switch control plays the system tick, so on iPhone a throwaway
// <input type="checkbox" switch> is flipped through its label. One kind of tick only: a miss is two in a row.
// Browsers with neither (desktop) simply do nothing.

export type Haptic = 'move' | 'success' | 'error';

const PATTERN: Record<Haptic, number | number[]> = { move: 8, success: 18, error: [28, 70, 28] };
/** Gap between the two ticks of a miss on iPhone. */
const DOUBLE_MS = 110;

function tick() {
	const label = document.createElement('label');
	label.ariaHidden = 'true';
	label.style.display = 'none';
	const input = document.createElement('input');
	input.type = 'checkbox';
	input.setAttribute('switch', '');
	label.appendChild(input);
	document.head.appendChild(label);
	label.click();
	label.remove();
}

/** Plays feedback for `kind`; call it from a touch (iPhone only ticks during one). */
export function haptic(kind: Haptic) {
	try {
		if (typeof navigator.vibrate === 'function') {
			navigator.vibrate(PATTERN[kind]);
			return;
		}
		tick();
		if (kind === 'error') setTimeout(tick, DOUBLE_MS);
	} catch {
		// No haptics here.
	}
}
