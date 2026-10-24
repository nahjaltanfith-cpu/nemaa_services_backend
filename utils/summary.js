// Builds a short summary from a long text: its first two lines, or — for a single
// paragraph — its first two sentences. The dashboard previews the same rules live
// (nemaa_services_dashboard/src/utils/summary.js); keep the two in sync.
export const SUMMARY_MAX_LENGTH = 280;
const SENTENCE = /[^.!?؟]+[.!?؟]+/g;

export const buildShortDescription = (text = '') => {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    let summary;
    if (lines.length >= 2) {
        summary = lines.slice(0, 2).join(' ');
    } else {
        const paragraph = lines[0] || '';
        const sentences = paragraph.match(SENTENCE)?.map((sentence) => sentence.trim()) ?? [];
        summary = sentences.length ? sentences.slice(0, 2).join(' ') : paragraph;
    }
    if (summary.length <= SUMMARY_MAX_LENGTH) return summary;
    // Cut on a word boundary so the summary never ends mid-word.
    const cut = summary.slice(0, SUMMARY_MAX_LENGTH);
    return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : cut.length).trim()}…`;
};
