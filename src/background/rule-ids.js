// Dynamic declarativeNetRequest rule ids, split between the features that add
// them. Each feature only removes ids in its own range.
export const ADBLOCK_PAUSE_RULE_ID = 1;
export const ADBLOCK_LIST_RULES = { first: 2, last: 99_999 };
export const TRACKER_RULES = { first: 100_000, last: 109_999 };
