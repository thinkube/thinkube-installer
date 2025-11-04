import { useState, useCallback } from 'react';

/**
 * Hook for copying text to clipboard with visual feedback
 *
 * @param text - The text to copy (can be updated)
 * @param duration - How long to show "copied" state (default: 2000ms)
 * @returns Object with copy function and copied state
 *
 * @example
 * const { copy, copied } = useCopyToClipboard(logText);
 *
 * <Button onClick={copy}>
 *   {copied ? 'Copied!' : 'Copy'}
 * </Button>
 */
export function useCopyToClipboard(text: string, duration = 2000) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), duration);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  }, [text, duration]);

  return { copy, copied };
}
