/**
 * `text` is already a clean sentence by the time it gets here
 * (`describeProviderError` in `@paymod/code-core` parses the real JSON error
 * body upstream), so this only owns presentation.
 */
export function ErrorMessage({ text }: { text: string }) {
  return (
    <div className="turn-error">
      <span className="turn-error-text">{text}</span>
    </div>
  );
}
