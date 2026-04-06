/**
 * Apply a replacement function only to text outside fenced code blocks (``` or ~~~).
 * Content inside fenced code blocks is preserved as-is.
 *
 * @param {string} content - raw Markdown string
 * @param {(text: string) => string} replaceFn - replacement function applied to non-code segments
 * @returns {string} processed Markdown
 */
function replaceOutsideCodeBlocks(content, replaceFn) {
    const lines = content.split('\n');
    const segments = [];
    let buf = [];
    let inFence = false;
    let fenceChar = '';
    let fenceLen = 0;

    for (const line of lines) {
        if (!inFence) {
            const m = line.match(/^(`{3,}|~{3,})/);
            if (m) {
                if (buf.length) segments.push({ code: false, text: buf.join('\n') });
                buf = [line];
                inFence = true;
                fenceChar = m[1][0];
                fenceLen = m[1].length;
            } else {
                buf.push(line);
            }
        } else {
            buf.push(line);
            const re = new RegExp(`^\\${fenceChar}{${fenceLen},}\\s*$`);
            if (re.test(line)) {
                segments.push({ code: true, text: buf.join('\n') });
                buf = [];
                inFence = false;
            }
        }
    }
    if (buf.length) segments.push({ code: inFence, text: buf.join('\n') });

    return segments.map(s => s.code ? s.text : replaceFn(s.text)).join('\n');
}

module.exports = { replaceOutsideCodeBlocks };
