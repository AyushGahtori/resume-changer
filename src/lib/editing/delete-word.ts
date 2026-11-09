/** Deletes the word before the caret, including a selected range. */
export function deleteBeforeCaret(
  value: string,
  start: number,
  end: number,
): { value: string; caret: number } {
  if (start !== end) {
    return { value: value.slice(0, start) + value.slice(end), caret: start };
  }
  const before = value.slice(0, start).replace(/\S+\s*$/, "");
  return { value: before + value.slice(end), caret: before.length };
}

type WordDeleteEvent = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  preventDefault: () => void;
  currentTarget: HTMLTextAreaElement;
};

/** Ctrl/Cmd+Backspace removes the previous word, then puts the caret back. */
export function handleCtrlBackspace(
  event: WordDeleteEvent,
  onValue: (next: string) => void,
) {
  if (event.key !== "Backspace" || event.altKey) return;
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const start = event.currentTarget.selectionStart ?? 0;
  const end = event.currentTarget.selectionEnd ?? start;
  const next = deleteBeforeCaret(event.currentTarget.value, start, end);
  onValue(next.value);
  const node = event.currentTarget;
  requestAnimationFrame(() => {
    if (!node.isConnected) return;
    node.selectionStart = node.selectionEnd = next.caret;
  });
}
