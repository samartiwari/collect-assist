// Reminder drafting. Text only ever comes from approved templates with the loan's own
// values filled in. A word filter blocks threatening or abusive language, which RBI's
// fair-practice rules forbid, even if an officer edits the draft. Nothing is sent without a tap.

const BLOCKED_TERMS = [
  // English
  'police', 'jail', 'arrest', 'court case', 'legal action', 'seize', 'seizure', 'shame', 'expose',
  'family will', 'your family', 'consequences', 'last warning', 'or else', 'threat', 'goons', 'recovery agents will',
  'we will come', 'blacklist', 'defaulter list',
  // Hindi / Hinglish
  'पुलिस', 'जेल', 'गिरफ्तार', 'कोर्ट', 'केस', 'ज़ब्त', 'जब्त', 'बदनाम', 'परिवार को', 'अंजाम', 'आखिरी चेतावनी', 'धमकी',
  'dekh lenge', 'utha lenge', 'badnaam',
];

export interface FilterResult {
  ok: boolean;
  blockedWords: string[];
}

export function checkMessage(text: string): FilterResult {
  const lower = text.toLowerCase();
  const blockedWords = BLOCKED_TERMS.filter((t) => lower.includes(t.toLowerCase()));
  return { ok: blockedWords.length === 0, blockedWords };
}

/** Fill {{placeholders}}; unknown placeholders are left visible so a reviewer spots them. */
export function fillTemplate(body: string, vars: Record<string, string | number>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

export function hasUnfilledPlaceholders(text: string): boolean {
  return /\{\{\s*\w+\s*\}\}/.test(text);
}
