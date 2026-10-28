/* ==========================================
   BookBridge - Main Browse JavaScript
========================================== */

document.addEventListener("DOMContentLoaded", () => {
    // 1. Sync User Session in Navbar
    syncBrowseNavUser();

    // Setup Mobile Menu Drawer
    const mobileBtn = document.getElementById("mobileMenuToggle");
    const mobileDrawer = document.getElementById("mobileNavDrawer");
    if (mobileBtn && mobileDrawer) {
        mobileBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const isActive = mobileDrawer.classList.toggle("active");
            mobileBtn.innerHTML = isActive ? '<i class="fa-solid fa-xmark"></i>' : '<i class="fa-solid fa-bars"></i>';
            mobileBtn.setAttribute("aria-expanded", isActive);
        });
        mobileDrawer.querySelectorAll("a").forEach(link => {
            link.addEventListener("click", () => {
                mobileDrawer.classList.remove("active");
                mobileBtn.innerHTML = '<i class="fa-solid fa-bars"></i>';
                mobileBtn.setAttribute("aria-expanded", "false");
            });
        });
    }

    // 2. Wire Hero Upload Button Auth Check
    initHeroUploadAuthCheck();

    // 3. Pre-load URL Search/Filter Parameters (from Home Page & Tags)
    initUrlParamsPreload();

    // 4. Initialize Quick Filter Chips
    initQuickChips();

    // 5. Display Initial Books With Current Filters & Sort
    if (typeof applyFilters === "function") {
        applyFilters();
    } else if (typeof renderBooks === "function") {
        renderBooks(books);
    }

    // 6. Asynchronously Load Live Books from Backend Database / API for All Visitors
    loadLiveBooksFromAPI();

    // 7. Subscribe to Real-Time Catalog Updates (new listings, updates, removals)
    initCatalogRealtime();
});

function syncBrowseNavUser() {
    const navActions = document.getElementById("browseNavActions");
    if (!navActions) return;

    try {
        const currentUser = JSON.parse(localStorage.getItem("rcti_gtu_current_user") || "null");
        if (currentUser && (currentUser.name || currentUser.email)) {
            const rawName = currentUser.name || currentUser.email.split('@')[0];
            const safeName = typeof escapeHTML === 'function' ? escapeHTML(rawName) : (window.escapeHTML ? window.escapeHTML(rawName) : String(rawName).replace(/</g, '&lt;'));
            navActions.innerHTML = `
                <div class="d-flex align-items-center gap-2">
                    <span style="font-size: 13px; font-weight: 600; color: var(--color-primary); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" class="d-none d-sm-inline">
                        <i class="fa-solid fa-user-circle me-1"></i> ${safeName}
                    </span>
                    <a href="dashboard.html" class="btn btn-ghost btn-sm">
                        <i class="fa-solid fa-gauge me-1"></i> Dashboard
                    </a>
                    <button id="btnBrowseLogout" class="btn btn-ghost btn-sm" title="Log Out">
                        Logout
                    </button>
                </div>
            `;

            document.getElementById("btnBrowseLogout")?.addEventListener("click", () => {
                localStorage.removeItem("rcti_gtu_current_user");
                localStorage.removeItem("bb_access_token");
                localStorage.removeItem("bb_refresh_token");
                window.location.reload();
            });
        }
    } catch (e) {
        console.warn("Could not sync nav user on browse page:", e);
    }
}

/**
 * Hero Section "Upload & Exchange Offer" Button Guard
 * Prohibits visitors from opening upload modal without active student login
 */
function initHeroUploadAuthCheck() {
    const heroBtn = document.getElementById("btnBrowseHeroUpload");
    if (!heroBtn) return;

    heroBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const currentUser = JSON.parse(localStorage.getItem("rcti_gtu_current_user") || "null");
        const token = localStorage.getItem("bb_access_token");

        if (!currentUser && !token) {
            showAuthPrompt(
                "Student Login Required to List Books",
                "You are browsing as a guest. To <strong>upload books for sale</strong> or <strong>propose exchange offers</strong>, you must sign in with your student account.",
                "login.html?redirect=browse.html"
            );
            return;
        }

        const modalEl = document.getElementById("uploadBookModal");
        if (modalEl && typeof bootstrap !== "undefined") {
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.show();
        }
    });
}

