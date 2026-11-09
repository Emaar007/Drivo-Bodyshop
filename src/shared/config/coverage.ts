// Insurance verification: how notes in TSD are read. ONE place to add formats.
// Sources: the timestamped TSD notes (CNotes: "INSURANCE CALL", "ADJUSTER CALL", ...) and the RA's own Notes field.

/** Days after pickup by which coverage must be verified (day 0..3 = due, day 4 = overdue). */
export const VERIFY_DEADLINE_DAYS = 3;

/** Coverage counts as "ending" (amber) when this many covered days or fewer remain. */
export const COVERAGE_WARN_DAYS = 3;

/** A note confirms coverage when it matches one of these (case-insensitive)... */
export const VERIFIED_PATTERNS: RegExp[] = [
  /\bverified\b/i,
  /\bverification\b/i,
  /\bapproved\b/i,
  /\bcoverage confirmed\b/i,
  /\bconfirmed coverage\b/i,
  /\b(?:insurance|ins|geico|progressive|allstate|state ?farm|travelers)\s+(?:covers|covering|will cover)\b/i,
  /\bapproved days\b/i,
];

/** ...and none of these, which are template text or unrelated approvals that appear in TSD notes. */
export const IGNORE_PATTERNS: RegExp[] = [
  /credit check (?:returned )?"?approved"?/i,
  /\bscore is approved\b/i,
  /\bapproved by\b/i,
  /\bapproved \$?\d+ deposit\b/i,
  /\b(?:info|email|e-mail|id|license)(?:\/(?:info|email|e-mail))? verified\b/i,
  /\bverbally verified info\b/i,
  /\bcredit (?:check )?approved\b/i,
  /\b(?:info|eamil)(?:\/(?:info|email|eamil))? verified\b/i,
  /\bapproved for (?:fuel|deposit|upgrade|waiver|additional driver)\b/i,
  /according to (?:the )?customer[^.\n]*/i, // the customer's word is not a verification
];

/** Coverage refused: ends verification with "Coverage denied" (customer pays). */
export const DENIED_PATTERNS: RegExp[] = [
  /\bno (?:rental )?coverage\b/i,
  /\b(?:doesn'?t|does not|don'?t) have (?:rental )?coverage\b/i,
  /\bwill not cover\b/i,
  /\bnot covered\b/i,
  /\bcoverage (?:denied|declined)\b/i,

];

/** Daily rate: "$30", "30$", "$35/day", "@ $40", "DAILY RATE: $30", "28.31$ per day". */
export const RATE_PATTERNS: RegExp[] = [
  /daily rate:?\s*\$?\s*(\d+(?:\.\d+)?)/i,
  /\$\s*(\d+(?:\.\d+)?)\s*(?:\/|per|a)\s*d(?:ay)?\b/i,
  /(\d+(?:\.\d+)?)\s*\$\s*(?:\/|per|a)\s*d(?:ay)?\b/i,
  /@\s*\$\s*(\d+(?:\.\d+)?)/i,
  /\$\s*(\d+(?:\.\d+)?)/,
  /(\d+(?:\.\d+)?)\s*\$/,
];

/** Days covered: "30 days", "for 30 d", "30 days approved", "approved 14 days", "APPROVED DAYS: 30", "30 day". */
export const DAYS_PATTERNS: RegExp[] = [
  /approved days:?\s*(\d{1,3})/i,
  /(\d{1,3})\s*-?\s*days?\b/i,
  /for\s+(\d{1,3})\s*d\b/i,
  /(\d{1,3})\s*d\b/i,
];

/** Maximum amount: "MAX COVERAGE: $900", "max $1500". Days = floor(max / rate) when days are not stated. */
export const MAX_PATTERNS: RegExp[] = [
  /max(?:imum)?(?: coverage)?:?\s*\$\s*(\d+(?:\.\d+)?)/i,
  /\$\s*(\d+(?:\.\d+)?)\s*max/i,
  /up to \$\s*(\d+(?:\.\d+)?)/i,
];

/** Open-ended approval: "till the end of the repair", "until repair finishes". */
export const UNTIL_REPAIR_PATTERNS: RegExp[] = [/\b(?:till|until|to) (?:the )?end of (?:the )?repair/i, /\buntil (?:the )?repair (?:is )?(?:finishe[sd]|done|complete)/i];

/** An extension of coverage adds days: "extended 10 more days", "approved 7 additional days". */
export const EXTENSION_PATTERNS: RegExp[] = [
  /(\d{1,3})\s+more\s+days?\b/i,
  /(\d{1,3})\s+additional\s+days?\b/i,
  /additional\s+(\d{1,3})\s+days?\b/i,
];
