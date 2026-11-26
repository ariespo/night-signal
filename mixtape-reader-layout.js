function readerMessages(chat) {
    return chat.querySelectorAll(':scope > .mes[mesid]');
}

function clampPage(layout, pageIndex) {
    const page = Number.isFinite(pageIndex) ? Math.trunc(pageIndex) : 0;
    return Math.max(0, Math.min(layout.pages - 1, page));
}

function pageLocator(chat, stride) {
    const offset = chat.scrollLeft - chat.getBoundingClientRect().left - chat.clientLeft;
    // The geometry APIs round scroll and column boundaries at different stages.
    return rect => Math.max(0, Math.floor((rect.left + offset + 1) / stride));
}

export function measureReaderLayout(chat, visibleLeaves) {
    const leaves = visibleLeaves === 2 ? 2 : 1;
    if (!chat?.clientWidth || !chat.clientHeight) return { stride: 0, pages: 0, visibleLeaves: leaves };

    const gap = Number.parseFloat(chat.ownerDocument.defaultView.getComputedStyle(chat).columnGap) || 0;
    const stride = (chat.clientWidth + gap) / leaves;
    const messages = readerMessages(chat);
    if (!messages.length) return { stride, pages: 0, visibleLeaves: leaves };

    // The final generated column provides room to left-align an odd last spread.
    const pagesFromWidth = Math.round((chat.scrollWidth + gap) / stride) - 1;
    const locate = pageLocator(chat, stride);
    const lastRects = messages[messages.length - 1].getClientRects();
    const lastPage = lastRects.length ? locate(lastRects[lastRects.length - 1]) : 0;
    return { stride, pages: Math.max(pagesFromWidth, lastPage + 1), visibleLeaves: leaves };
}

export function readerPageOffset(layout, pageIndex) {
    const page = clampPage(layout, pageIndex);
    return Math.floor(page / layout.visibleLeaves) * layout.visibleLeaves * layout.stride;
}

function firstMessagePage(message, locate) {
    const rect = message?.getClientRects()[0];
    return rect ? locate(rect) : null;
}

export function findReaderFloorPage(chat, layout, mesid) {
    if (!layout.pages || !layout.stride || mesid == null) return null;

    const message = Array.from(readerMessages(chat)).find(floor => floor.getAttribute('mesid') === String(mesid));
    const page = firstMessagePage(message, pageLocator(chat, layout.stride));
    return page == null ? null : clampPage(layout, page);
}

function firstTextOnPage(message, page, locate) {
    const document = message.ownerDocument;
    const root = message.querySelector('.mes_text') ?? message;
    const walker = document.createTreeWalker(root, document.defaultView.NodeFilter.SHOW_TEXT);
    const range = document.createRange();

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.data.trim()) continue;
        range.selectNodeContents(node);
        const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0);
        const firstRectOnPage = rects.findIndex(rect => locate(rect) === page);
        if (firstRectOnPage < 0) continue;
        if (firstRectOnPage === 0) return { node, offset: 0 };

        // A single text node can span many leaves. Search prefixes to find
        // the first character that reaches this leaf without visiting each glyph.
        let start = 1;
        let end = node.length;
        while (start < end) {
            const middle = Math.floor((start + end) / 2);
            range.setEnd(node, middle);
            const reachesPage = Array.from(range.getClientRects()).some(rect => rect.width > 0 && locate(rect) >= page);
            if (reachesPage) end = middle;
            else start = middle + 1;
        }
        return { node, offset: start - 1 };
    }

    return null;
}

export function captureReaderAnchor(chat, layout, pageIndex) {
    if (!layout.pages || !layout.stride) return null;

    const page = clampPage(layout, pageIndex);
    const locate = pageLocator(chat, layout.stride);
    let nearest = null;
    let distance = Infinity;
    for (const message of readerMessages(chat)) {
        const rects = Array.from(message.getClientRects());
        if (!rects.length) continue;
        const candidate = { message, node: null, offset: 0, mesid: message.getAttribute('mesid'), page };

        for (const rect of rects) {
            const gap = Math.abs(locate(rect) - page);
            if (gap < distance) {
                nearest = candidate;
                distance = gap;
            }
        }

        if (rects.some(rect => locate(rect) === page)) {
            const text = firstTextOnPage(message, page, locate);
            if (text) return { ...candidate, ...text };
        }
    }

    return nearest;
}

export function resolveReaderAnchor(chat, layout, anchor) {
    if (!layout.pages || !layout.stride || !anchor) return 0;

    const { message, node } = anchor;
    const locate = pageLocator(chat, layout.stride);
    if (message?.parentElement === chat) {
        if (node?.length && message.contains(node)) {
            const range = chat.ownerDocument.createRange();
            const offset = Math.max(0, Math.min(node.length - 1, anchor.offset));
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            const rect = Array.from(range.getClientRects()).find(fragment => fragment.width > 0);
            if (rect) return clampPage(layout, locate(rect));
        }

        const page = firstMessagePage(message, locate);
        if (page != null) return clampPage(layout, page);
    }

    return findReaderFloorPage(chat, layout, anchor.mesid) ?? clampPage(layout, anchor.page);
}
