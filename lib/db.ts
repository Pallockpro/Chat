import { promises as fs } from "fs";
import path from "path";
import os from "os";

/**
 * Tiny JSON-file database so the project runs with zero setup.
 * Accounts, token usage and saved chats are persisted to data/db.json.
 *
 * NOTE: serverless hosts (e.g. Vercel) have a read-only / ephemeral filesystem.
 * For production there, swap this file for a real database (Supabase, Neon,
 * Turso, MongoDB...). Only the functions exported here need to be reimplemented.
 */

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
};

export type User = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  tokensUsed: number;
  tokenLimit: number;
  createdAt: number;
  conversations: Conversation[];
};

type DB = { users: User[] };

const DEFAULT_DIR = path.join(process.cwd(), "data");
const DB_DIR = process.env.VERCEL ? path.join(os.tmpdir(), "lumen-data") : DEFAULT_DIR;
const DB_FILE = path.join(DB_DIR, "db.json");

let queue: Promise<unknown> = Promise.resolve();

async function read(): Promise<DB> {
  try {
    const raw = await fs.readFile(DB_FILE, "utf8");
    return JSON.parse(raw) as DB;
  } catch {
    return { users: [] };
  }
}

async function write(db: DB) {
  await fs.mkdir(DB_DIR, { recursive: true });
  const tmp = DB_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tmp, DB_FILE);
}

/** Run a read-modify-write transaction one at a time to avoid lost updates. */
function transact<T>(fn: (db: DB) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const db = await read();
    const result = await fn(db);
    await write(db);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

export const defaultTokenLimit = () => {
  const n = parseInt(process.env.TOKEN_LIMIT || "50000", 10);
  return Number.isFinite(n) && n > 0 ? n : 50000;
};

export async function findUserByEmail(email: string) {
  const db = await read();
  return db.users.find((u) => u.email === email.toLowerCase()) ?? null;
}

export async function findUserById(id: string) {
  const db = await read();
  return db.users.find((u) => u.id === id) ?? null;
}

export async function createUser(input: { email: string; name: string; passwordHash: string }) {
  return transact((db) => {
    const email = input.email.toLowerCase();
    if (db.users.some((u) => u.email === email)) return null;
    const user: User = {
      id: crypto.randomUUID(),
      email,
      name: input.name,
      passwordHash: input.passwordHash,
      tokensUsed: 0,
      tokenLimit: defaultTokenLimit(),
      createdAt: Date.now(),
      conversations: [],
    };
    db.users.push(user);
    return user;
  });
}

export async function addTokens(userId: string, tokens: number) {
  return transact((db) => {
    const u = db.users.find((x) => x.id === userId);
    if (!u) return null;
    u.tokensUsed += Math.max(0, Math.round(tokens));
    return { used: u.tokensUsed, limit: u.tokenLimit };
  });
}

export async function upsertConversation(userId: string, convo: Conversation) {
  return transact((db) => {
    const u = db.users.find((x) => x.id === userId);
    if (!u) return false;
    const i = u.conversations.findIndex((c) => c.id === convo.id);
    if (i >= 0) u.conversations[i] = convo;
    else u.conversations.unshift(convo);
    u.conversations.sort((a, b) => b.updatedAt - a.updatedAt);
    u.conversations = u.conversations.slice(0, 100);
    return true;
  });
}

export async function deleteConversation(userId: string, id: string) {
  return transact((db) => {
    const u = db.users.find((x) => x.id === userId);
    if (!u) return false;
    u.conversations = u.conversations.filter((c) => c.id !== id);
    return true;
  });
}
