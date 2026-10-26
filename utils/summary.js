// Builds the card's short summary from a long text: its first SUMMARY_MAX_WORDS words,
// ending with "…" when the text is longer. The dashboard previews the same rule live
// (nemaa_services_dashboard/src/utils/summary.js); keep the two in sync.
export const SUMMARY_MAX_WORDS = 8;

export const buildShortDescription = (text = '') => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length <= SUMMARY_MAX_WORDS) return words.join(' ');
    // Drop punctuation left dangling on the last kept word (e.g. "الجمعية،") before the ellipsis.
    return `${words.slice(0, SUMMARY_MAX_WORDS).join(' ').replace(/[\s.,;:!?؟،؛]+$/, '')}…`;
};
