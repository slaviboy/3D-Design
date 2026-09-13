/*
 * Keyboard chords in a canonical text form: modifiers in the order Mod, Ctrl, Alt, Shift, then the key, joined with
 * "+". "Mod" is Command on macOS and Ctrl elsewhere, so one binding works on both. "Ctrl" is only used for the
 * macOS Control key.
 */

export type Platform = 'mac' | 'other';

export interface KeyChordInput {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS']);
const MODIFIER_ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift'] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];

const KEY_ALIASES: Readonly<Record<string, string>> = {
  ' ': 'Space',
  Spacebar: 'Space',
  Esc: 'Escape',
  Del: 'Delete',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
};

function normalizeKeyName(key: string): string {
  const aliased = KEY_ALIASES[key] ?? key;
  return aliased.length === 1 ? aliased.toUpperCase() : aliased;
}

/** True for keys whose character already reflects Shift (punctuation), where Shift is not part of the chord. */
function isSymbolKey(key: string): boolean {
  return key.length === 1 && !/[A-Z0-9]/.test(key);
}

/** The canonical chord for a keyboard event, or null for a bare modifier key press. */
export function chordFromKeyboard(input: KeyChordInput, platform: Platform): string | null {
  if (MODIFIER_KEYS.has(input.key)) return null;
  let key = normalizeKeyName(input.key);
  // Option/Alt changes the produced character on many layouts; the physical key keeps shortcuts stable.
  if (input.code?.startsWith('Key') && (input.altKey || key.length !== 1)) key = input.code.slice(3);
  else if (input.code?.startsWith('Digit') && input.altKey) key = input.code.slice(5);
  const modifiers: Modifier[] = [];
  if (platform === 'mac' ? input.metaKey : input.ctrlKey) modifiers.push('Mod');
  if (platform === 'mac' && input.ctrlKey) modifiers.push('Ctrl');
  if (input.altKey) modifiers.push('Alt');
  if (input.shiftKey && !isSymbolKey(key)) modifiers.push('Shift');
  return [...modifiers, key].join('+');
}

/** Parses a chord typed in any modifier order or case ("shift+mod+z") into canonical form, or null if invalid. */
export function normalizeChord(text: string): string | null {
  const parts = text
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  // A trailing "+" means the plus key itself.
  if (text.trim().endsWith('++') || text.trim() === '+') parts.push('+');
  const key = parts.pop();
  if (key === undefined) return null;
  const modifiers = new Set<Modifier>();
  for (const part of parts) {
    const match = MODIFIER_ORDER.find((modifier) => modifier.toLowerCase() === part.toLowerCase());
    if (!match || modifiers.has(match)) return null;
    modifiers.add(match);
  }
  const normalizedKey = normalizeKeyName(key);
  if (MODIFIER_KEYS.has(normalizedKey)) return null;
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), normalizedKey].join('+');
}

const MAC_GLYPHS: Readonly<Record<string, string>> = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' };
const KEY_LABELS: Readonly<Record<string, string>> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
  Delete: 'Del',
  Backspace: '⌫',
};

/** Human-readable chord for menus: "⇧⌘Z" on macOS, "Ctrl+Shift+Z" elsewhere. */
export function formatChord(chord: string, platform: Platform): string {
  const parts = chord.split('+');
  const key = parts.pop() ?? '';
  const keyLabel = KEY_LABELS[key] ?? key;
  if (platform === 'mac') {
    const order = ['Ctrl', 'Alt', 'Shift', 'Mod'];
    return [...order.filter((m) => parts.includes(m)).map((m) => MAC_GLYPHS[m] ?? m), keyLabel].join('');
  }
  return [...parts.map((part) => (part === 'Mod' ? 'Ctrl' : part)), keyLabel].join('+');
}

/** True when keyboard input is meant for a text field rather than for shortcuts. */
export function isEditableTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true;
}

export interface ShortcutConflict {
  readonly chord: string;
  readonly commandIds: readonly string[];
}

/** Two-way mapping between commands and chords. */
export class ShortcutMap {
  readonly #chordsByCommand = new Map<string, string[]>();
  readonly #commandsByChord = new Map<string, string[]>();

  constructor(bindings: Iterable<readonly [string, readonly string[]]>) {
    for (const [commandId, chords] of bindings) {
      const normalized = chords.map((chord) => {
        const canonical = normalizeChord(chord);
        if (!canonical) throw new Error(`Invalid shortcut "${chord}" for ${commandId}`);
        return canonical;
      });
      this.#chordsByCommand.set(commandId, normalized);
      for (const chord of normalized) {
        const commands = this.#commandsByChord.get(chord);
        if (commands) commands.push(commandId);
        else this.#commandsByChord.set(chord, [commandId]);
      }
    }
  }

  static fromCommands(
    commands: Iterable<{ readonly id: string; readonly defaultShortcuts?: readonly string[] }>,
  ): ShortcutMap {
    return new ShortcutMap(
      [...commands].map((command) => [command.id, command.defaultShortcuts ?? []] as const),
    );
  }

  /** The command bound to a chord; the first registration wins when several share it. */
  commandFor(chord: string): string | undefined {
    return this.#commandsByChord.get(chord)?.[0];
  }

  /** Every command bound to a chord, in registration order. */
  commandsFor(chord: string): readonly string[] {
    return this.#commandsByChord.get(chord) ?? [];
  }

  chordsFor(commandId: string): readonly string[] {
    return this.#chordsByCommand.get(commandId) ?? [];
  }

  conflicts(): ShortcutConflict[] {
    return [...this.#commandsByChord]
      .filter(([, commandIds]) => commandIds.length > 1)
      .map(([chord, commandIds]) => ({ chord, commandIds }));
  }
}
