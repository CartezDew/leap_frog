// Frog Chat — floating AI assistant grounded in the uploaded GA4 data.
//
// Wraps `chatEngine.answerQuestion(...)` with a chat UI that the user can
// open from any page. The frog mascot serves as the launcher and the
// assistant avatar.
//
// Behaviour:
//   - Shows a curated welcome card with starter prompts when the panel is
//     first opened in a session.
//   - Each user message gets routed through the rule-based engine, so
//     answers are deterministic and never invented.
//   - Answers carry a `source` tag (`data` or `web`) — `data` answers get a
//     small "Grounded in your data" badge; `web` answers get an inline
//     "Search the web" call-to-action.
//   - Suggestions returned by the engine render as quick-tap chips.

import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  LuSend,
  LuLoader,
  LuShieldCheck,
  LuExternalLink,
  LuX,
  LuMessageCircle,
  LuArrowDown,
} from 'react-icons/lu';

import { useData } from '../../context/DataContext.jsx';
import { answerQuestion, defaultSuggestions } from '../../lib/chatEngine.js';
import frogAvatar from '../../images/bus-frog.webp';

const STARTER_PROMPTS = [
  'Give me a high-level summary',
  'What are my top traffic sources?',
  'How does my bounce rate compare to industry?',
  'Which pages bleed visitors?',
  'How many leads came in?',
  'What was my best month?',
  'Are there any bots in my data?',
  'Show me my unicorn pages',
];

const STARTER_PROMPTS_NO_DATA = [
  'What can you do?',
  'How do I upload my GA4 data?',
  'What is a bounce rate?',
  'What is an engaged session?',
];

