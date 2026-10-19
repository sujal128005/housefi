// The floating chat bubble opens the chat that needs attention: unread messages first, else the open one.
import { chatToOpen } from '../domain/chat';

describe('chat bubble', () => {
  it('opens the chat with unread messages first, else the open chat, else nothing', () => {
    const open = { bookingId: 'b1', code: 'HF-1', open: true, unread: 0 };
    const unread = { bookingId: 'b2', code: 'HF-2', open: false, unread: 3 };
    expect(chatToOpen([open, unread])).toBe(unread);
    expect(chatToOpen([open])).toBe(open);
    expect(chatToOpen([{ ...open, open: false }])).toBeNull();
  });
});
