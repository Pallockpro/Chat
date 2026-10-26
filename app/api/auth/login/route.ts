import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { findUserByEmail } from "@/lib/db";
import { createSession, publicUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  const user = await findUserByEmail(email);
  const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !ok)
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });

  await createSession(user.id);
  return NextResponse.json({ user: publicUser(user) });
}