function ThinkingDots() {
  return (
    <span className="frog-chat__thinking" aria-label="Thinking">
      <LuLoader size={14} className="frog-chat__spin" />
      <span>Reading your data…</span>
    </span>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  if (isUser) {
    return (
      <div className="frog-chat__msg frog-chat__msg--user">
        <div className="frog-chat__msg-bubble">{message.content}</div>
      </div>
    );
  }
  return (
    <div className="frog-chat__msg frog-chat__msg--bot">
      <img
        src={frogAvatar}
        alt=""
        aria-hidden="true"
        className="frog-chat__msg-avatar"
      />
      <div className="frog-chat__msg-body">
        <div className="frog-chat__msg-bubble">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ children, ...props }) => (
                <a {...props} target="_blank" rel="noreferrer">
                  {children}
                </a>
              ),
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
        {message.source && (
          <div className="frog-chat__msg-meta">
            {message.source === 'data' ? (
              <span className="frog-chat__badge frog-chat__badge--data">
                <LuShieldCheck size={12} /> Grounded in your data
              </span>
            ) : (
              <span className="frog-chat__badge frog-chat__badge--web">
                <LuExternalLink size={12} /> Web search suggestion
              </span>
            )}
            {message.intent && (
              <span className="frog-chat__intent" title="Matched intent">
                {message.intent}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SuggestionChips({ suggestions, onPick, disabled }) {
  if (!suggestions || suggestions.length === 0) return null;
  return (
    <div className="frog-chat__chips">
      {suggestions.map((s, i) => (
        <button
          key={`${s}-${i}`}
          type="button"
          className="frog-chat__chip"
          onClick={() => onPick(s)}
          disabled={disabled}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

export function AIChat() {
  const { analyzed, hasData, hydrated } = useData();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [messages, setMessages] = useState([]);
  const inputRef = useRef(null);
  const scrollerRef = useRef(null);
  const bottomRef = useRef(null);

  const starterPrompts = hasData ? STARTER_PROMPTS : STARTER_PROMPTS_NO_DATA;

  const lastBotSuggestions = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.role === 'assistant' && m.suggestions?.length) return m.suggestions;
    }
    return null;
  }, [messages]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!scrollerRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, thinking]);

  function handleSend(rawText) {
    const text = (rawText ?? input).trim();
    if (!text || thinking) return;
    setInput('');
    const userMsg = { role: 'user', content: text, ts: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setThinking(true);

    // Yield a tick so the thinking indicator paints before answering.
    setTimeout(() => {
      try {
        const result = answerQuestion(analyzed, text);
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: result.answer,
            source: result.source,
            intent: result.intent,
            suggestions: result.suggestions || defaultSuggestions(),
            webSearchUrl: result.webSearchUrl,
            ts: Date.now(),
          },
        ]);
      } catch (err) {
        console.error('frog-chat answerQuestion failed', err);
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content:
              `Sorry — I hit an error trying to answer that. ` +
              `If this keeps happening, try clearing the dataset and re-uploading.`,
            source: 'data',
            intent: 'error',
            suggestions: defaultSuggestions(),
            ts: Date.now(),
          },
        ]);
      } finally {
        setThinking(false);
      }
    }, 220);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function resetConversation() {
    setMessages([]);
    setInput('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // Don't show launcher until hydration is complete (prevents flash before
  // we know whether the user has data).
  if (!hydrated) return null;

  return (
    <>
      <button
        type="button"
        className={`frog-chat__launcher${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close Frog assistant' : 'Open Frog assistant'}
        aria-expanded={open}
      >
        {open ? (
          <LuX size={22} />
        ) : (
          <>
            <img
              src={frogAvatar}
              alt=""
              aria-hidden="true"
              className="frog-chat__launcher-img"
            />
            <span className="frog-chat__launcher-label">
              <LuMessageCircle size={14} />
              Ask the Frog
            </span>
          </>
        )}
      </button>

      {open && (
        <section
          className="frog-chat__panel"
          role="dialog"
          aria-label="Frog AI assistant"
        >
          <header className="frog-chat__header">
            <div className="frog-chat__header-left">
              <img
                src={frogAvatar}
                alt=""
                aria-hidden="true"
                className="frog-chat__header-avatar"
              />
              <div>
                <div className="frog-chat__title">Ask the Frog</div>
                <div className="frog-chat__subtitle">
                  {hasData
                    ? 'Grounded in your uploaded GA4 data'
                    : 'Upload a GA4 export to unlock data answers'}
                </div>
              </div>
            </div>
            <div className="frog-chat__header-actions">
              {messages.length > 0 && (
                <button
                  type="button"
                  className="frog-chat__icon-btn"
                  onClick={resetConversation}
                  aria-label="Clear conversation"
                  title="Clear conversation"
                >
                  ↻
                </button>
              )}
              <button
                type="button"
                className="frog-chat__icon-btn"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <LuX size={16} />
              </button>
            </div>
          </header>

          <div className="frog-chat__body" ref={scrollerRef}>
            {messages.length === 0 ? (
              <div className="frog-chat__welcome">
                <img
                  src={frogAvatar}
                  alt=""
                  aria-hidden="true"
                  className="frog-chat__welcome-avatar"
                />
                <h3 className="frog-chat__welcome-title">
                  Hop in — ask me anything about your data.
                </h3>
                <p className="frog-chat__welcome-copy">
                  I answer with numbers I can prove from your uploaded GA4
                  workbook. If a question isn't in your data, I'll point you
                  to a curated web search instead of making something up.
                </p>
                <div className="frog-chat__welcome-section-label">
                  Try one of these
                </div>
                <SuggestionChips
                  suggestions={starterPrompts}
                  onPick={handleSend}
                  disabled={thinking}
                />
              </div>
            ) : (
              <div className="frog-chat__thread">
                {messages.map((m, i) => (
                  <MessageBubble key={`${m.ts}-${i}`} message={m} />
                ))}
                {thinking && (
                  <div className="frog-chat__msg frog-chat__msg--bot">
                    <img
                      src={frogAvatar}
                      alt=""
                      aria-hidden="true"
                      className="frog-chat__msg-avatar"
                    />
                    <div className="frog-chat__msg-body">
                      <div className="frog-chat__msg-bubble frog-chat__msg-bubble--thinking">
                        <ThinkingDots />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {messages.length > 0 && lastBotSuggestions && !thinking && (
            <div className="frog-chat__followups">
              <div className="frog-chat__followups-label">
                <LuArrowDown size={11} /> Follow up
              </div>
              <SuggestionChips
                suggestions={lastBotSuggestions.slice(0, 4)}
                onPick={handleSend}
                disabled={thinking}
              />
            </div>
          )}

          <footer className="frog-chat__footer">
            <div className="frog-chat__inputrow">
              <input
                ref={inputRef}
                type="text"
                className="frog-chat__input"
                placeholder={
                  hasData
                    ? 'Ask about sources, pages, bounce, leads, bots…'
                    : 'Ask about the dashboard or upload a workbook to begin'
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={thinking}
              />
              <button
                type="button"
                className="frog-chat__send"
                onClick={() => handleSend()}
                disabled={!input.trim() || thinking}
                aria-label="Send"
              >
                <LuSend size={16} />
              </button>
            </div>
            <div className="frog-chat__hint">
              {hasData
                ? `Reading from ${
                    analyzed?.metadata?.sheets_found?.length || 'your uploaded'
                  } sheet${
                    (analyzed?.metadata?.sheets_found?.length || 0) === 1 ? '' : 's'
                  } · answers never invent numbers.`
                : 'Upload a GA4 export on the Upload tab to unlock data answers.'}
            </div>
          </footer>
        </section>
      )}
    </>
  );
}
