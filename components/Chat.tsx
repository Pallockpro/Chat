"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { Logo, Spark } from "./Logo";

type Msg = { role: "user" | "assistant"; content: string };
type Convo = { id: string; title: string; messages: Msg[]; updatedAt: number };
type PubUser = { id: string; email: string; name: string; tokensUsed: number; tokenLimit: number };

const SUGGESTIONS = [
  "Explain quantum computing simply",
  "Help me plan a week of healthy dinners",
  "Write a short poem about autumn",
  "Debug a React useEffect loop",
];

const fmt = (n: number) => n.toLocaleString("en-US");
const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));

function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 5 ? "Burning the midnight oil" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return `${part}, ${name.split(" ")[0]}`;
}

export default function Chat({
  initialUser,
  initialConversations,
}: {
  initialUser: PubUser;
  initialConversations: Convo[];
}) {
  const router = useRouter();
  const [user, setUser] = useState(initialUser);
  const [convos, setConvos] = useState<Convo[]>(initialConversations);
  const [activeId, setActiveId] = useState<string>(newId());
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [sideOpen, setSideOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const remaining = Math.max(0, user.tokenLimit - user.tokensUsed);
  const pct = Math.min(100, (user.tokensUsed / user.tokenLimit) * 100);
  const outOfTokens = remaining <= 0;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);

  const persist = useCallback(async (id: string, msgs: Msg[]) => {
    const first = msgs.find((m) => m.role === "user")?.content ?? "New chat";
    const title = first.replace(/\s+/g, " ").slice(0, 48);
    const convo: Convo = { id, title, messages: msgs, updatedAt: Date.now() };
    setConvos((prev) => [convo, ...prev.filter((c) => c.id !== id)]);
    fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(convo),
    }).catch(() => undefined);
  }, []);

  async function send(text: string) {
    const content = text.trim();
    if (!content || streaming || outOfTokens) return;
    setError("");
    setInput("");

    const history: Msg[] = [...messages, { role: "user", content }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setStreaming(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let reply = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        if (res.status === 429 && typeof data.used === "number")
          setUser((u) => ({ ...u, tokensUsed: data.used, tokenLimit: data.limit }));
        throw new Error(data.error || "Request failed.");
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          const ev = JSON.parse(l);
          if (ev.t === "delta") {
            reply += ev.c;
            setMessages([...history, { role: "assistant", content: reply }]);
          } else if (ev.t === "usage") {
            setUser((u) => ({ ...u, tokensUsed: ev.used, tokenLimit: ev.limit }));
          } else if (ev.t === "error") {
            setError(ev.error);
          }
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") setError(e.message || "Something went wrong.");
    } finally {
      setStreaming(false);
      abortRef.current = null;
      const finalMsgs = reply ? [...history, { role: "assistant" as const, content: reply }] : history;
      setMessages(finalMsgs);
      persist(activeId, finalMsgs);
    }
  }

  function newChat() {
    abortRef.current?.abort();
    setActiveId(newId());
    setMessages([]);
    setError("");
    setSideOpen(false);
  }

  function openConvo(c: Convo) {
    abortRef.current?.abort();
    setActiveId(c.id);
    setMessages(c.messages);
    setError("");
    setSideOpen(false);
  }

  async function removeConvo(id: string) {
    setConvos((p) => p.filter((c) => c.id !== id));
    if (id === activeId) newChat();
    fetch(`/api/conversations?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const empty = messages.length === 0;

  return (
    <div className="app">
      <div className={`scrim ${sideOpen ? "show" : ""}`} onClick={() => setSideOpen(false)} />

      <aside className={`sidebar ${sideOpen ? "open" : ""}`}>
        <div className="side-top">
          <Logo />
        </div>
        <motion.button className="new-chat" onClick={newChat} whileTap={{ scale: 0.97 }}>
          <span style={{ color: "var(--accent)", fontSize: 18, lineHeight: 1 }}>+</span> New chat
        </motion.button>

        <div className="side-label">Recents</div>
        <div className="convos">
          <AnimatePresence initial={false}>
            {convos.map((c) => (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className={`convo ${c.id === activeId ? "active" : ""}`}
                onClick={() => openConvo(c)}
              >
                <span className="t">{c.title}</span>
                <button
                  className="x"
                  aria-label="Delete chat"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeConvo(c.id);
                  }}
                >
                  ×
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <div className="side-bottom">
          <div className="meter">
            <div className="meter-row">
              <span>Tokens used</span>
              <span>
                {fmt(user.tokensUsed)} / {fmt(user.tokenLimit)}
              </span>
            </div>
            <div className="meter-track">
              <motion.div
                className={`meter-fill ${pct > 85 ? "low" : ""}`}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ type: "spring", stiffness: 70, damping: 18 }}
              />
            </div>
            <div className="meter-row" style={{ marginTop: 7, marginBottom: 0 }}>
              <span>{fmt(remaining)} left</span>
            </div>
          </div>
          <div className="user-row">
            <div className="avatar">{user.name.charAt(0).toUpperCase()}</div>
            <div className="who">
              <b>{user.name}</b>
              <small>{user.email}</small>
            </div>
            <button className="link-btn" onClick={logout}>
              Log out
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <button className="menu-btn" onClick={() => setSideOpen(true)} aria-label="Open menu">
            ☰
          </button>
          <Logo />
          <span style={{ width: 36 }} />
        </div>

        <div className="scroll" ref={scrollRef}>
          {empty ? (
            <motion.div
              className="hero"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6 }}
            >
              <motion.div
                initial={{ scale: 0.4, rotate: -90, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ type: "spring", stiffness: 140, damping: 14 }}
              >
                <Spark size={52} spin />
              </motion.div>
              <motion.h1
                className="serif"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.5 }}
              >
                {greeting(user.name)}
              </motion.h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
              >
                How can I help you today?
              </motion.p>
              <div className="chips">
                {SUGGESTIONS.map((s, i) => (
                  <motion.button
                    key={s}
                    className="chip"
                    onClick={() => send(s)}
                    disabled={outOfTokens}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 + i * 0.08 }}
                    whileTap={{ scale: 0.96 }}
                  >
                    {s}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          ) : (
            <div className="thread">
              <AnimatePresence initial={false}>
                {messages.map((m, i) => (
                  <motion.div
                    key={i}
                    className={`msg ${m.role}`}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {m.role === "user" ? (
                      <div className="bubble">{m.content}</div>
                    ) : (
                      <>
                        <div className="spark">
                          <Spark size={22} spin={streaming && i === messages.length - 1} />
                        </div>
                        <div className="md">
                          {m.content ? (
                            <ReactMarkdown>{m.content}</ReactMarkdown>
                          ) : (
                            <span className="dots">
                              {[0, 1, 2].map((d) => (
                                <motion.i
                                  key={d}
                                  animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
                                  transition={{ repeat: Infinity, duration: 0.9, delay: d * 0.15 }}
                                />
                              ))}
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        <div className="composer-wrap">
          <AnimatePresence>
            {(error || outOfTokens) && (
              <motion.div
                className="banner"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {outOfTokens ? "You've used all the tokens on this account. Chatting is paused." : error}
              </motion.div>
            )}
          </AnimatePresence>

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              placeholder={outOfTokens ? "Out of tokens" : "Message Lumen…"}
              disabled={outOfTokens}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
            />
            <div className="composer-bar">
              <small>{fmt(remaining)} tokens left</small>
              {streaming ? (
                <motion.button
                  type="button"
                  className="send"
                  onClick={() => abortRef.current?.abort()}
                  aria-label="Stop"
                  whileTap={{ scale: 0.92 }}
                >
                  ■
                </motion.button>
              ) : (
                <motion.button
                  className="send"
                  disabled={!input.trim() || outOfTokens}
                  aria-label="Send"
                  whileTap={{ scale: 0.92 }}
                >
                  ↑
                </motion.button>
              )}
            </div>
          </form>
          <p className="foot">Lumen can make mistakes. Please double-check important information.</p>
        </div>
      </main>
    </div>
  );
}
