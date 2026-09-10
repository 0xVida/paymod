import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { type ConfigurableTool, type ContextMentionCategory, type InferenceProviderId, type RuleFile } from "@paymod/code-core/browser";
import { onExtensionMessage, postToExtension } from "../vscode-api";
import { ContextMenu } from "./ContextMenu";
import { SlashMenu, SLASH_COMMANDS, type SlashCommand } from "./SlashMenu";
import { RulesMenu } from "./RulesMenu";
import { ModeMenu } from "./ModeMenu";
import { ModelMenu } from "./ModelMenu";
import { PlusMenu } from "./PlusMenu";
import { AutoApproveMenu } from "./AutoApproveMenu";

type Props = {
  modelId: string;
  byokProviders: InferenceProviderId[];
  onSelectModel: (modelId: string) => void;
  mode: "plan" | "act";
  onSetMode: (mode: "plan" | "act") => void;
  ruleFiles: RuleFile[];
  onToggleRuleFile: (path: string, enabled: boolean) => void;
  configurableTools: ConfigurableTool[];
  onToggleAutoApprove: (toolName: string, enabled: boolean) => void;
  running: boolean;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  onSearchContext: (category: ContextMentionCategory, query: string) => number;
  contextResults: Map<number, string[]>;
};

type MentionState = { start: number; category: ContextMentionCategory; query: string; requestId: number; highlight: number };

/** an active mention is an "@" run with no whitespace after it, either at the start of the input or preceded by whitespace - not, say, an email address or a mid-word "@" typed for some other reason. */
function currentMentionQuery(value: string, caret: number): { start: number; query: string } | undefined {
  const text = value.slice(0, caret);
  const at = text.lastIndexOf("@");
  if (at === -1) return undefined;
  if (at > 0 && !/\s/.test(text[at - 1]!)) return undefined;
  const query = text.slice(at + 1);
  if (/\s/.test(query)) return undefined;
  return { start: at, query };
}

/** a slash command is only recognized while the whole input is still just "/" plus letters - the instant anything else is typed (a space, more text) it's plain chat text again, not a command. */
function currentSlashQuery(value: string, caret: number): string | undefined {
  if (caret !== value.length) return undefined;
  const match = /^\/([a-zA-Z]*)$/.exec(value);
  return match?.[1];
}

