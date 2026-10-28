# WhatsApp fix notes
- No functions removed; added: ensureActiveConversation, refreshWhatsAppState (js/chat.js), openSellerWhatsAppChat (js/app.js).
- Removed hardcoded fallback number from app.js, chat.js, browse_js/*, database.js (live path), Django serializer.
- Chat now has a consent bar: "Share my WhatsApp" + "Continue on WhatsApp" (uses the gated API). Header phone icon uses the same gated flow.
- Book cards / modal WhatsApp buttons now open the in-app chat instead of a direct wa.me link.
- API: whatsapp / sellerWhatsapp never returned in book list, book details, or conversation payloads. GET /api/conversations adds iApprovedWhatsapp + partnerApprovedWhatsapp (booleans).
- Tests 24 and 25 added to tests/runAllTests.js. NOT executed here (no node_modules / no network): run `npm install && npm test`.

## Round 2 - real user-to-user chat (js/chat.js only)
- Problem: in real (logged-in) mode, messages were sent to the server but read only from browser localStorage, so the other user never saw them; fake "student" auto-replies were written into localStorage.
- Now (real mode = bb_access_token present): messages and inbox load from the server, send goes through the conversation API (one shared thread), unread badge uses server counts, and the chat polls every 5s for new messages.
- Offline demo mode (no token) behaves as before, including the simulated replies.
- Inbox list now escapes names/messages/book titles (stored XSS fix); removed the fake "Online" status text.
- No functions removed; added isServerMode, fetchServerMessages, fetchServerConversations, paintUnreadBadge, refreshServerUnread.
- Known, not changed: Block only writes an audit log (does not stop messages) and deal-action cards are not stored by the server; the Report/Block buttons are not in the UI.
