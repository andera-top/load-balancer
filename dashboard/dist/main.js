"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
function escapeHtml(value) {
    return String(value !== null && value !== void 0 ? value : '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function fetchWorkers() {
    return __awaiter(this, void 0, void 0, function* () {
        const res = yield fetch('/dashboard/api/workers');
        if (!res.ok)
            throw new Error('Unable to load Workers');
        return res.json();
    });
}
function getStatusClass(worker) {
    if (worker.status === 'ready' && worker.slots && worker.slots.used >= worker.slots.limit)
        return 'status-saturated';
    if (worker.status === 'ready')
        return 'status-ready';
    if (worker.status === 'error')
        return 'status-error';
    return 'status-offline';
}
let selectedWorker = null;
let workerLogs = '';
let refreshPaused = false;
let refreshInterval;
function closeDrawer() {
    const drawer = document.getElementById('worker-drawer');
    const overlay = document.getElementById('drawer-overlay');
    if (drawer) {
        drawer.classList.remove('drawer-open');
        setTimeout(() => {
            if (!selectedWorker)
                drawer.style.display = 'none';
        }, 350);
    }
    if (overlay)
        overlay.style.display = 'none';
    selectedWorker = null;
    workerLogs = '';
}
function openDrawer(worker) {
    return __awaiter(this, void 0, void 0, function* () {
        selectedWorker = worker;
        const encodedUrl = btoa(worker.url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        workerLogs = 'Loading...';
        renderDrawer();
        const drawer = document.getElementById('worker-drawer');
        if (drawer) {
            drawer.style.display = 'block';
            drawer.classList.remove('drawer-open');
            void drawer.offsetHeight;
            drawer.classList.add('drawer-open');
        }
        try {
            const res = yield fetch(`/dashboard/api/workers/${encodedUrl}/logs`);
            if (!res.ok)
                throw new Error('Unable to load logs');
            const data = yield res.json();
            if (selectedWorker !== worker)
                return;
            workerLogs = typeof data === 'string' ? data : data.logs || JSON.stringify(data, null, 2);
        }
        catch (_a) {
            if (selectedWorker !== worker)
                return;
            workerLogs = 'Failed to fetch logs.';
        }
        renderDrawer();
        const drawer2 = document.getElementById('worker-drawer');
        if (drawer2)
            drawer2.classList.add('drawer-open');
    });
}
function renderDrawer() {
    let drawer = document.getElementById('worker-drawer');
    let overlay = document.getElementById('drawer-overlay');
    if (!drawer) {
        drawer = document.createElement('div');
        drawer.id = 'worker-drawer';
        drawer.innerHTML = '<div class="drawer-content"></div>';
        document.body.appendChild(drawer);
    }
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'drawer-overlay';
        overlay.className = 'drawer-overlay';
        overlay.onclick = closeDrawer;
        document.body.appendChild(overlay);
    }
    if (!selectedWorker) {
        drawer.style.display = 'none';
        overlay.style.display = 'none';
        drawer.classList.remove('drawer-open');
        return;
    }
    drawer.style.display = 'block';
    overlay.style.display = 'block';
    drawer.classList.add('drawer-open');
    const content = drawer.querySelector('.drawer-content');
    if (content) {
        content.innerHTML = `
      <button class="drawer-close" onclick="window.closeDrawer()">×</button>
      <div class="drawer-section terminal-section">
        <h3>Contract (V${escapeHtml(selectedWorker.contract || '?')})</h3>
        <pre>${escapeHtml(selectedWorker.functions ? JSON.stringify(selectedWorker.functions, null, 2) : '-')}</pre>
      </div>
      <div class="drawer-section terminal-section">
        <h3>Logs</h3>
        <pre>${escapeHtml(Array.isArray(workerLogs)
            ? workerLogs.join('\n').trim()
            : typeof workerLogs === 'string'
                ? workerLogs.replace(/\\n|\\r\\n/g, '\n').trim()
                : workerLogs)}</pre>
      </div>
    `;
    }
}
;
window.closeDrawer = closeDrawer;
function renderWorkersList(workers) {
    var _a, _b, _c, _d, _e, _f;
    const el = document.getElementById('workers');
    if (!el)
        return;
    if (!workers.length) {
        el.innerHTML = '<p>No workers found.</p>';
        return;
    }
    let html = '';
    for (const w of workers) {
        let tags = [];
        if (Array.isArray(w.tags)) {
            if (w.tags.length && w.tags.every(tag => typeof tag === 'string')) {
                tags = w.tags.map(t => ({ name: t, value: '' }));
            }
            else {
                tags = w.tags;
            }
        }
        else if (w.tags && typeof w.tags === 'object') {
            tags = Object.entries(w.tags).map(([name, value]) => ({ name, value: String(value) }));
        }
        let httpUrl = w.url;
        let wsUrl = '-';
        try {
            const urlObj = new URL(w.url);
            httpUrl = `${urlObj.protocol}//${urlObj.hostname}${urlObj.port ? ':' + urlObj.port : ''}`;
            const wsProtocol = urlObj.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsPort = w.websocketPort || urlObj.port;
            wsUrl = `${wsProtocol}//${urlObj.hostname}${wsPort ? ':' + wsPort : ''}`;
        }
        catch (_g) { }
        html += `<li class="worker-item" data-url="${escapeHtml(encodeURIComponent(w.url))}">
      <div class="worker-header">
        <h2><span class="group ${getStatusClass(w)}">${escapeHtml(w.group || '-')}</span><span class="version">(V${escapeHtml(w.contract || '?')})</span></h2>
        <div class="worker-urls">
          <div>Host: <span class="worker-url" title="${escapeHtml(w.url)}">${escapeHtml(httpUrl)}</span></div>
          <div>WebSockets: <span class="worker-ws-url">${escapeHtml(wsUrl)}</span></div>
        </div>
      </div>`;
        if (tags.length) {
            html += `<div class="worker-tags">
        ${tags.map(t => `<span class='worker-tag'>${escapeHtml(t.name)}${escapeHtml(t.value ? ': ' + t.value : '')}</span>`).join('')}
      </div>`;
        }
        if (Array.isArray(w.services) && w.services.length > 0) {
            html += `<div class="worker-services">
        ${w.services.map(s => `<span class="worker-service"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle;background:${s.state === 'up' ? '#40b08c' : '#b3243e'}"></span>${escapeHtml(s.name)}</span>`).join('')}
      </div>`;
        }
        html += `<ul class="worker-stats">
      <li>Slots<strong>${escapeHtml((_b = (_a = w.slots) === null || _a === void 0 ? void 0 : _a.used) !== null && _b !== void 0 ? _b : '-')}/${escapeHtml((_d = (_c = w.slots) === null || _c === void 0 ? void 0 : _c.limit) !== null && _d !== void 0 ? _d : '-')}</strong></li>
      <li>Queue<strong>${escapeHtml((_f = (_e = w.slots) === null || _e === void 0 ? void 0 : _e.queue) !== null && _f !== void 0 ? _f : '-')}</strong></li>
      <li>CPU<strong>${w.system && typeof w.system.cpuLoad === 'number' ? Math.round(w.system.cpuLoad * 100) + '%' : '-'}</strong></li>
      <li>Memory<strong>${w.system && typeof w.system.usedMemoryPercent === 'number' ? Math.round(w.system.usedMemoryPercent) + '%' : '-'}</strong></li>
      </ul>
    </li>`;
    }
    el.innerHTML = html;
    Array.from(el.querySelectorAll('li[data-url]')).forEach((card) => {
        card.addEventListener('click', () => {
            const url = card.getAttribute('data-url');
            const worker = workers.find(w => encodeURIComponent(w.url) === url);
            if (worker)
                openDrawer(worker);
        });
    });
}
function showWorkerLogs(encodedUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`Fetching logs for ${decodeURIComponent(encodedUrl)}`);
    });
}
function pauseRefresh() {
    refreshPaused = true;
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = undefined;
    }
    updatePauseButton();
}
function resumeRefresh() {
    if (!refreshPaused)
        return;
    refreshPaused = false;
    refreshDashboard();
    refreshInterval = setInterval(refreshDashboard, 1000);
    updatePauseButton();
}
function toggleRefresh() {
    if (refreshPaused) {
        resumeRefresh();
    }
    else {
        pauseRefresh();
    }
}
function updatePauseButton() {
    const btn = document.getElementById('pause-refresh-btn');
    if (btn) {
        btn.textContent = refreshPaused ? 'Resume Refresh' : 'Pause Refresh';
        btn.className = refreshPaused ? 'paused' : '';
    }
}
;
window.pauseRefresh = pauseRefresh;
window.resumeRefresh = resumeRefresh;
window.toggleRefresh = toggleRefresh;
window.addEventListener('DOMContentLoaded', () => {
    const header = document.querySelector('header');
    if (header && !document.getElementById('pause-refresh-btn')) {
        const btn = document.createElement('button');
        btn.id = 'pause-refresh-btn';
        btn.textContent = 'Pause Refresh';
        btn.onclick = toggleRefresh;
        header.appendChild(btn);
    }
    updatePauseButton();
});
let dashboardRequestRunning = false;
function refreshDashboard() {
    return __awaiter(this, void 0, void 0, function* () {
        if (refreshPaused || dashboardRequestRunning)
            return;
        dashboardRequestRunning = true;
        try {
            yield Promise.allSettled([fetchWorkers().then(renderWorkersList), refreshMcpPanel()]);
        }
        finally {
            dashboardRequestRunning = false;
        }
    });
}
window.onload = () => __awaiter(void 0, void 0, void 0, function* () {
    yield refreshDashboard();
    refreshInterval = setInterval(refreshDashboard, 1000);
});
let mcpRequestRunning = false;
let previousMcpView = '';
function refreshMcpPanel() {
    return __awaiter(this, void 0, void 0, function* () {
        if (mcpRequestRunning)
            return;
        mcpRequestRunning = true;
        const notice = document.getElementById('mcp-notice');
        try {
            const response = yield fetch('/dashboard/api/mcp', { cache: 'no-store' });
            if (!response.ok)
                throw new Error('Unable to load MCP status');
            const status = yield response.json();
            const details = document.getElementById('mcp-details');
            notice.textContent = '';
            const snapshot = JSON.stringify(status);
            if (snapshot === previousMcpView)
                return;
            previousMcpView = snapshot;
            const endpoint = new URL(status.endpoint, location.origin).href;
            details.innerHTML = `
      <div class="mcp-overview">
        <span class="mcp-badge ${status.enabled ? 'enabled' : ''}">${status.enabled ? 'Enabled' : 'Disabled'}</span>
        <code>${escapeHtml(endpoint)}</code>
        <button id="mcp-copy-endpoint" type="button">Copy endpoint</button>
      </div>
      <p>${escapeHtml(status.transport)} · Bearer token · ${status.toolCount} tools · Synchronous calls</p>
      <div class="mcp-tools">${status.tools.length
                ? status.tools
                    .map(tool => `<span class="mcp-tool ${tool.available ? '' : 'unavailable'}">${escapeHtml(tool.title)} · ${tool.available ? 'Ready' : 'Unavailable'}</span>`)
                    .join('')
                : '<span>No tools are currently exposed.</span>'}</div>
    `;
            document.getElementById('mcp-copy-endpoint').onclick = () => __awaiter(this, void 0, void 0, function* () {
                try {
                    yield navigator.clipboard.writeText(endpoint);
                    notice.textContent = 'Endpoint copied.';
                }
                catch (_a) {
                    notice.textContent = 'Select and copy the endpoint shown above.';
                }
            });
        }
        catch (_a) {
            notice.textContent = 'Unable to refresh MCP status. The displayed information may be out of date.';
        }
        finally {
            mcpRequestRunning = false;
        }
    });
}
