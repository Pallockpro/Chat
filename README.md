# Lumen — animated AI chat (Next.js + React + DeepSeek)

A warm, Claude-inspired chat app with:

- **Next.js 14 (App Router) + React 18** and **Framer Motion** animations
- **Accounts** (sign up / log in) with bcrypt-hashed passwords and signed cookie sessions
- **Per-account token limit** — usage is counted from DeepSeek's reported token usage, saved per account, and shown in a live meter. Chat is blocked when an account runs out.
- **Saved chat history** per account
- **Streaming replies** from the DeepSeek API (key stays server-side)

## Run locally

```bash
npm install
cp .env.example .env.local     # then edit .env.local
npm run dev
```

Open http://localhost:3000, create an account, and chat.

### Environment variables (`.env.local`)

| Variable | What it does |
| --- | --- |
| `DEEPSEEK_API_KEY` | Your key from https://platform.deepseek.com/api_keys |
| `DEEPSEEK_MODEL` | Model name, default `deepseek-flash` (check https://api-docs.deepseek.com for current names) |
| `AUTH_SECRET` | Long random string used to sign login cookies |
| `TOKEN_LIMIT` | Total tokens each new account gets (default `50000`) |

## How the token limit works

`app/api/chat/route.ts` checks the account's remaining tokens before every request, caps `max_tokens` to what's left, streams the reply, then adds DeepSeek's reported `usage.total_tokens` to the account in `data/db.json`. Change `TOKEN_LIMIT` to change the allowance for **new** accounts.

## Storage

Accounts, usage and chats are stored in `data/db.json` (git-ignored) so the project works with zero setup. This is fine for local use and a single always-on server (VPS, Railway/Render with a volume).

**Serverless hosts like Vercel have an ephemeral filesystem**, so data would not persist there. To deploy on Vercel, replace the functions in `lib/db.ts` with a hosted database (Supabase, Neon, Turso, MongoDB Atlas…). Nothing else in the app needs to change.

## Project layout

```
app/            pages + API routes (auth, chat, conversations)
components/     Chat UI, auth form, logo
lib/            db.ts (storage) and auth.ts (sessions)
```

## Notes

- DeepSeek API usage is billed by DeepSeek against your own account/balance; the token limit here protects you from any one user spending it all.
- This is an independent project with its own name and logo; it is not affiliated with Anthropic or DeepSeek.
