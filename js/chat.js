/**
 * BookBridgee - Real-Time Student Chat & Deal Communication System
 * Supports Sell, Buy, Exchange, and Donate workflows with deal banners,
 * quick suggestion chips, price negotiations, pickup locations, and local storage sync.
 */

(function () {
  'use strict';

  // State
  let activePartner = null; // { email, name, avatar, role, phone }
  let activeDeal = null;    // { bookId, bookTitle, bookPrice, mode, bookImage, exchangeFor }
  let currentFilter = 'all'; // 'all' | 'sell' | 'exchange' | 'donate'
  let unreadTotal = 0;
  let simulatedTypingTimeout = null;

  // Sound Synth via Web Audio API (Zero external audio asset dependency)
  function playBeep(type = 'receive') {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'receive') {
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08); // A5
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.12);
      } else {
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(554.37, ctx.currentTime + 0.06);
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.08);
      }
    } catch (e) {
      // Audio autoplay policy or unavailable
    }
  }

  // Get current logged in user safely
  function getCurrentUser() {
    try {
      const raw = localStorage.getItem('rcti_gtu_current_user');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  function getInitials(name) {
    if (!name) return 'ST';
    return name
      .split(' ')
      .map(w => w[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  }

  function formatTime(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  // Inject UI Elements into page
  function injectChatUI() {
    if (document.getElementById('bookBridgeChatDrawer')) return;

    // 1. Floating Action Button
    const fab = document.createElement('button');
    fab.id = 'bookBridgeChatFab';
    fab.className = 'bb-chat-fab';
    fab.setAttribute('aria-label', 'Open BookBridgee Chat');
    fab.title = 'Chat with Students (Buy · Sell · Exchange · Donate)';
    fab.innerHTML = `
      <span class="bb-chat-fab-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></span>
      <span id="bbChatFabBadge" class="bb-chat-fab-badge" style="display: none;">0</span>
    `;
    fab.addEventListener('click', () => window.toggleChatDrawer());
    document.body.appendChild(fab);

    // 2. Chat Drawer
    const drawer = document.createElement('div');
    drawer.id = 'bookBridgeChatDrawer';
    drawer.className = 'bb-chat-drawer';
    drawer.innerHTML = `
      <!-- Header -->
      <div class="bb-chat-header">
        <div class="bb-chat-header-user">
          <button id="bbChatBackBtn" class="bb-chat-back-btn" title="Back to Inbox" style="display: none;">
            ←
          </button>
          <div class="bb-chat-avatar-wrap">
            <div id="bbChatAvatar" class="bb-chat-avatar">ST</div>
            <div class="bb-chat-status-dot"></div>
          </div>
          <div class="bb-chat-user-details">
            <div id="bbChatUserName" class="bb-chat-user-name">BookBridgee Chat</div>
            <div id="bbChatUserStatus" class="bb-chat-user-status">Online · Student Network</div>
          </div>
        </div>
        <div class="bb-chat-header-actions">
          <a id="bbChatWhatsappBtn" href="#" class="bb-chat-icon-btn whatsapp" title="Continue on WhatsApp (needs their approval)" style="display: none;">
            📱
          </a>
          <button id="bbChatCloseBtn" class="bb-chat-icon-btn" title="Close Chat">
            ✕
          </button>
        </div>
      </div>

      <!-- Active Deal Context Banner -->
      <div id="bbDealBanner" class="bb-deal-banner" style="display: none;">
        <div class="bb-deal-banner-top">
          <img id="bbDealThumb" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23f1f5f9'/%3E%3Ctext x='50' y='55' font-size='20' text-anchor='middle' fill='%2394a3b8'%3E📚%3C/text%3E%3C/svg%3E" alt="Book" class="bb-deal-cover-thumb">
          <div class="bb-deal-info">
            <div id="bbDealTitle" class="bb-deal-title">Book Title</div>
            <div class="bb-deal-badge-row">
              <span id="bbDealModePill" class="bb-deal-pill sell">🏷️ Sell: ₹0</span>
            </div>
          </div>
        </div>
        <!-- Deal Quick Action Buttons -->
        <div class="bb-deal-quick-actions" id="bbDealActionsRow">
          <!-- Populated dynamically based on mode -->
        </div>
        <!-- Deal Popup Input for counter offer / swap title -->
        <div id="bbDealPopupInput" class="bb-deal-popup-input">
          <input type="text" id="bbDealCustomInput" placeholder="Enter details...">
          <button id="bbDealCustomSubmit">Send</button>
        </div>
      </div>

      <!-- INBOX VIEW -->
      <div id="bbInboxView" class="bb-inbox-view">
        <div class="bb-inbox-search-bar">
          <input type="text" id="bbInboxSearch" class="bb-inbox-search-input" placeholder="Search chats by student or book...">
        </div>
        <div class="bb-inbox-tabs">
          <button class="bb-inbox-tab active" data-filter="all">All</button>
          <button class="bb-inbox-tab" data-filter="sell">🛒 Buy / Sell</button>
          <button class="bb-inbox-tab" data-filter="exchange">🔄 Exchange</button>
          <button class="bb-inbox-tab" data-filter="donate">🎁 Donate</button>
        </div>
        <div id="bbInboxList" class="bb-inbox-list">
          <!-- Conversation list loaded here -->
        </div>
      </div>

      <!-- CONVERSATION VIEW -->
      <div id="bbConvoView" style="display: none; flex-direction: column; flex: 1; overflow: hidden;">
        <!-- WhatsApp consent bar -->
        <div id="bbWaBar" style="display: none; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; border-bottom: 1px solid #E2E8F0; background: #F0FDF4; font-size: 12px;">
          <span id="bbWaStatus" style="flex: 1; min-width: 140px; color: #166534;">WhatsApp is shared only with approval.</span>
          <button type="button" id="bbShareWaBtn" style="border: 1px solid #25D366; background: #fff; color: #166534; border-radius: 999px; padding: 4px 10px; font-size: 12px; cursor: pointer;">📱 Share my WhatsApp</button>
          <button type="button" id="bbContinueWaBtn" disabled style="border: 0; background: #25D366; color: #fff; border-radius: 999px; padding: 4px 10px; font-size: 12px; cursor: pointer; opacity: 0.6;">Continue on WhatsApp</button>
        </div>
        <!-- Messages Stream -->
        <div id="bbChatMessages" class="bb-chat-messages">
          <!-- Bubbles -->
        </div>

        <!-- Typing Indicator -->
        <div id="bbTypingIndicator" class="bb-typing-indicator">
          <span style="font-size: 11px; color: #64748B; margin-right: 4px;">Student is typing</span>
          <div class="bb-typing-dot"></div>
          <div class="bb-typing-dot"></div>
          <div class="bb-typing-dot"></div>
        </div>

        <!-- Quick Reply Chips -->
        <div id="bbQuickChips" class="bb-quick-chips">
          <!-- Populated dynamically -->
        </div>

        <!-- Composer -->
        <form id="bbChatComposer" class="bb-chat-composer">
          <input type="text" id="bbChatInput" class="bb-composer-input" placeholder="Type a message or deal inquiry..." autocomplete="off">
          <button type="submit" id="bbChatSendBtn" class="bb-send-btn" title="Send Message">
            ➤
          </button>
        </form>
      </div>
    `;

    document.body.appendChild(drawer);

    // Wire Core Events
    document.getElementById('bbChatCloseBtn').addEventListener('click', () => window.toggleChatDrawer(false));
    document.getElementById('bbChatBackBtn').addEventListener('click', () => showInboxView());
    document.getElementById('bbChatComposer').addEventListener('submit', handleSendSubmit);
    document.getElementById('bbInboxSearch').addEventListener('input', (e) => filterInbox(e.target.value));

    // Inbox tab switching
    drawer.querySelectorAll('.bb-inbox-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        drawer.querySelectorAll('.bb-inbox-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentFilter = tab.getAttribute('data-filter');
        renderInboxList();
      });
    });

    // Custom deal submit
    document.getElementById('bbDealCustomSubmit').addEventListener('click', handleDealCustomSubmit);

    // Real-time typing debounce
    let typingDebounce = null;
    const chatInput = document.getElementById('bbChatInput');
    chatInput?.addEventListener('input', () => {
      if (window.__bbChatSocket && activePartner && activePartner.conversationId) {
        try {
          window.__bbChatSocket.emit('typing', {
            conversationId: activePartner.conversationId,
            isTyping: true
          });
        } catch (e) {}
        clearTimeout(typingDebounce);
        typingDebounce = setTimeout(() => {
          if (window.__bbChatSocket && activePartner && activePartner.conversationId) {
            try {
              window.__bbChatSocket.emit('typing', {
                conversationId: activePartner.conversationId,
                isTyping: false
              });
            } catch (e) {}
          }
        }, 1200);
      }
    });

    document.getElementById('bbShareWaBtn')?.addEventListener('click', handleShareWhatsApp);
    document.getElementById('bbContinueWaBtn')?.addEventListener('click', handleContinueWhatsApp);
    document.getElementById('bbReportUserBtn')?.addEventListener('click', handleReportUser);
    document.getElementById('bbBlockUserBtn')?.addEventListener('click', handleBlockUser);

    // Initial badge update
    updateUnreadBadge();
  }

  // Open / Close Drawer
  window.toggleChatDrawer = function (forceState) {
    const drawer = document.getElementById('bookBridgeChatDrawer');
    if (!drawer) return;
    const shouldOpen = forceState !== undefined ? forceState : !drawer.classList.contains('open');

    if (shouldOpen) {
      const currentUser = getCurrentUser();
      if (!currentUser) {
        if (typeof showToast === 'function') {
          showToast('Please login with your student account to access campus chat & deals', 'warning');
        } else {
          alert('Please login with your student account to access campus chat & deals');
        }
        const page = window.location.pathname.split('/').pop() || 'browse.html';
        setTimeout(() => { window.location.href = `login.html?redirect=${encodeURIComponent(page)}`; }, 1000);
        return;
      }

      drawer.classList.add('open');
      if (!activePartner) {
        showInboxView();
      } else {
        renderActiveConversation();
      }
    } else {
      drawer.classList.remove('open');
    }
  };


  // Real mode = logged in against the backend (token present). Otherwise the offline demo storage is used.
  function isServerMode() {
    return Boolean(localStorage.getItem('bb_access_token')) && Boolean(window.BookAPI);
  }

  // Messages from the server -> the shape the chat renderer expects
  async function fetchServerMessages() {
    const me = getCurrentUser();
    if (!me || !activePartner) return [];
    let raw = [];
    try {
      const convId = await ensureActiveConversation();
      raw = convId
        ? await window.BookAPI.getConversationMessages(convId)
        : await window.BookAPI.getMessages(activePartner.email);
    } catch (err) {
      raw = [];
    }
    const myEmail = String(me.email || '').toLowerCase();
    return (Array.isArray(raw) ? raw : []).map(m => ({
      ...m,
      timestamp: m.timestamp || m.createdAt,
      read: m.read !== undefined ? m.read : Boolean(m.isRead),
      receiverEmail: m.receiverEmail || (String(m.senderEmail || '').toLowerCase() === myEmail ? activePartner.email : me.email),
      bookTitle: m.bookTitle || ''
    }));
  }

  // Conversation list from the server -> the shape the inbox renderer expects
  async function fetchServerConversations() {
    let list = [];
    try { list = await window.BookAPI.getConversations(); } catch (err) { list = []; }
    if (!Array.isArray(list)) return [];
    return list
      .map(c => c.otherUser ? ({
        partnerEmail: c.otherUser.email,
        partnerName: c.otherUser.name,
        lastMessage: c.lastMessageText || '',
        lastTimestamp: c.lastMessageAt,
        bookTitle: (c.book && c.book.title) || '',
        bookId: c.bookId || '',
        mode: (c.book && c.book.mode) || 'sell',
        unreadCount: Number(c.unreadCount) || 0
      }) : c)
      .filter(c => c.lastMessage);
  }

  function paintUnreadBadge() {
    const badge = document.getElementById('bbChatFabBadge');
    if (badge) {
      if (unreadTotal > 0) {
        badge.textContent = unreadTotal > 9 ? '9+' : unreadTotal;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }
    const dashBadge = document.getElementById('msgsBadge');
    if (dashBadge) {
      if (unreadTotal > 0) {
        dashBadge.textContent = unreadTotal;
        dashBadge.style.display = 'inline-flex';
      } else {
        dashBadge.style.display = 'none';
      }
    }
  }

  async function refreshServerUnread() {
    try {
      const list = await window.BookAPI.getConversations();
      if (Array.isArray(list)) {
        unreadTotal = list.reduce((n, c) => n + (Number(c.unreadCount) || 0), 0);
      }
    } catch (err) { /* keep previous count */ }
    paintUnreadBadge();
  }

  // Resolve (or create) the server-side conversation so the consent endpoints can be used
  async function ensureActiveConversation() {
    if (!activePartner) return null;
    if (activePartner.conversationId) return activePartner.conversationId;
    if (!window.BookAPI || typeof window.BookAPI.getOrCreateConversation !== 'function') return null;
    if (!localStorage.getItem('bb_access_token')) return null;
    try {
      const bookId = activeDeal && /^\d+$/.test(String(activeDeal.bookId || '')) ? Number(activeDeal.bookId) : undefined;
      const recipientId = activePartner.id && /^\d+$/.test(String(activePartner.id)) ? Number(activePartner.id) : undefined;
      const conv = await window.BookAPI.getOrCreateConversation(recipientId, activePartner.email, bookId);
      if (conv && conv.id) {
        activePartner.conversationId = conv.id;
        return conv.id;
      }
    } catch (err) {
      console.warn('[Chat] Could not open server conversation:', err.message || err);
    }
    return null;
  }

  // Sync the WhatsApp consent bar with the server state (booleans only, no numbers)
  async function refreshWhatsAppState() {
    const bar = document.getElementById('bbWaBar');
    const headerBtn = document.getElementById('bbChatWhatsappBtn');
    const status = document.getElementById('bbWaStatus');
    const shareBtn = document.getElementById('bbShareWaBtn');
    const contBtn = document.getElementById('bbContinueWaBtn');
    if (!bar) return;
    const convId = await ensureActiveConversation();
    if (!convId) {
      bar.style.display = 'none';
      if (headerBtn) headerBtn.style.display = 'none';
      return;
    }
    let mine = false;
    let partner = false;
    try {
      const list = await window.BookAPI.getConversations();
      const conv = Array.isArray(list) ? list.find(c => String(c.id) === String(convId)) : null;
      if (conv) {
        mine = Boolean(conv.iApprovedWhatsapp);
        partner = Boolean(conv.partnerApprovedWhatsapp);
      }
    } catch (err) { /* keep defaults */ }
    bar.style.display = 'flex';
    if (headerBtn) headerBtn.style.display = 'flex';
    if (shareBtn) {
      shareBtn.textContent = mine ? '✓ WhatsApp shared' : '📱 Share my WhatsApp';
      shareBtn.disabled = mine;
      shareBtn.style.opacity = mine ? '0.7' : '1';
    }
    if (contBtn) {
      contBtn.disabled = !partner;
      contBtn.style.opacity = partner ? '1' : '0.6';
    }
    if (status) {
      status.textContent = partner
        ? 'They shared their WhatsApp. Tap Continue to chat.'
        : (mine ? 'You shared yours. Waiting for them to share theirs.' : 'WhatsApp is shared only with approval.');
    }
  }

  async function handleShareWhatsApp() {
    if (!activePartner || !(await ensureActiveConversation())) {
      if (typeof showToast === 'function') showToast('Please select or open a conversation first', 'warning');
      return;
    }
    const btn = document.getElementById('bbShareWaBtn');
    try {
      if (window.BookAPI && typeof window.BookAPI.approveConversationWhatsApp === 'function') {
        await window.BookAPI.approveConversationWhatsApp(activePartner.conversationId);
      }
      if (typeof showToast === 'function') showToast('You approved sharing your WhatsApp for this conversation!', 'success');
      if (btn) {
        btn.textContent = '✓ WhatsApp Shared';
        btn.disabled = true;
        btn.style.opacity = '0.7';
      }
      refreshWhatsAppState();
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message || 'Could not approve WhatsApp', 'danger');
    }
  }

  async function handleContinueWhatsApp() {
    if (!activePartner || !(await ensureActiveConversation())) {
      if (typeof showToast === 'function') showToast('Please select or open a conversation first', 'warning');
      return;
    }
    try {
      if (window.BookAPI && typeof window.BookAPI.getConversationWhatsApp === 'function') {
        const data = await window.BookAPI.getConversationWhatsApp(activePartner.conversationId);
        const rawNum = data?.whatsapp || data?.whatsappNumber;
        if (rawNum) {
          let digits = String(rawNum).replace(/[^0-9]/g, '');
          if (digits.length === 10) digits = '91' + digits;
          const bookTitle = activeDeal?.bookTitle || 'your textbook';
          const msg = `Hi ${activePartner.name || ''}! I am contacting you from BookBridge regarding "${bookTitle}".`;
          const url = `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
          const opened = window.open(url, '_blank');
          if (!opened) window.location.href = url;
          return;
        }
      }
      if (typeof showToast === 'function') showToast('Could not retrieve verified WhatsApp number', 'warning');
    } catch (err) {
      const msg = err.data?.error || err.message || 'WhatsApp sharing has not been approved yet.';
      if (typeof showToast === 'function') showToast(msg, 'warning');
    }
  }

  async function handleReportUser() {
    if (!activePartner || !activePartner.conversationId) return;
    const reason = prompt(`Reason for reporting ${activePartner.name}:`);
    if (!reason || !reason.trim()) return;
    try {
      if (window.BookAPI && typeof window.BookAPI.reportUser === 'function') {
        await window.BookAPI.reportUser(activePartner.conversationId, reason.trim());
      }
      if (typeof showToast === 'function') showToast('User report submitted to campus moderation.', 'success');
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message || 'Report failed', 'danger');
    }
  }

  async function handleBlockUser() {
    if (!activePartner || !activePartner.conversationId) return;
    if (!confirm(`Are you sure you want to block ${activePartner.name}?`)) return;
    try {
      if (window.BookAPI && typeof window.BookAPI.blockUser === 'function') {
        await window.BookAPI.blockUser(activePartner.conversationId);
      }
      if (typeof showToast === 'function') showToast('User has been blocked.', 'info');
      showInboxView();
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message || 'Block failed', 'danger');
    }
  }

  // Switch to Inbox View
  function showInboxView() {
    if (window.__bbChatSocket && activePartner && activePartner.conversationId) {
      try { window.__bbChatSocket.emit('leaveConversation', activePartner.conversationId); } catch (e) {}
    }
    activePartner = null;
    activeDeal = null;

    const backBtn = document.getElementById('bbChatBackBtn');
    const dealBanner = document.getElementById('bbDealBanner');
    const convoView = document.getElementById('bbConvoView');
    const inboxView = document.getElementById('bbInboxView');
    const userName = document.getElementById('bbChatUserName');
    const userStatus = document.getElementById('bbChatUserStatus');
    const avatar = document.getElementById('bbChatAvatar');
    const waBtn = document.getElementById('bbChatWhatsappBtn');

    if (backBtn) backBtn.style.display = 'none';
    if (dealBanner) dealBanner.style.display = 'none';
    if (convoView) convoView.style.display = 'none';
    if (inboxView) inboxView.style.display = 'flex';
    if (waBtn) waBtn.style.display = 'none';

    if (userName) userName.textContent = 'Student Conversations';
    if (userStatus) userStatus.textContent = 'Buy · Sell · Exchange · Donate';
    if (avatar) avatar.textContent = '💬';

    renderInboxList();
    updateUnreadBadge();
  }

  // Render conversations list in inbox
  async function renderInboxList() {
    const listContainer = document.getElementById('bbInboxList');
    if (!listContainer) return;

    let convos = [];
    if (isServerMode()) {
      convos = await fetchServerConversations();
    } else if (window.BookDB && typeof window.BookDB.getUserConversations === 'function') {
      convos = await window.BookDB.getUserConversations();
    } else {
      const user = getCurrentUser();
      const allMsgs = JSON.parse(localStorage.getItem('rcti_gtu_messages') || '[]');
      if (user) {
        const cEmail = user.email.toLowerCase();
        const map = {};
        allMsgs.forEach(m => {
          if (m.senderEmail?.toLowerCase() === cEmail || m.receiverEmail?.toLowerCase() === cEmail) {
            const isSender = m.senderEmail?.toLowerCase() === cEmail;
            const pEmail = (isSender ? m.receiverEmail : m.senderEmail) || 'student@rcti.ac.in';
            const pKey = pEmail.toLowerCase();
            const pName = isSender ? (m.receiverName || pEmail) : (m.senderName || pEmail);
            if (!map[pKey]) {
              map[pKey] = {
                partnerEmail: pEmail,
                partnerName: pName,
                lastMessage: m.text,
                lastTimestamp: m.timestamp,
                bookTitle: m.bookTitle || '',
                mode: m.mode || 'sell',
                unreadCount: (!isSender && !m.read) ? 1 : 0
              };
            } else {
              map[pKey].lastMessage = m.text;
              map[pKey].lastTimestamp = m.timestamp;
              if (m.bookTitle) map[pKey].bookTitle = m.bookTitle;
              if (m.mode) map[pKey].mode = m.mode;
              if (!isSender && !m.read) map[pKey].unreadCount++;
            }
          }
        });
        convos = Object.values(map);
      }
    }

    // Apply Filter
    if (currentFilter !== 'all') {
      convos = convos.filter(c => {
        if (currentFilter === 'sell') return c.mode === 'sell' || c.mode === 'buy';
        if (currentFilter === 'exchange') return c.mode === 'exchange';
        if (currentFilter === 'donate') return c.mode === 'donate';
        return true;
      });
    }

    if (convos.length === 0) {
      listContainer.innerHTML = `
        <div class="bb-inbox-empty">
          <div class="bb-inbox-empty-icon">📚</div>
          <div style="font-weight: 600; color: #0F172A; margin-bottom: 4px;">No Conversations Yet</div>
          <p style="font-size: 12.5px; margin-bottom: 12px;">Browse books to message sellers, propose swaps, or claim donations.</p>
          <a href="browse.html" class="btn btn-sm btn-success" style="font-size: 12px; padding: 5px 14px; text-decoration: none; border-radius: 14px;">Browse Books</a>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = convos.map(c => {
      const initials = getInitials(c.partnerName);
      const timeStr = formatTime(c.lastTimestamp);
      const bookPrefix = c.bookTitle ? `📖 <strong>${escapeHTML(c.bookTitle)}</strong>: ` : '';
      return `
        <div class="bb-inbox-item ${c.unreadCount > 0 ? 'unread' : ''}" data-email="${escapeHTML(c.partnerEmail)}" data-name="${escapeHTML(c.partnerName)}">
          <div class="bb-chat-avatar" style="width: 36px; height: 36px; font-size: 13px;">${initials}</div>
          <div class="bb-inbox-item-content">
            <div class="bb-inbox-item-top">
              <span class="bb-inbox-item-name">${escapeHTML(c.partnerName)}</span>
              <span class="bb-inbox-item-time">${timeStr}</span>
            </div>
            <div class="bb-inbox-item-preview">${bookPrefix}${escapeHTML(c.lastMessage)}</div>
          </div>
          ${c.unreadCount > 0 ? `<div class="bb-inbox-unread-badge">${c.unreadCount}</div>` : ''}
        </div>
      `;
    }).join('');

    // Attach click events
    listContainer.querySelectorAll('.bb-inbox-item').forEach(el => {
      el.addEventListener('click', () => {
        const email = el.getAttribute('data-email');
        const name = el.getAttribute('data-name');
        window.openBookBridgeeChat({ receiverEmail: email, receiverName: name });
      });
    });
  }

  function filterInbox(query) {
    const items = document.querySelectorAll('.bb-inbox-item');
    const q = query.toLowerCase().trim();
    items.forEach(item => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(q) ? 'flex' : 'none';
    });
  }

  // Universal Public Function: Open Chat with a Specific User & Optional Book Deal Context
  window.openBookBridgeeChat = async function (options = {}) {
    injectChatUI();

    const currentUser = getCurrentUser();
    if (!currentUser) {
      if (typeof showToast === 'function') {
        showToast('Please login with your student account to contact sellers or buy books', 'warning');
      } else {
        alert('Please login with your student account to contact sellers or buy books');
      }
      const page = window.location.pathname.split('/').pop() || 'browse.html';
      setTimeout(() => { window.location.href = `login.html?redirect=${encodeURIComponent(page)}`; }, 1000);
      return;
    }

    const receiverEmail = options.receiverEmail || 'student@rcti.ac.in';
    const receiverName = options.receiverName || 'Student';
    const receiverPhone = ''; // numbers are never taken from the client; WhatsApp is unlocked via the consent endpoint

    activePartner = {
      id: options.receiverId || undefined,
      email: receiverEmail,
      name: receiverName,
      phone: receiverPhone,
      role: options.receiverRole || 'Student',
      branch: options.receiverBranch || 'Engineering'
    };

    activeDeal = {
      bookId: options.bookId || '',
      bookTitle: options.bookTitle || '',
      bookPrice: options.bookPrice !== undefined ? options.bookPrice : null,
      mode: options.mode || 'sell', // 'sell' | 'buy' | 'exchange' | 'donate'
      bookImage: options.bookImage || '',
      exchangeFor: options.exchangeFor || ''
    };

    // Mark messages as read
    if (window.BookDB && typeof window.BookDB.markMessagesAsRead === 'function') {
      await window.BookDB.markMessagesAsRead(receiverEmail);
    } else {
      const allMsgs = JSON.parse(localStorage.getItem('rcti_gtu_messages') || '[]');
      const cEmail = currentUser.email.toLowerCase();
      const rEmail = receiverEmail.toLowerCase();
      let changed = false;
      allMsgs.forEach(m => {
        if (m.receiverEmail?.toLowerCase() === cEmail && m.senderEmail?.toLowerCase() === rEmail && !m.read) {
          m.read = true;
          changed = true;
        }
      });
      if (changed) localStorage.setItem('rcti_gtu_messages', JSON.stringify(allMsgs));
    }

    window.toggleChatDrawer(true);
    renderActiveConversation();

    // If initial text provided, send or prefill
    if (options.initialText) {
      const input = document.getElementById('bbChatInput');
      if (input) {
        input.value = options.initialText;
        input.focus();
      }
    }
  };

  // Render the conversation view with messages and deal header
  async function renderActiveConversation() {
    if (!activePartner) return;

    const backBtn = document.getElementById('bbChatBackBtn');
    const inboxView = document.getElementById('bbInboxView');
    const convoView = document.getElementById('bbConvoView');
    const userName = document.getElementById('bbChatUserName');
    const userStatus = document.getElementById('bbChatUserStatus');
    const avatar = document.getElementById('bbChatAvatar');
    const waBtn = document.getElementById('bbChatWhatsappBtn');

    if (backBtn) backBtn.style.display = 'flex';
    if (inboxView) inboxView.style.display = 'none';
    if (convoView) convoView.style.display = 'flex';

    if (userName) userName.textContent = activePartner.name;
    if (userStatus) userStatus.textContent = activePartner.branch || 'Student';
    if (avatar) avatar.textContent = getInitials(activePartner.name);

    if (waBtn) {
      // Never link straight to a number: go through the consent-gated handler
      waBtn.href = '#';
      waBtn.onclick = (ev) => { ev.preventDefault(); handleContinueWhatsApp(); };
      waBtn.style.display = 'none'; // shown by refreshWhatsAppState once a server conversation exists
    }
    refreshWhatsAppState();

    // Join conversation room in Socket.IO for real-time delivery
    ensureActiveConversation().then((cid) => {
      if (cid && window.__bbChatSocket) {
        try { window.__bbChatSocket.emit('joinConversation', cid); } catch (e) {}
      }
    });

    // Render Deal Context Banner
    renderDealBanner();

    // Render Quick Reply Chips
    renderQuickChips();

    // Render Messages Stream
    await loadMessagesStream();

    // Scroll to bottom
    const stream = document.getElementById('bbChatMessages');
    if (stream) stream.scrollTop = stream.scrollHeight;

    // Focus input
    const input = document.getElementById('bbChatInput');
    if (input) input.focus();

    updateUnreadBadge();
  }

  // Render Deal Banner for Buy, Sell, Exchange, or Donate
  function renderDealBanner() {
    const banner = document.getElementById('bbDealBanner');
    const actionsRow = document.getElementById('bbDealActionsRow');
    const thumb = document.getElementById('bbDealThumb');
    const titleEl = document.getElementById('bbDealTitle');
    const pill = document.getElementById('bbDealModePill');
    const popupInput = document.getElementById('bbDealPopupInput');
    if (popupInput) popupInput.classList.remove('active');

    if (!banner || !activeDeal || !activeDeal.bookTitle) {
      if (banner) banner.style.display = 'none';
      return;
    }

    banner.style.display = 'flex';
    titleEl.textContent = activeDeal.bookTitle;
    const defaultCover = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 140'%3E%3Crect width='100' height='140' rx='6' fill='%23059669'/%3E%3Ctext x='50' y='75' font-size='32' text-anchor='middle'%3E📚%3C/text%3E%3C/svg%3E";
    thumb.src = activeDeal.bookImage || defaultCover;
    thumb.onerror = () => { thumb.src = defaultCover; };

    const mode = (activeDeal.mode || 'sell').toLowerCase();
    actionsRow.innerHTML = '';

    if (mode === 'sell' || mode === 'buy') {
      const priceVal = activeDeal.bookPrice > 0 ? `₹${activeDeal.bookPrice}` : 'Negotiable';
      pill.className = 'bb-deal-pill sell';
      pill.innerHTML = `🏷️ Price: ${priceVal}`;

      actionsRow.innerHTML = `
        <button class="bb-deal-action-btn" data-action="offer">
          💰 Make Offer
        </button>
        <button class="bb-deal-action-btn" data-action="meeting">
          📍 Meet at Library
        </button>
        <button class="bb-deal-action-btn" data-action="confirm-deal">
          🤝 Buy / Confirm Deal
        </button>
      `;
    } else if (mode === 'exchange') {
      pill.className = 'bb-deal-pill exchange';
      const swapFor = activeDeal.exchangeFor ? `Wants: ${activeDeal.exchangeFor}` : 'Propose Book Swap';
      pill.innerHTML = `🔄 ${swapFor}`;

      actionsRow.innerHTML = `
        <button class="bb-deal-action-btn" data-action="swap-offer">
          📚 Propose My Book
        </button>
        <button class="bb-deal-action-btn" data-action="meeting">
          📍 Meet at Canteen
        </button>
        <button class="bb-deal-action-btn" data-action="condition">
          🔍 Ask Condition
        </button>
      `;
    } else if (mode === 'donate') {
      pill.className = 'bb-deal-pill donate';
      pill.innerHTML = `🎁 Free Donation`;

      actionsRow.innerHTML = `
        <button class="bb-deal-action-btn" data-action="claim">
          🙏 Claim This Book
        </button>
        <button class="bb-deal-action-btn" data-action="pickup">
          📍 Arrange Pickup
        </button>
        <button class="bb-deal-action-btn" data-action="thank-donor">
          ⭐ Thank Donor
        </button>
      `;
    }

    // Attach Action Listeners
    actionsRow.querySelectorAll('.bb-deal-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.currentTarget.getAttribute('data-action');
        handleDealActionClick(action);
      });
    });
  }

  // Handle Deal Actions (Make Offer, Propose Swap, Meeting, Claim)
  function handleDealActionClick(action) {
    const popupInput = document.getElementById('bbDealPopupInput');
    const customInput = document.getElementById('bbDealCustomInput');
    const bookTitle = activeDeal?.bookTitle || 'the book';

    if (action === 'offer') {
      popupInput.classList.toggle('active');
      customInput.placeholder = 'Enter offer amount in ₹ (e.g. 250)...';
      customInput.dataset.type = 'offer';
      customInput.focus();
    } else if (action === 'swap-offer') {
      popupInput.classList.toggle('active');
      customInput.placeholder = 'Enter name of book you want to swap...';
      customInput.dataset.type = 'swap-offer';
      customInput.focus();
    } else if (action === 'meeting') {
      sendChatMessage(`📍 Meetup Proposal: Hi ${activePartner.name}, can we meet tomorrow at the RCTI Central Library (near reading room) around 1:15 PM for "${bookTitle}"?`);
    } else if (action === 'confirm-deal') {
      sendChatMessage(`🤝 Deal Confirmed: I agree to purchase "${bookTitle}"! When is a good time to meet?`);
    } else if (action === 'claim') {
      sendChatMessage(`🎁 Donation Claim: Hello ${activePartner.name}! I would love to claim your donated copy of "${bookTitle}" for my semester studies. Thank you!`);
    } else if (action === 'pickup') {
      sendChatMessage(`📍 Pickup Request: When and where on campus is convenient for me to collect "${bookTitle}"?`);
    } else if (action === 'thank-donor') {
      sendChatMessage(`⭐ Thank you so much for your generosity in donating "${bookTitle}" to help fellow RCTI students! 🙏`);
    } else if (action === 'condition') {
      sendChatMessage(`🔍 Condition Inquiry: Hi ${activePartner.name}, does "${bookTitle}" have any torn pages, pencil highlights, or binding issues?`);
    }
  }

  function handleDealCustomSubmit() {
    const customInput = document.getElementById('bbDealCustomInput');
    const popupInput = document.getElementById('bbDealPopupInput');
    const val = customInput.value.trim();
    if (!val) return;

    const bookTitle = activeDeal?.bookTitle || 'the book';
    const type = customInput.dataset.type;

    if (type === 'offer') {
      sendChatMessage(`💰 Counter-Offer: I would like to offer ₹${val} for "${bookTitle}". Would you be willing to accept this?`, {
        dealAction: 'offer',
        dealAmount: val
      });
    } else if (type === 'swap-offer') {
      sendChatMessage(`🔄 Exchange Proposal: I can offer my textbook "${val}" in exchange for your "${bookTitle}". Let me know if that works for you!`, {
        dealAction: 'swap',
        exchangeBook: val
      });
    }

    customInput.value = '';
    popupInput.classList.remove('active');
  }

  // Render context-aware quick suggestion chips
  function renderQuickChips() {
    const container = document.getElementById('bbQuickChips');
    if (!container) return;

    const mode = (activeDeal?.mode || 'sell').toLowerCase();
    let chips = [];

    if (mode === 'sell' || mode === 'buy') {
      chips = [
        '👋 Hi, is this book still available?',
        '💰 Would you consider a small discount?',
        '📍 Can we meet at RCTI Library tomorrow?',
        '🤝 Ready to buy! What time works for you?'
      ];
    } else if (mode === 'exchange') {
      chips = [
        '🔄 Hi, I have a textbook to swap with you!',
        '📚 What semester books are you looking for?',
        '📍 Let\'s meet at GTU block for the book swap.',
        '📖 What edition is your copy?'
      ];
    } else if (mode === 'donate') {
      chips = [
        '🎁 Hi! I would love to claim this book.',
        '📍 When can I collect it from you?',
        '🙏 Thank you so much for donating! ⭐',
        '🏫 Can we meet near the canteen during lunch?'
      ];
    } else {
      chips = [
        '👋 Hello! Reaching out via BookBridgee.',
        '📚 Is your listing still available?',
        '📍 Where on campus do you study?'
      ];
    }

    container.innerHTML = chips.map(c => `
      <button type="button" class="bb-quick-chip">${c}</button>
    `).join('');

    container.querySelectorAll('.bb-quick-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        sendChatMessage(btn.textContent.trim());
      });
    });
  }

  // Load and display messages for the active conversation
  async function loadMessagesStream() {
    const stream = document.getElementById('bbChatMessages');
    if (!stream || !activePartner) return;

    let msgs = [];
    if (isServerMode()) {
      msgs = await fetchServerMessages();
    } else if (window.BookDB && typeof window.BookDB.getMessages === 'function') {
      msgs = await window.BookDB.getMessages(activePartner.email);
    } else {
      const currentUser = getCurrentUser();
      const all = JSON.parse(localStorage.getItem('rcti_gtu_messages') || '[]');
      if (currentUser) {
        const cEmail = currentUser.email.toLowerCase();
        const pEmail = activePartner.email.toLowerCase();
        msgs = all.filter(m =>
          (m.senderEmail?.toLowerCase() === cEmail && m.receiverEmail?.toLowerCase() === pEmail) ||
          (m.receiverEmail?.toLowerCase() === cEmail && m.senderEmail?.toLowerCase() === pEmail)
        );
      }
    }

    // Skip re-rendering when nothing changed (keeps scroll position stable while polling)
    const streamSig = activePartner.email + '|' + msgs.length + '|' + (msgs.length ? msgs[msgs.length - 1].id : '') + '|' + msgs.filter(m => m.read).length;
    if (stream.dataset.sig === streamSig) return;
    stream.dataset.sig = streamSig;

    if (msgs.length === 0) {
      stream.innerHTML = `
        <div class="bb-chat-date-divider">Today</div>
        <div style="text-align: center; padding: 24px 10px; color: #64748B; font-size: 13px;">
          <div style="font-size: 28px; margin-bottom: 6px;">🤝</div>
          <strong>Start your conversation</strong>
          <p style="font-size: 12px; margin-top: 4px;">Send a message or click a suggestion below to discuss ${activeDeal?.bookTitle ? '"' + activeDeal.bookTitle + '"' : 'books'}.</p>
        </div>
      `;
      return;
    }

    const currentUser = getCurrentUser();
    const cEmail = currentUser?.email?.toLowerCase();

    stream.innerHTML = `
      <div class="bb-chat-date-divider">Today</div>
      ${msgs.map(m => {
        const isSent = m.senderEmail?.toLowerCase() === cEmail;
        const timeStr = formatTime(m.timestamp);
        const checkmarks = isSent ? (m.read ? '✓✓' : '✓') : '';
        const hasCard = m.bookTitle && m.dealAction;

        return `
          <div class="bb-msg-group ${isSent ? 'sent' : 'received'}">
            <div class="bb-msg-bubble">
              ${hasCard ? `
                <div class="bb-msg-card-attachment">
                  <span>📖</span>
                  <span><strong>${escapeHTML(m.bookTitle)}</strong> · Deal Inquiry</span>
                </div>
              ` : ''}
              ${escapeHTML(m.text)}
            </div>
            <div class="bb-msg-meta">
              <span>${timeStr}</span>
              ${isSent ? `<span style="font-size: 11px; margin-left: 2px;">${checkmarks}</span>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    `;

    stream.scrollTop = stream.scrollHeight;
  }

  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Handle Form Submit
  function handleSendSubmit(e) {
    e.preventDefault();
    const input = document.getElementById('bbChatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendChatMessage(text);
  }

  // Core Send Function
  async function sendChatMessage(text, extra = {}) {
    if (!activePartner || !text) return;

    if (window.__bbChatSocket && activePartner.conversationId) {
      try {
        window.__bbChatSocket.emit('typing', {
          conversationId: activePartner.conversationId,
          isTyping: false
        });
      } catch (e) {}
    }

    const currentUser = getCurrentUser();
    if (!currentUser) return;

    playBeep('send');

    const msgPayload = {
      bookId: activeDeal?.bookId || '',
      bookTitle: activeDeal?.bookTitle || '',
      bookPrice: activeDeal?.bookPrice !== null ? activeDeal.bookPrice : undefined,
      mode: activeDeal?.mode || 'sell',
      receiverName: activePartner.name,
      ...extra
    };

    // Real mode: send through the conversation endpoint so both users share one thread
    let sentViaServer = false;
    if (isServerMode()) {
      const convId = await ensureActiveConversation();
      if (convId) {
        try {
          await window.BookAPI.sendConversationMessage(convId, text);
          sentViaServer = true;
        } catch (err) {
          if (typeof showToast === 'function') showToast((err && err.message) || 'Message could not be sent', 'danger');
          return;
        }
      }
    }

    // Send through API / Local DB
    if (sentViaServer) {
      // already delivered by the server
    } else if (window.BookAPI && typeof window.BookAPI.sendMessage === 'function') {
      await window.BookAPI.sendMessage(activePartner.email, text, activeDeal?.bookTitle || '', msgPayload);
    } else if (window.BookDB && typeof window.BookDB.sendMessage === 'function') {
      await window.BookDB.sendMessage(activePartner.email, text, activeDeal?.bookTitle || '', msgPayload);
    } else {
      const all = JSON.parse(localStorage.getItem('rcti_gtu_messages') || '[]');
      const newMsg = {
        id: 'msg-' + Date.now(),
        senderName: currentUser.name,
        senderEmail: currentUser.email,
        receiverName: activePartner.name,
        receiverEmail: activePartner.email,
        text: text,
        timestamp: new Date().toISOString(),
        read: false,
        ...msgPayload
      };
      all.push(newMsg);
      localStorage.setItem('rcti_gtu_messages', JSON.stringify(all));
    }

    // Refresh Stream
    await loadMessagesStream();

    // Trigger Smart Student Auto-Reply Demo Simulation
    triggerSimulatedStudentReply(text);
  }

  // Realistic Simulation: If receiver is not logged in, simulate reply after delay
  function triggerSimulatedStudentReply(triggerText) {
    if (isServerMode()) return; // real users reply for themselves; simulation is for offline demo only
    if (simulatedTypingTimeout) clearTimeout(simulatedTypingTimeout);

    const partnerEmail = activePartner.email.toLowerCase();
    const isSelf = partnerEmail === getCurrentUser()?.email?.toLowerCase();
    if (isSelf) return;

    const typingEl = document.getElementById('bbTypingIndicator');

    // 1. Show Typing Indicator after 1.2s
    simulatedTypingTimeout = setTimeout(() => {
      if (typingEl) {
        typingEl.classList.add('active');
        const stream = document.getElementById('bbChatMessages');
        if (stream) stream.scrollTop = stream.scrollHeight;
      }

      // 2. Send realistic response after 2.2s
      setTimeout(() => {
        if (typingEl) typingEl.classList.remove('active');

        let reply = '';
        const mode = (activeDeal?.mode || 'sell').toLowerCase();

        if (triggerText.includes('offer') || triggerText.includes('₹') || triggerText.includes('discount')) {
          reply = `Hi! Thanks for the offer. That price works for me! When can we meet at the campus library or canteen to finalize it?`;
        } else if (mode === 'exchange' || triggerText.includes('swap') || triggerText.includes('exchange')) {
          reply = `Hey! That swap offer sounds great. My book is in very good condition with zero torn pages. Let's meet at the GTU canteen tomorrow after 1:00 PM!`;
        } else if (mode === 'donate' || triggerText.includes('claim') || triggerText.includes('Donation')) {
          reply = `Hello! I'm delighted to donate this textbook to help your studies. You can collect it from the Computer Dept room 204 tomorrow during lunch break!`;
        } else if (triggerText.includes('Library') || triggerText.includes('Meetup') || triggerText.includes('meet')) {
          reply = `Yes, RCTI Library at 1:15 PM is perfect. I will be near the ground floor reading hall with the book!`;
        } else {
          reply = `Hi! Yes, the book is available. Let me know when you'd like to meet on campus to inspect it.`;
        }

        const replyMsg = {
          id: 'msg-' + Date.now(),
          senderName: activePartner.name,
          senderEmail: activePartner.email,
          receiverName: getCurrentUser()?.name || 'Student',
          receiverEmail: getCurrentUser()?.email,
          text: reply,
          bookTitle: activeDeal?.bookTitle || '',
          mode: mode,
          timestamp: new Date().toISOString(),
          read: true
        };

        const all = JSON.parse(localStorage.getItem('rcti_gtu_messages') || '[]');
        all.push(replyMsg);
        localStorage.setItem('rcti_gtu_messages', JSON.stringify(all));

        playBeep('receive');
        loadMessagesStream();
        updateUnreadBadge();

        if (typeof showToast === 'function') {
          showToast(`💬 New message from ${activePartner.name}`, 'info');
        }
      }, 2200);
    }, 1200);
  }

  // Update FAB & Dashboard Badges
  function updateUnreadBadge() {
    const user = getCurrentUser();
    if (!user) return;
    if (isServerMode()) { refreshServerUnread(); return; }

    const all = JSON.parse(localStorage.getItem('rcti_gtu_messages') || '[]');
    const cEmail = user.email.toLowerCase();

    unreadTotal = all.filter(m => m.receiverEmail?.toLowerCase() === cEmail && !m.read).length;

    const badge = document.getElementById('bbChatFabBadge');
    if (badge) {
      if (unreadTotal > 0) {
        badge.textContent = unreadTotal > 9 ? '9+' : unreadTotal;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }

    const dashBadge = document.getElementById('msgsBadge');
    if (dashBadge) {
      if (unreadTotal > 0) {
        dashBadge.textContent = unreadTotal;
        dashBadge.style.display = 'inline-flex';
      } else {
        dashBadge.style.display = 'none';
      }
    }
  }

  // Listen to system events
  window.addEventListener('storage', (e) => {
    if (e.key === 'rcti_gtu_messages') {
      updateUnreadBadge();
      if (activePartner) loadMessagesStream();
      else renderInboxList();
    }
  });

  window.addEventListener('bookbridge:new-message', () => {
    updateUnreadBadge();
    if (activePartner) loadMessagesStream();
  });

  window.addEventListener('bookbridge:messages-updated', () => {
    updateUnreadBadge();
  });

  // Poll for incoming messages while logged in (real mode only)
  setInterval(() => {
    if (!isServerMode() || !getCurrentUser() || document.hidden) return;
    updateUnreadBadge();
    const drawer = document.getElementById('bookBridgeChatDrawer');
    if (!drawer || !drawer.classList.contains('open')) return;
    if (activePartner) loadMessagesStream();
    else renderInboxList();
  }, 5000);

  // Real-time delivery: connect to the server's Socket.IO and reuse the existing refresh event.
  // Polling above stays as the fallback if the socket is unavailable.
  function initRealtimeSocket() {
    try {
      const token = localStorage.getItem('bb_access_token');
      // If already connected with proper token, no need to reconnect
      if (window.__bbChatSocket && window.__bbChatSocket.connected) {
        if (token && !window.__bbChatSocket.__authed) {
          try { window.__bbChatSocket.disconnect(); } catch (e) {}
        } else {
          return;
        }
      }

      const connect = () => {
        if (typeof window.io !== 'function') return;
        if (window.__bbChatSocket) {
          try { window.__bbChatSocket.disconnect(); } catch (e) {}
        }
        const auth = token ? { token } : {};
        const sock = window.io({ auth, transports: ['websocket', 'polling'] });
        sock.__authed = Boolean(token);
        window.__bbChatSocket = sock;

        sock.on('connect', () => {
          if (activePartner && activePartner.conversationId && sock.__authed) {
            sock.emit('joinConversation', activePartner.conversationId);
          }
          window.dispatchEvent(new CustomEvent('bookbridge:socket-ready', { detail: { socket: sock } }));
        });

        const onIncoming = (msg) => {
          playBeep('receive');
          window.dispatchEvent(new CustomEvent('bookbridge:new-message', { detail: msg }));
          updateUnreadBadge();
          if (activePartner && (String(activePartner.conversationId) === String(msg?.conversationId) || String(activePartner.email).toLowerCase() === String(msg?.senderEmail).toLowerCase())) {
            loadMessagesStream();
          } else if (msg && msg.senderName && typeof showToast === 'function') {
            showToast(`New message from ${msg.senderName}: ${msg.text || ''}`, 'info');
          }
        };

        sock.on('chatNotification', (data) => onIncoming(data?.message || data));
        sock.on('newMessage', onIncoming);

        // Real-time typing indicators from partner
        sock.on('userTyping', (data) => {
          if (!data || !activePartner) return;
          if (String(activePartner.conversationId) === String(data.conversationId)) {
            const typingEl = document.getElementById('bbTypingIndicator');
            if (!typingEl) return;
            const textEl = typingEl.querySelector('span');
            if (data.isTyping) {
              if (textEl) textEl.textContent = `${data.userName || 'Student'} is typing`;
              typingEl.classList.add('active');
            } else {
              typingEl.classList.remove('active');
            }
          }
        });

        // Real-time WhatsApp consent approval notification
        sock.on('whatsappApproved', (data) => {
          if (activePartner && String(activePartner.conversationId) === String(data?.conversationId)) {
            refreshWhatsAppState();
            if (typeof showToast === 'function') {
              showToast(`${data.approverName || activePartner.name} shared their WhatsApp! You can now continue on WhatsApp.`, 'success');
            }
          }
        });

        window.dispatchEvent(new CustomEvent('bookbridge:socket-ready', { detail: { socket: sock } }));
      };

      if (typeof window.io === 'function') return connect();
      const s = document.createElement('script');
      s.src = '/socket.io/socket.io.js';
      s.async = true;
      s.onload = connect;
      s.onerror = () => {}; // static hosting without a socket server: polling keeps working
      document.head.appendChild(s);
    } catch (e) { /* non-fatal */ }
  }

  window.initChatSocket = initRealtimeSocket;
  window.addEventListener('storage', (e) => {
    if (e.key === 'bb_access_token' && e.newValue) initRealtimeSocket();
  });
  window.addEventListener('bookbridge:auth-changed', () => initRealtimeSocket());
  initRealtimeSocket();

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectChatUI);
  } else {
    injectChatUI();
  }

})();
