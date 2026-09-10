/** trailing "Options:" list convention (see `parseOptions` in AssistantText.tsx, nudged by the system prompt) renders as clickable buttons instead of a plain bullet list - clicking one submits that exact option text as the next message, same as typing and sending it. */
export function OptionsButtons({ options, onSelect }: { options: string[]; onSelect: (text: string) => void }) {
  return (
    <div className="options-buttons">
      {options.map((option) => (
        <button key={option} type="button" className="options-button" onClick={() => onSelect(option)}>
          {option}
        </button>
      ))}
    </div>
  );
}
