/**
 * THE SIDECAR RULE AT OPEN (S365, Captain: "plain text wins"). A scene's
 * text lives twice: `story` (markdown, the OnlyWorlds field every tool and
 * AI reads and writes) and `atlas_richtext_json` (Atlas's own editor copy,
 * which carries detail markdown cannot). Every Atlas save writes both, with
 * `story = serializeDocToMarkdown(sidecar)`. So when they disagree, something
 * outside Atlas edited `story` (an agent, a text editor, git), and the editor
 * used to open the stale copy anyway: the outside edit was invisible, and
 * Atlas's next save wrote the old text back over it.
 *
 * The decision, cheapest check first:
 *   1. `serialize(sidecar) === story` exactly: Atlas's own last save, open
 *      the sidecar (every detail kept). The common case, no parsing.
 *   2. Otherwise NORMALISE `story` through the same parse and serializer the
 *      editor uses and compare again (S364's lesson: compare in the SAME
 *      representation; another writer's `*` bullets or trailing newline are
 *      not a different text). Equal: the sidecar.
 *   3. Still different: `story` wins. The editor opens the plain text and
 *      the next save writes a fresh sidecar from it.
 * An EMPTY or absent `story` never wins: a tool that dropped the field is not
 * a user clearing the scene.
 *
 * The live reload (S364, `storyChangedAlone`) handles an edit made while the
 * scene is open; this handles the one made while Atlas was closed.
 */

import { Editor, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { ElementChip } from './writing-workspace-element-chip';
import { serializeDocToMarkdown } from './writing-workspace-markdown';
import { convertLinkMarksToChips } from './writing-workspace-load';

/** `story` as the editor itself would write it back: parse, chips, serialize. */
export function normalizeStoryMarkdown(markdown: string): string {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit as never, Markdown, ElementChip as never],
    content: markdown,
    contentType: 'markdown',
  });
  try {
    return serializeDocToMarkdown(convertLinkMarksToChips(editor.getJSON()));
  } finally {
    editor.destroy();
  }
}

/** True when `story` holds text the sidecar does not: open `story`, not the sidecar. */
export function storyOutranksSidecar(sidecar: JSONContent | null | undefined, story: string | null | undefined): boolean {
  if (!sidecar || typeof story !== 'string' || story.trim() === '') return false;
  const fromSidecar = serializeDocToMarkdown(sidecar);
  if (fromSidecar === story) return false;
  try {
    return normalizeStoryMarkdown(story) !== fromSidecar;
  } catch {
    // A story the parser cannot read is not grounds to drop the sidecar.
    return false;
  }
}