/**
 * Universal Modal Auth Prompt
 */
window.showAuthPrompt = function (title, desc, redirectUrl = "login.html?redirect=browse.html") {
    const modalEl = document.getElementById("authRequiredModal");
    if (modalEl && typeof bootstrap !== "undefined") {
        if (title) {
            const titleEl = document.getElementById("authModalTitle");
            if (titleEl) titleEl.textContent = title;
        }
        if (desc) {
            const descEl = document.getElementById("authModalDesc");
            if (descEl) descEl.innerHTML = desc;
        }
        if (redirectUrl) {
            const btn = document.getElementById("authModalLoginBtn");
            if (btn) btn.href = redirectUrl;
        }
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    } else {
        alert(title + "\n\n" + (desc.replace(/<[^>]+>/g, '')));
        window.location.href = redirectUrl;
    }
};

/**
 * Preload URL search params (e.g. ?q=python or ?branch=CE) from Home page
 */
function initUrlParamsPreload() {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    const branch = params.get('branch');
    const cat = params.get('cat');

    const searchInput = document.getElementById("searchInput");
    const deptSelect = document.getElementById("departmentFilter");
    const catSelect = document.getElementById("categoryFilter");

    if (q && searchInput) {
        searchInput.value = q;
    }
    if (cat && catSelect) {
        catSelect.value = cat;
    }
    if (branch && deptSelect) {
        for (let i = 0; i < deptSelect.options.length; i++) {
            const optVal = (deptSelect.options[i].value || '').toLowerCase();
            const optText = (deptSelect.options[i].text || '').toLowerCase();
            if (optVal.includes(branch.toLowerCase()) || optText.includes(branch.toLowerCase())) {
                deptSelect.selectedIndex = i;
                break;
            }
        }
    }
}

/**
 * Initialize Quick Filter Chips
 */
function initQuickChips() {
    const chips = document.querySelectorAll('.browse-chip');
    const deptSelect = document.getElementById('departmentFilter');
    if (!chips.length) return;

    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            chips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');

            if (chip.dataset.dept !== undefined && deptSelect) {
                deptSelect.value = chip.dataset.dept;
            }
            if (typeof applyFilters === 'function') {
                applyFilters();
            }
        });
    });
}

/**
 * Normalize raw API / SQLite book data into standard Browse catalog book schema
 */
function normalizeApiBook(ab) {
    if (!ab || !ab.id) return null;
    const isFree = ab.mode === "donate" || ab.type === "Donate" || Number(ab.price) === 0;
    const isExchange = ab.mode === "exchange" || ab.type === "Exchange";

    const defaultCover = "browse_images/books/book" + (((Number(ab.id || 1) - 1) % 25) + 1) + ".jpg";
    const rawCover = ab.coverUrl || ab.cover || ab.image || ab.cover_url;
    const bookCover = (rawCover && rawCover !== window.DEFAULT_BOOK_COVER) ? rawCover : defaultCover;

    const rawSeller = ab.seller || ab.seller_details;
    const sellerData = {
        id: (rawSeller && rawSeller.id) || ab.sellerId || undefined,
        name: (rawSeller && (rawSeller.name || rawSeller.full_name)) || ab.seller_name || "Student Seller",
        email: (rawSeller && rawSeller.email) || ab.sellerEmail || "student@rcti.ac.in",
        avatarUrl: (rawSeller && rawSeller.avatarUrl) || ''
    };

    return {
        id: ab.id,
        sellerId: ab.sellerId || (ab.seller && ab.seller.id),
        title: ab.title || "Untitled Book",
        author: ab.author || "Student Contributor",
        department: ab.branch || ab.department || "Computer Engineering",
        semester: Number(ab.semester) || 1,
        category: ab.genre || ab.category || ab.subject || "Programming",
        condition: ab.condition || "Good",
        price: isFree ? 0 : Number(ab.price || 0),
        type: isFree ? "Donate" : (isExchange ? "Exchange" : "Sell"),
        image: bookCover,
        cover: bookCover,
        seller: sellerData,
        description: ab.description || "",
        location: ab.location || "Campus Central Library",
        isUserListed: true
    };
}

/**
 * Real-time event handlers for live book changes
 */