export function Composer({
  modelId,
  byokProviders,
  onSelectModel,
  mode,
  onSetMode,
  ruleFiles,
  onToggleRuleFile,
  configurableTools,
  onToggleAutoApprove,
  running,
  onSubmit,
  onCancel,
  onSearchContext,
  contextResults,
}: Props) {
  const [value, setValue] = useState("");
  const [mention, setMention] = useState<MentionState | undefined>(undefined);
  const [slashHighlight, setSlashHighlight] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const contextItems = mention ? (contextResults.get(mention.requestId) ?? []) : [];
  const slashQuery = currentSlashQuery(value, textareaRef.current?.selectionStart ?? value.length);
  const slashCommands = slashQuery === undefined ? [] : SLASH_COMMANDS.filter((command) => command.name.startsWith(slashQuery));

  // grows the textarea to fit its content up to the CSS max-height, then lets
  // it scroll - runs for every value change regardless of source (typing,
  // a mention insert, clearing on submit), not just onChange.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  // "Add Files & Images" opens the real native picker on the extension side -
  // the result comes back here and is inserted the same way a searched
  // mention would be, there's no vision-capable model wired in, so this is
  // a path reference, not image bytes.
  useEffect(() => {
    return onExtensionMessage((message) => {
      if (message.type === "attachFilesResult" && message.paths.length > 0) {
        const inserted = message.paths.map((path) => `@${path}`).join(" ");
        setValue((current) => (current ? `${current} ${inserted} ` : `${inserted} `));
      }
    });
  }, []);

  function updateMentionState(nextValue: string, caret: number) {
    const match = currentMentionQuery(nextValue, caret);
    if (!match) {
      setMention(undefined);
      return;
    }
    const category = mention && mention.start === match.start ? mention.category : "file";
    const requestId = onSearchContext(category, match.query);
    setMention({ start: match.start, category, query: match.query, requestId, highlight: 0 });
  }

  function selectMentionCategory(category: ContextMentionCategory) {
    if (!mention) return;
    const requestId = onSearchContext(category, mention.query);
    setMention({ ...mention, category, requestId, highlight: 0 });
  }

  function insertMention(item: string) {
    const textarea = textareaRef.current;
    if (!mention || !textarea) return;
    const caret = textarea.selectionStart;
    const before = value.slice(0, mention.start);
    const after = value.slice(caret);
    const inserted = `@${item} `;
    setValue(before + inserted + after);
    setMention(undefined);
    requestAnimationFrame(() => {
      const newCaret = before.length + inserted.length;
      textarea.focus();
      textarea.setSelectionRange(newCaret, newCaret);
    });
  }

  /** inserts "@" at the caret and opens the context menu - shared by the "@" button and the "+" menu's "Add context" option, which are two entry points to the same behavior. */
  function triggerAddContext() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const caret = textarea.selectionStart;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const needsSpace = before.length > 0 && !/\s$/.test(before);
    const inserted = `${needsSpace ? " " : ""}@`;
    const nextValue = before + inserted + after;
    setValue(nextValue);
    requestAnimationFrame(() => {
      const newCaret = before.length + inserted.length;
      textarea.focus();
      textarea.setSelectionRange(newCaret, newCaret);
      updateMentionState(nextValue, newCaret);
    });
  }

  function runSlashCommand(command: SlashCommand) {
    if (command.name === "plan") onSetMode("plan");
    else if (command.name === "act") onSetMode("act");
    setValue("");
  }

  function submit() {
    const text = value.trim();
    if (!text || running) return;
    onSubmit(value);
    setValue("");
    setMention(undefined);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (slashCommands.length > 0) {
      if (event.key === "ArrowDown") {
        setSlashHighlight((value) => Math.min(value + 1, slashCommands.length - 1));
        event.preventDefault();
        return;
      }
      if (event.key === "ArrowUp") {
        setSlashHighlight((value) => Math.max(value - 1, 0));
        event.preventDefault();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        runSlashCommand(slashCommands[Math.min(slashHighlight, slashCommands.length - 1)]!);
        event.preventDefault();
        return;
      }
      if (event.key === "Escape") {
        setValue("");
        event.preventDefault();
        return;
      }
    }
    if (mention && contextItems.length > 0) {
      if (event.key === "ArrowDown") {
        setMention({ ...mention, highlight: Math.min(mention.highlight + 1, contextItems.length - 1) });
        event.preventDefault();
        return;
      }
      if (event.key === "ArrowUp") {
        setMention({ ...mention, highlight: Math.max(mention.highlight - 1, 0) });
        event.preventDefault();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        insertMention(contextItems[mention.highlight]!);
        event.preventDefault();
        return;
      }
      if (event.key === "Escape") {
        setMention(undefined);
        event.preventDefault();
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="composer">
      <div className="composer-textarea-wrap">
        {slashCommands.length > 0 ? (
          <SlashMenu commands={slashCommands} highlight={Math.min(slashHighlight, slashCommands.length - 1)} onSelect={runSlashCommand} />
        ) : (
          mention && <ContextMenu category={mention.category} items={contextItems} highlight={mention.highlight} onSelectCategory={selectMentionCategory} onSelectItem={insertMention} />
        )}
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={running}
          onChange={(event) => {
            setValue(event.target.value);
            setSlashHighlight(0);
            updateMentionState(event.target.value, event.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="composer-toolbar">
        <div className="row">
          <PlusMenu onUpload={() => postToExtension({ type: "attachFiles" })} onAddContext={triggerAddContext} />
          <RulesMenu ruleFiles={ruleFiles} onToggle={onToggleRuleFile} />
          <AutoApproveMenu tools={configurableTools} onToggle={onToggleAutoApprove} />
          <ModelMenu modelId={modelId} byokProviders={byokProviders} onSelect={onSelectModel} />
        </div>
        <div className="row">
          <ModeMenu mode={mode} onChange={onSetMode} />
          {running ? (
            <button className="composer-send-btn composer-send-btn-running" title="Stop" aria-label="Stop" onClick={onCancel} />
          ) : (
            <button className="composer-send-btn" title="Send" aria-label="Send" disabled={!value.trim()} onClick={submit}>
              <span className="codicon codicon-arrow-up" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
