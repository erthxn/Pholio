/**
 * Bug #1 safety net. The system prompt now directly forbids *, _, `, and #
 * anywhere in a reply, not just in headers, but a prompt rule alone isn't
 * guaranteed, models slip up. This is the backstop: every outgoing message
 * runs through here right before it's sent, so even if the model forgets,
 * the person never sees a literal asterisk or underscore in their texts.
 *
 * Deliberately blunt (a straight character strip, not a markdown parser) —
 * catching every slipped character matters more here than being clever
 * about preserving some hypothetical legitimate use of these symbols in a
 * short chat reply.
 */
export function sanitizeForIMessage(raw: string): string {
  const withoutHeaders = raw.replace(/^#{1,6}\s*/gm, "");
  const withoutMarkers = withoutHeaders.replace(/[*_`#]/g, "");

  return withoutMarkers
    .split("\n")
    .map((line) => line.replace(/^[ \t]+/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