function handleLiveNewBook(ab) {
    const normalized = normalizeApiBook(ab);
    if (!normalized) return;
    const existingIdx = books.findIndex(b => String(b.id) === String(normalized.id));
    if (existingIdx >= 0) {
        books[existingIdx] = { ...books[existingIdx], ...normalized };
    } else {
        books.unshift(normalized);
        if (typeof incrementLiveStat === 'function') {
            incrementLiveStat('books', 1);
        }
        if (typeof showToast === 'function') {
            showToast(`📚 New book listed: "${normalized.title}"!`, 'info');
        }
    }
    if (typeof applyFilters === 'function') {
        applyFilters();
    } else if (typeof renderBooks === 'function') {
        renderBooks(books);
    }
}

function handleLiveBookUpdated(ab) {
    const normalized = normalizeApiBook(ab);
    if (!normalized) return;
    const existingIdx = books.findIndex(b => String(b.id) === String(normalized.id));
    if (existingIdx >= 0) {
        books[existingIdx] = { ...books[existingIdx], ...normalized };
        if (typeof applyFilters === 'function') {
            applyFilters();
        } else if (typeof renderBooks === 'function') {
            renderBooks(books);
        }
    }
}

function handleLiveBookDeleted(delId) {
    const idx = books.findIndex(b => String(b.id) === String(delId));
    if (idx >= 0) {
        books.splice(idx, 1);
        if (typeof applyFilters === 'function') {
            applyFilters();
        } else if (typeof renderBooks === 'function') {
            renderBooks(books);
        }
    }
}

function initCatalogRealtime() {
    function attach(sock) {
        if (!sock || sock.__bbCatalogAttached) return;
        sock.__bbCatalogAttached = true;
        sock.on('newBook', (data) => handleLiveNewBook(data));
        sock.on('bookUpdated', (data) => handleLiveBookUpdated(data));
        sock.on('bookDeleted', (data) => handleLiveBookDeleted(data?.id));
    }

    if (window.__bbChatSocket) {
        attach(window.__bbChatSocket);
    }
    window.addEventListener('bookbridge:socket-ready', (e) => {
        if (e.detail?.socket) attach(e.detail.socket);
    });
}

/**
 * Load Live Books from API (/api/books/) and Local Storage
 * Ensures ANY visitor properly sees books listed by real students
 */
async function loadLiveBooksFromAPI() {
    try {
        let apiBooks = [];
        if (window.BookAPI && typeof window.BookAPI.getBooks === "function") {
            apiBooks = await window.BookAPI.getBooks();
        } else {
            const res = await fetch("/api/books");
            if (res.ok) {
                const data = await res.json();
                apiBooks = Array.isArray(data) ? data : (data.results || []);
            }
        }

        // Also merge any local books saved in localStorage
        try {
            const localCustom = JSON.parse(localStorage.getItem('user_uploaded_books') || '[]');
            if (Array.isArray(localCustom)) {
                apiBooks = [...localCustom, ...apiBooks];
            }
        } catch (e) {}

        if (Array.isArray(apiBooks) && apiBooks.length > 0) {
            let addedCount = 0;
            apiBooks.forEach((ab) => {
                const normalized = normalizeApiBook(ab);
                if (!normalized) return;
                const existingIdx = books.findIndex(b => String(b.id) === String(normalized.id));

                if (existingIdx >= 0) {
                    const prevImage = books[existingIdx].image || books[existingIdx].cover;
                    const defaultCover = "browse_images/books/book" + (((Number(normalized.id || 1) - 1) % 25) + 1) + ".jpg";
                    const resolvedCover = (normalized.cover && normalized.cover !== window.DEFAULT_BOOK_COVER) ? normalized.cover : (prevImage || defaultCover);
                    normalized.image = resolvedCover;
                    normalized.cover = resolvedCover;
                    books[existingIdx] = { ...books[existingIdx], ...normalized };
                } else {
                    // Prepend user-listed books so visitors see them at the top of the catalog
                    books.unshift(normalized);
                    addedCount++;
                }
            });

            // Re-render catalog with live user-listed books
            if (typeof applyFilters === "function") {
                applyFilters();
            } else if (typeof renderBooks === "function") {
                renderBooks(books);
            }
        }
    } catch (err) {
        console.warn("Could not load live user-listed books from backend:", err);
    }
}
