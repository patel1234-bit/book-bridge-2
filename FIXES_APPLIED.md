# Fixes applied (no function names/signatures changed)

1. server.js - static server exposed the whole project root (.env, config/secret.js, data/*.sqlite, controllers, source). Now blocked (404) and dotfiles denied.
2. server.js - GET /api/books and /api/books/:id had no optionalAuth, so req.user was always empty and every logged-in user was treated as a guest (seller email hidden). Added optionalAuth.
3. server.js - Socket.IO joinConversation had no participant check: anyone could join any chat room and read messages. Now verified; typing events require room membership.
4. server.js - POST /api/messages (legacy) had no validation; added validateMessageInput.
5. authController.forgotPassword - anyone could reset ANY account's password with just an email (and it wrote to a non-existent `password` field, re-activated banned users). Direct reset removed; only the single-use token flow remains.
6. authController.resetPassword - frontend sends new_password/password but server read only newPassword -> 500 error. Now accepts all three (validate.js updated too).
7. validate.validateLoginInput - lowercased enrollment numbers, breaking case-sensitive login. Only e-mails are lowercased now.
8. validate.js - mode/condition .toLowerCase() crashed (500) on non-string input.
9. security.js - CORS methods lacked PATCH (used by /api/books/:id/status); localhost check used substring match (evil-localhost.com passed). Now parses hostname.
10. chatController - legacy send crashed on missing text; getOrCreateConversation 500 on unknown recipient id; now 400/404.
11. adminController - admin could demote/deactivate own account (lockout); blocked.
12. forgot-password.html - UI claimed "Password reset successfully" after the now-removed direct reset; now says to check email.

Not changed (needs your decision): no email sender exists - reset link is only printed in server console; deactivated users' existing JWTs stay valid until expiry; Block only writes an audit log; tests not run (no node_modules/network here).

## Round 2 - chat, listings, database
13. js/chat.js - the browser never connected to Socket.IO (no client anywhere), so "real-time" was only 5s polling. Added a guarded socket client (token auth) that reuses the existing `bookbridge:new-message` handler; polling remains as fallback.
14. chatController.getMessages / getLegacyMessages - returned the OLDEST 100 messages, so in long chats new messages never appeared. Now returns the newest 100 in order.
15. models/Book.js + models/index.js - coverUrl/pdfUrl were VARCHAR(500) but the UI uploads base64 images; MySQL rejects them ("Data too long"). Columns are now MEDIUMTEXT (existing MySQL tables are altered on startup).
16. server.js - JSON body limit raised 5MB -> 10MB (a 5MB image is ~6.7MB base64, previously 413).
17. Notifications were saved on every message but had no API. Added GET /api/notifications and PUT /api/notifications/read (new functions only).
18. config/seed.js - refuses to create demo accounts (admin@rcti.ac.in / password123) in production unless ALLOW_PRODUCTION_SEED=true.

Not changed: unused `mongoose` dependency and missing `pg` package for postgres URLs; Wishlist model has no routes; the Python/Django backend under backend/ is not used by the Node server and was not modified.

## Round 3 - final
19. sw.js - service worker cached every GET including /api/* (chat messages, books, conversations) cache-first, so chat/listings looked stale and private API data stayed in the browser cache. API and Socket.IO requests now bypass the cache; cache version bumped to v2.1.
20. sitemap.xml / robots.txt - pointed to bookbridge.onrender.com; now the real deployed domain.

## Round 4 - final static verification
21. js/api.js - app.js called BookAPI.addReview (leave a review) and BookAPI.deleteUser (admin remove user) but neither existed on BookAPI -> TypeError. Added both (they delegate to BookDB like the other local features).

Verified statically: every relative require resolves; every controller/validator used in server.js exists; no duplicate routes (48 registered); every BookAPI/BookDB method the pages call is defined; every inline onclick/onchange handler is defined; all JS passes node --check.
NOT verified: runtime behavior (server could not be started here - no network to install dependencies). Run `npm install && npm test`.
