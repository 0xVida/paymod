import { useEffect, useRef } from "react";
import { useAgentSession } from "./useAgentSession";
import { Composer } from "./components/Composer";
import { UserMessage } from "./components/UserMessage";
import { AssistantText } from "./components/AssistantText";
import { ToolActivity } from "./components/ToolActivity";
import { DiffCard } from "./components/DiffCard";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ErrorMessage } from "./components/ErrorMessage";
import { TaskHeader } from "./components/TaskHeader";

export function App() {
  const { state, submit, cancel, selectModel, setMode, toggleRuleFile, toggleAutoApprove, decideDiff, searchContext } = useAgentSession();
  const bodyRef = useRef<HTMLDivElement>(null);
  // starts true so opening a session with existing history lands on the
  // latest message instead of the top - stays true while the reader is near
  // the bottom, flips false once they scroll up to read earlier messages,
  // so a live-streaming reply doesn't yank the view back down on them.
  const pinnedToBottomRef = useRef(true);

  useEffect(() => {
    const container = bodyRef.current;
    if (!container) return;
    function handleScroll() {
      if (!container) return;
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      pinnedToBottomRef.current = distanceFromBottom < 48;
    }
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const container = bodyRef.current;
    if (!container || !pinnedToBottomRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [state.turns]);

  const lastTurn = state.turns.at(-1);
  const lastActivity = lastTurn?.activity.at(-1);
  const showThinking = state.running && !(lastActivity?.kind === "text" && lastActivity.streaming);
  const lastDiffUnresolved = lastActivity?.kind === "diff" && !lastActivity.resolved;
  const showCompletion = !state.running && !state.error && lastTurn !== undefined && lastActivity !== undefined && !lastDiffUnresolved;

  return (
    <>
      <TaskHeader usage={state.usage} contextUsage={state.contextUsage} />
      <div className="body" ref={bodyRef}>
        {state.turns.length === 0 ? (
          <div className="empty">No messages yet. Ask Paymod Code to make a change to get started.</div>
        ) : (
          state.turns.map((turn, turnIndex) => {
            const isLastTurn = turnIndex === state.turns.length - 1;
            return (
              <div key={turnIndex} className="turn-wrapper">
                <UserMessage text={turn.userText} />
                <div className="turn">
                  {turn.activity.map((item, itemIndex) => {
                    const isLastItem = isLastTurn && itemIndex === turn.activity.length - 1;
                    return item.kind === "text" ? (
                      <ErrorBoundary key={itemIndex}>
                        <AssistantText text={item.text} onSelectOption={isLastItem && !state.running ? submit : undefined} />
                      </ErrorBoundary>
                    ) : item.kind === "tool" ? (
                      <ToolActivity key={itemIndex} item={item} />
                    ) : (
                      <DiffCard key={itemIndex} edits={item.edits} resolved={item.resolved} onDecide={decideDiff} />
                    );
                  })}
                  {isLastTurn && showThinking && (
                    <div className="thinking">
                      <span className="thinking-dots">
                        <span />
                        <span />
                        <span />
                      </span>
                      <span>Thinking</span>
                    </div>
                  )}
                  {isLastTurn && showCompletion && (
                    <div className="turn-complete">
                      <span className="codicon codicon-check" />
                      <span>Done</span>
                    </div>
                  )}
                  {isLastTurn && state.error && <ErrorMessage text={state.error} />}
                </div>
              </div>
            );
          })
        )}
      </div>
      <Composer
        modelId={state.modelId}
        byokProviders={state.byokProviders}
        onSelectModel={selectModel}
        mode={state.mode}
        onSetMode={setMode}
        ruleFiles={state.ruleFiles}
        onToggleRuleFile={toggleRuleFile}
        configurableTools={state.configurableTools}
        onToggleAutoApprove={toggleAutoApprove}
        running={state.running}
        onSubmit={submit}
        onCancel={cancel}
        onSearchContext={searchContext}
        contextResults={state.contextResults}
      />
    </>
  );
}
