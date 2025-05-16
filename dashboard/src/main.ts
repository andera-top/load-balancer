type DashboardWorker = {
  url: string
  group?: string
  contract?: string
  status?: string
  slots?: { used: number; limit: number; queue?: number }
  tags?: { name: string; value: string }[]
  system?: {
    cpuLoad: number
    usedMemoryPercent: number
  }
  websocketPort?: number
  functions?: { name: string; params: any }[]
}

async function fetchWorkers(): Promise<DashboardWorker[]> {
  const res = await fetch('/dashboard/api/workers')
  return res.json()
}

function getStatusClass(worker: DashboardWorker): string {
  if (worker.status === 'ready' && worker.slots && worker.slots.used >= worker.slots.limit) return 'status-saturated'
  if (worker.status === 'ready') return 'status-ready'
  if (worker.status === 'error') return 'status-error'
  return 'status-offline'
}

let selectedWorker: DashboardWorker | null = null
let workerLogs: string = ''
let refreshPaused = false
let refreshInterval: number | undefined

function closeDrawer() {
  const drawer = document.getElementById('worker-drawer')
  const overlay = document.getElementById('drawer-overlay')
  if (drawer) {
    drawer.classList.remove('drawer-open')
    setTimeout(() => {
      drawer.style.display = 'none'
    }, 350)
  }
  if (overlay) overlay.style.display = 'none'
  selectedWorker = null
  workerLogs = ''
}

async function openDrawer(worker: DashboardWorker) {
  selectedWorker = worker
  const encodedUrl = encodeURIComponent(worker.url)
  workerLogs = 'Loading...'
  renderDrawer()
  const drawer = document.getElementById('worker-drawer')
  if (drawer) {
    drawer.style.display = 'block'
    drawer.classList.remove('drawer-open')
    void drawer.offsetHeight
    drawer.classList.add('drawer-open')
  }
  const res = await fetch(`/dashboard/api/workers/${encodedUrl}/logs`)
  if (res.ok) {
    const data = await res.json()
    workerLogs = typeof data === 'string' ? data : data.logs || JSON.stringify(data, null, 2)
  } else {
    workerLogs = 'Failed to fetch logs.'
  }
  renderDrawer()
  const drawer2 = document.getElementById('worker-drawer')
  if (drawer2) drawer2.classList.add('drawer-open')
}

function renderDrawer() {
  let drawer = document.getElementById('worker-drawer') as HTMLElement | null
  let overlay = document.getElementById('drawer-overlay') as HTMLElement | null
  if (!drawer) {
    drawer = document.createElement('div')
    drawer.id = 'worker-drawer'
    drawer.innerHTML = '<div class="drawer-content"></div>'
    document.body.appendChild(drawer)
  }
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = 'drawer-overlay'
    overlay.className = 'drawer-overlay'
    overlay.onclick = closeDrawer
    document.body.appendChild(overlay)
  }
  if (!selectedWorker) {
    drawer.style.display = 'none'
    overlay.style.display = 'none'
    drawer.classList.remove('drawer-open')
    return
  }
  drawer.style.display = 'block'
  overlay.style.display = 'block'
  drawer.classList.add('drawer-open')
  const content = drawer.querySelector('.drawer-content') as HTMLElement
  if (content) {
    content.innerHTML = `
      <button class="drawer-close" onclick="window.closeDrawer()">×</button>
      <div class="drawer-section terminal-section">
        <h3>Contract (V${selectedWorker.contract || '?'})</h3>
        <pre>${selectedWorker.functions ? JSON.stringify(selectedWorker.functions, null, 2) : '-'}</pre>
      </div>
      <div class="drawer-section terminal-section">
        <h3>Logs</h3>
        <pre>${
          Array.isArray(workerLogs)
            ? workerLogs.join('\n').trim()
            : typeof workerLogs === 'string'
              ? workerLogs.replace(/\\n|\\r\\n/g, '\n').trim()
              : workerLogs
        }</pre>
      </div>
    `
  }
}

;(window as any).closeDrawer = closeDrawer

