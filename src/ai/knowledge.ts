import { setProjectKnowledge } from "./personality.js";

// Verify this matches your repo's actual default branch (main vs master)
// before deploying.
const README_URL = "https://raw.githubusercontent.com/erthxn/Pholio/main/README.md";

const MAX_KNOWLEDGE_CHARS = 6000; // keeps the system prompt from bloating on every request

/**
 * Loads the project's own README into Pholio's system prompt at boot, so
 * meta-questions about the project get answered from source instead of
 * from whatever the model happens to know (or doesn't).
 */
export async function loadProjectKnowledge(): Promise<void> {
  try {
    const res = await fetch(README_URL);
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
    const readme = await res.text();
    setProjectKnowledge(readme.slice(0, MAX_KNOWLEDGE_CHARS));
    console.log("Loaded project README into Pholio's context.");
  } catch (err) {
    // Non-fatal: Pholio still works, it just won't have README-sourced
    // answers until this succeeds on a later boot.
    console.warn("Could not load README for AI context:", (err as Error).message);
  }
}
