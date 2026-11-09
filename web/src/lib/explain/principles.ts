// Foundational principles every written explanation is anchored to (Explanation.principleId), paraphrased
// from the classic literature. A source is only named where the idea is clearly that author's; the rest are
// general opening principles shared by most textbooks.

export interface Principle {
	id: string;
	title: string;
	/** The idea in our own words. */
	text: string;
	source: string;
}

const GENERAL = 'General opening principle';

export const PRINCIPLES: Principle[] = [
	{
		id: 'centre',
		title: 'Fight for the centre',
		text: 'Every opening is a struggle for the central squares: occupy them with pawns or control them with pieces, and contest the grip your opponent is building.',
		source: 'Reuben Fine, The Ideas Behind the Chess Openings'
	},
	{
		id: 'development',
		title: 'Develop quickly',
		text: 'In the opening the main task is to bring the pieces into play; a move that does neither develops nor fights for the centre needs a concrete reason.',
		source: 'José Raúl Capablanca, Chess Fundamentals'
	},
	{
		id: 'same-piece-twice',
		title: "Don't move a piece twice",
		text: 'Moving the same piece again in the opening costs time unless it wins something concrete.',
		source: 'Emanuel Lasker, Common Sense in Chess'
	},
	{
		id: 'knights-first',
		title: 'Knights before bishops',
		text: "The knights' best squares are clear early, while the bishops' depend on how the pawns settle, so knights usually come out first.",
		source: 'Emanuel Lasker, Common Sense in Chess'
	},
	{
		id: 'few-pawn-moves',
		title: 'Only the pawn moves you need',
		text: 'In the opening, move the pawns that free your pieces and fight for the centre; every other pawn move costs time or leaves a weakness.',
		source: 'Emanuel Lasker, Common Sense in Chess'
	},
	{
		id: 'early-queen',
		title: "Don't bring the queen out early",
		text: 'An early queen becomes a target: the opponent develops with gain of time by attacking it.',
		source: GENERAL
	},
	{
		id: 'king-safety',
		title: 'Castle before the centre opens',
		text: 'A king left in the centre becomes a target once lines open; castle early, and keep the position closed while you cannot.',
		source: GENERAL
	},
	{
		id: 'f7-f2',
		title: 'f7 and f2 are the weak points',
		text: 'At the start, f7 (f2 for White) is defended only by the king, so it is the natural target for early bishop, knight and queen attacks.',
		source: GENERAL
	},
	{
		id: 'development-lead',
		title: 'Open the game when you lead in development',
		text: 'With more pieces in play, open lines quickly before the opponent catches up; when behind, keep the position closed.',
		source: GENERAL
	},
	{
		id: 'right-to-attack',
		title: 'Attack from an advantage',
		text: 'Only the side with an advantage has the right to attack, and it must attack or the advantage fades; without one, defend and improve.',
		source: 'Wilhelm Steinitz'
	},
	{
		id: 'tempo',
		title: 'Develop with threats',
		text: 'A developing move that attacks something gains time, because the opponent must answer it instead of developing.',
		source: GENERAL
	},
	{
		id: 'pawn-chase',
		title: 'Chase undefended pieces with pawns',
		text: 'A piece in the centre that a pawn can attack is a target: the pawn gains space and the piece loses time.',
		source: GENERAL
	},
	{
		id: 'loose-pieces',
		title: 'Loose pieces drop off',
		text: 'Undefended pieces and pawns are where tactics strike; before each move, check what is loose on both sides.',
		source: 'John Nunn'
	},
	{
		id: 'count-defenders',
		title: 'Count attackers and defenders',
		text: 'Before capturing or allowing a capture, count how many times the square is attacked and defended.',
		source: GENERAL
	},
	{
		id: 'forcing-moves',
		title: 'Checks, captures and threats first',
		text: "Look at forcing moves first, yours and your opponent's: they decide the position before any plan does.",
		source: GENERAL
	},
	{
		id: 'pins',
		title: 'Deal with pins early',
		text: 'A pin ties down two pieces at once; break it or neutralise it before the pinned piece is attacked again.',
		source: GENERAL
	},
	{
		id: 'gambits',
		title: 'Meeting gambits',
		text: 'Accept a gambit only if you can consolidate; when your opponent declines yours, recover the pawn and take the centre.',
		source: GENERAL
	},
	{
		id: 'pawn-chain',
		title: 'Attack a pawn chain at its base',
		text: "A pawn chain is strongest at its head and weakest at its base; aim your pawn breaks at the base.",
		source: 'Aron Nimzowitsch, My System'
	},
	{
		id: 'blockade',
		title: 'Blockade isolated and passed pawns',
		text: 'Stop an isolated or passed pawn by planting a piece, ideally a knight, on the square in front of it.',
		source: 'Aron Nimzowitsch, My System'
	},
	{
		id: 'outpost',
		title: 'Use outposts',
		text: 'A square that enemy pawns can no longer attack is an outpost; a knight settled there is a lasting strength.',
		source: 'Aron Nimzowitsch, My System'
	},
	{
		id: 'prophylaxis',
		title: 'Prophylaxis',
		text: "Ask what your opponent wants to do and prevent it before pursuing your own plan.",
		source: 'Aron Nimzowitsch, My System'
	},
	{
		id: 'imbalances',
		title: 'Play to your imbalances',
		text: 'Judge a position by its differences (space, pawn structure, minor pieces, development) and choose plans that favour yours.',
		source: 'Jeremy Silman, How to Reassess Your Chess'
	}
];

export const principleById = new Map(PRINCIPLES.map((p) => [p.id, p]));
