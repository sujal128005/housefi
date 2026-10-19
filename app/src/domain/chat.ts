// Which chat the floating chat bubble opens: one with unread messages first, else the open one (null: no bubble).
import type { ChatSummary } from '../services/api';

export function chatToOpen(chats: readonly ChatSummary[]): ChatSummary | null {
  return chats.find((c) => c.unread > 0) ?? chats.find((c) => c.open) ?? null;
}