function renderWorkersList(workers: DashboardWorker[]): void {
  const el = document.getElementById('workers') as HTMLElement | null
  if (!el) return
  if (!workers.length) {
    el.innerHTML = '<p>No workers found.</p>'
    return
  }
  let html = ''
  for (const w of workers) {
    let tags: { name: string; value: string }[] = []
    if (Array.isArray(w.tags)) {
      if (w.tags.length && w.tags.every(tag => typeof tag === 'string')) {
        tags = (w.tags as string[]).map(t => ({ name: t, value: '' }))
      } else {
        tags = w.tags as { name: string; value: string }[]
      }
    } else if (w.tags && typeof w.tags === 'object') {
      tags = Object.entries(w.tags).map(([name, value]) => ({ name, value: String(value) }))
    }
    const urlObj = new URL(w.url)
    const httpUrl = `${urlObj.protocol}//${urlObj.hostname}${urlObj.port ? ':' + urlObj.port : ''}`
    const wsProtocol = urlObj.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsPort = w.websocketPort || urlObj.port
    const wsUrl = `${wsProtocol}//${urlObj.hostname}${wsPort ? ':' + wsPort : ''}`
    html += `<li class="worker-item" data-url="${encodeURIComponent(w.url)}">
      <div class="worker-header">
        <h2><span class="group ${getStatusClass(w)}">${w.group || '-'}</span><span class="version">(V${w.contract || '?'})</span></h2>
        <div class="worker-urls">
          <div>Host: <span class="worker-url" title="${w.url}">${httpUrl}</span></div>
          <div>WebSockets: <span class="worker-ws-url">${wsUrl}</span></div>
        </div>
      </div>`
    if (tags.length) {
      html += `<div class="worker-tags">
        ${tags.map(t => `<span class='worker-tag'>${t.name}${t.value ? ': ' + t.value : ''}</span>`).join('')}
      </div>`
    }
    if (Array.isArray((w as any).services) && (w as any).services.length > 0) {
      html += `<div class="worker-services">
        ${((w as any).services as any[]).map(s => `<span class="worker-service"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle;background:${s.state === 'up' ? '#40b08c' : '#b3243e'}"></span>${s.name}</span>`).join('')}
      </div>`
    }
    html += `<ul class="worker-stats">
      <li>Slots<strong>${w.slots?.used ?? '-'}/${w.slots?.limit ?? '-'}</strong></li>
      <li>Queue<strong>${w.slots?.queue ?? '-'}</strong></li>
      <li>CPU<strong>${w.system && typeof w.system.cpuLoad === 'number' ? Math.round(w.system.cpuLoad * 100) + '%' : '-'}</strong></li>
      <li>Memory<strong>${w.system && typeof w.system.usedMemoryPercent === 'number' ? Math.round(w.system.usedMemoryPercent) + '%' : '-'}</strong></li>
      </ul>
    </li>`
  }
  el.innerHTML = html
  Array.from(el.querySelectorAll('li[data-url]')).forEach((card: Element) => {
    card.addEventListener('click', () => {
      const url = card.getAttribute('data-url')
      const worker = workers.find(w => encodeURIComponent(w.url) === url)
      if (worker) openDrawer(worker)
    })
  })
}

async function showWorkerLogs(encodedUrl: string): Promise<void> {
  console.log(`Fetching logs for ${decodeURIComponent(encodedUrl)}`)
}

function pauseRefresh() {
  refreshPaused = true
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = undefined
  }
  updatePauseButton()
}

function resumeRefresh() {
  if (!refreshPaused) return
  refreshPaused = false
  refreshDashboard()
  refreshInterval = setInterval(refreshDashboard, 1000) as any
  updatePauseButton()
}

function toggleRefresh() {
  if (refreshPaused) {
    resumeRefresh()
  } else {
    pauseRefresh()
  }
}

function updatePauseButton() {
  const btn = document.getElementById('pause-refresh-btn')
  if (btn) {
    btn.textContent = refreshPaused ? 'Resume Refresh' : 'Pause Refresh'
    btn.className = refreshPaused ? 'paused' : ''
  }
}

window.pauseRefresh = pauseRefresh
window.resumeRefresh = resumeRefresh
window.toggleRefresh = toggleRefresh

window.addEventListener('DOMContentLoaded', () => {
  const header = document.querySelector('header')
  if (header && !document.getElementById('pause-refresh-btn')) {
    const btn = document.createElement('button')
    btn.id = 'pause-refresh-btn'
    btn.textContent = 'Pause Refresh'
    btn.onclick = toggleRefresh
    header.appendChild(btn)
  }
  updatePauseButton()
})

async function refreshDashboard() {
  if (refreshPaused) return
  const workers = await fetchWorkers()
  renderWorkersList(workers)
}

window.onload = async () => {
  await refreshDashboard()
  refreshInterval = setInterval(refreshDashboard, 1000) as any
}
