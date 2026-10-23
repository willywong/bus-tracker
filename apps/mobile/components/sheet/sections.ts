import type { SFSymbol } from 'sf-symbols-typescript';

/**
 * The trip sheet's sections, picked from the sheet bar's section menu
 * (plan 16). Stored as `bt.sheetSection`; `null` until you pick.
 */
export type SheetSection = 'plan' | 'nearby' | 'saved';

export const SHEET_SECTIONS: readonly SheetSection[] = ['plan', 'nearby', 'saved'];

export const SECTION_LABEL: Record<SheetSection, string> = {
  plan: 'Plan',
  nearby: 'Nearby',
  saved: 'Saved',
};

/** Each section's glyph: the menu's items, and the bar's button while it's current. */
export const SECTION_SYMBOL: Record<SheetSection, SFSymbol> = {
  plan: 'arrow.triangle.turn.up.right.diamond',
  nearby: 'scope',
  saved: 'bookmark',
};

/** Your stored choice, else Nearby when a route is tracked, else Plan. */
export function currentSection(stored: SheetSection | null, hasRoute: boolean): SheetSection {
  return stored ?? (hasRoute ? 'nearby' : 'plan');
}

export function parseSheetSection(raw: string | null): SheetSection | null {
  return raw != null && (SHEET_SECTIONS as readonly string[]).includes(raw)
    ? (raw as SheetSection)
    : null;
}
