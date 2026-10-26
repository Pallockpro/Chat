import { redirect } from "next/navigation";
import Chat from "@/components/Chat";
import { getCurrentUser, publicUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <Chat initialUser={publicUser(user)} initialConversations={user.conversations} />;
}
