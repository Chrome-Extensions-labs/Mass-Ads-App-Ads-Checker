/**
 * Shared shape for rows rendered in the results table.
 * @typedef {Object} ScanResult
 * @property {string} domain
 * @property {string} status
 * @property {number} lines
 * @property {string} url
 * @property {"valid"|"empty"|"error"} cssClass
 * @property {{ads: SingleFileResult, appAds: SingleFileResult}} [details]
 *
 * @typedef {Object} SingleFileResult
 * @property {"Valid"|"Empty File"|"Error"} status
 * @property {number} lines
 * @property {string} url
 */

function initPopup() {
  const RATE_WINDOW = 5;

  function clampConcurrency(value) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return 10;
    return Math.min(20, Math.max(1, n));
  }

  function readConcurrency(mode) {
    const stored = localStorage.getItem(`concurrency.${mode}`);
    return clampConcurrency(stored ?? (mode === 'bulk' ? 15 : 10));
  }

  function writeConcurrency(mode, value) {
    localStorage.setItem(`concurrency.${mode}`, String(clampConcurrency(value)));
  }

  function formatDuration(totalSeconds) {
    const sec = Math.max(0, Number(totalSeconds) || 0);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const standardModeBtn = document.getElementById('standardModeBtn');
  const bulkModeBtn = document.getElementById('bulkModeBtn');
  const standardModeView = document.getElementById('standardModeView');
  const bulkModeView = document.getElementById('bulkModeView');
  const standardLoadGroup = document.getElementById('standardLoadGroup');
  const bulkLoadGroup = document.getElementById('bulkLoadGroup');
  const standardConcurrencyWrap = document.getElementById('standardConcurrencyWrap');
  const bulkConcurrencyWrap = document.getElementById('bulkConcurrencyWrap');

  const checkBtn = document.getElementById('checkBtn');
  const stopBtn = document.getElementById('stopBtn');
  const loadFileBtn = document.getElementById('loadFileBtn');
  const loadCsvBtn = document.getElementById('loadCsvBtn');
  const fileInput = document.getElementById('fileInput');
  const csvFileInput = document.getElementById('csvFileInput');
  const downloadBtn = document.getElementById('downloadBtn');
  const domainInput = document.getElementById('domainList');
  const fileTypeSelect = document.getElementById('fileTypeSelect');
  const tableBody = document.querySelector('#resultsTable tbody');
  const domainCountChip = document.getElementById('domainCountChip');
  const standardConcurrencyInput = document.getElementById('standardConcurrencyInput');

  const bulkLoadFileBtn = document.getElementById('bulkLoadFileBtn');
  const bulkFileInput = document.getElementById('bulkFileInput');
  const bulkInputTypeSelect = document.getElementById('bulkInputTypeSelect');
  const bulkFileTypeSelect = document.getElementById('bulkFileTypeSelect');
  const bulkIncludeStatus = document.getElementById('bulkIncludeStatus');
  const bulkCheckBtn = document.getElementById('bulkCheckBtn');
  const bulkStopBtn = document.getElementById('bulkStopBtn');
  const bulkDownloadBtn = document.getElementById('bulkDownloadBtn');
  const bulkDownloadTxtBtn = document.getElementById('bulkDownloadTxtBtn');
  const bulkFileStatus = document.getElementById('bulkFileStatus');
  const bulkProgressValue = document.getElementById('bulkProgressValue');
  const bulkTimeValue = document.getElementById('bulkTimeValue');
  const bulkEtaValue = document.getElementById('bulkEtaValue');
  const bulkConcurrencyInput = document.getElementById('bulkConcurrencyInput');

  const progressBarFill = document.getElementById('progressBarFill');
  const progressMeta = document.getElementById('progressMeta');

  let results = [];
  let isScanning = false;
  let currentTheme = localStorage.getItem('theme') || 'light';
  let modeIndex = 0;

  let fileReadVersion = 0;
  let bulkLines = [];
  let bulkTimerInterval = null;
  let bulkResultsArray = [];

  let batchTimings = [];
  let scanStartTime = 0;
  let scanContext = { total: 0, completed: 0, status: 'Ready', stopping: false, mode: 'standard' };

  standardConcurrencyInput.value = String(readConcurrency('standard'));
  bulkConcurrencyInput.value = String(readConcurrency('bulk'));

  applyTheme(currentTheme);
  setModeByIndex(modeIndex);
  updateDomainCounter();
  updateProgressUI(0, 0, 'Ready', false, 'standard');

  function recordBatchTiming(completed) {
    batchTimings.push({ completed, t: Date.now() });
    if (batchTimings.length > RATE_WINDOW + 1) batchTimings.shift();
  }

  function estimateEtaSeconds(total, completed) {
    if (batchTimings.length < 2 || completed >= total) return 0;
    const first = batchTimings[0];
    const last = batchTimings[batchTimings.length - 1];
    const deltaCompleted = last.completed - first.completed;
    const deltaMs = last.t - first.t;
    if (deltaCompleted <= 0 || deltaMs <= 0) return 0;
    const ratePerMs = deltaCompleted / deltaMs;
    const remaining = total - completed;
    return Math.ceil(remaining / ratePerMs / 1000);
  }

  function resetProgressTracking(mode, total, status) {
    scanStartTime = Date.now();
    batchTimings = [];
    scanContext = { total, completed: 0, status, stopping: false, mode };
    recordBatchTiming(0);
    updateProgressUI(0, total, status, false, mode);
  }

  function updateProgressUI(completed, total, status, stopping = false, mode = 'standard') {
    const elapsedSec = scanStartTime ? Math.floor((Date.now() - scanStartTime) / 1000) : 0;
    const etaSec = estimateEtaSeconds(total, completed);
    const pct = total > 0 ? Math.max(0, Math.min(100, (completed / total) * 100)) : 0;

    progressBarFill.style.width = `${pct}%`;
    progressBarFill.classList.toggle('stopping', Boolean(stopping));
    progressMeta.innerText = `Processed: ${completed} / ${total} · Elapsed: ${formatDuration(elapsedSec)} · ETA: ${formatDuration(etaSec)} · Status: ${status}`;

    if (mode === 'bulk') {
      bulkProgressValue.innerText = `${completed} / ${total}`;
      bulkTimeValue.innerText = formatDuration(elapsedSec);
      bulkEtaValue.innerText = formatDuration(etaSec);
    }
  }

  function updateLiveProgressTick() {
    if (!scanContext.total) return;
    updateProgressUI(scanContext.completed, scanContext.total, scanContext.status, scanContext.stopping, scanContext.mode);
  }

  function updateDomainCounter() {
    const count = domainInput.value.split('\n').map(l => l.trim()).filter(l => l).length;
    domainCountChip.innerText = `${count} ${count === 1 ? 'domain' : 'domains'}`;
  }

  function setModeByIndex(index) {
    fileReadVersion++;
    const standard = index === 0;
    standardModeView.classList.toggle('hidden-view', !standard);
    bulkModeView.classList.toggle('hidden-view', standard);
    standardLoadGroup.classList.toggle('hidden-view', !standard);
    bulkLoadGroup.classList.toggle('hidden-view', standard);
    standardConcurrencyWrap.classList.toggle('hidden-view', !standard);
    bulkConcurrencyWrap.classList.toggle('hidden-view', standard);
    checkBtn.classList.toggle('hidden-view', !standard);
    stopBtn.style.display = 'none';
    bulkCheckBtn.classList.toggle('hidden-view', standard);
    bulkStopBtn.style.display = 'none';

    standardModeBtn.classList.toggle('active', standard);
    bulkModeBtn.classList.toggle('active', !standard);
    standardModeBtn.setAttribute('aria-selected', String(standard));
    bulkModeBtn.setAttribute('aria-selected', String(!standard));
  }

  themeToggleBtn.addEventListener('click', () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', currentTheme);
    applyTheme(currentTheme);
  });

  standardModeBtn.addEventListener('click', () => {
    if (isScanning) return;
    modeIndex = 0;
    setModeByIndex(modeIndex);
  });

  bulkModeBtn.addEventListener('click', () => {
    if (isScanning) return;
    modeIndex = 1;
    setModeByIndex(modeIndex);
  });

  standardConcurrencyInput.addEventListener('change', () => {
    const value = clampConcurrency(standardConcurrencyInput.value);
    standardConcurrencyInput.value = String(value);
    writeConcurrency('standard', value);
  });

  standardConcurrencyInput.addEventListener('blur', () => {
    const value = clampConcurrency(standardConcurrencyInput.value);
    standardConcurrencyInput.value = String(value);
    writeConcurrency('standard', value);
  });

  bulkConcurrencyInput.addEventListener('change', () => {
    const value = clampConcurrency(bulkConcurrencyInput.value);
    bulkConcurrencyInput.value = String(value);
    writeConcurrency('bulk', value);
  });

  bulkConcurrencyInput.addEventListener('blur', () => {
    const value = clampConcurrency(bulkConcurrencyInput.value);
    bulkConcurrencyInput.value = String(value);
    writeConcurrency('bulk', value);
  });

  domainInput.addEventListener('input', updateDomainCounter);

  loadFileBtn.addEventListener('click', () => fileInput.click());
  loadCsvBtn.addEventListener('click', () => csvFileInput.click());

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    const readVersion = ++fileReadVersion;
    reader.onerror = () => {
      if (readVersion === fileReadVersion && !isScanning) {
        updateProgressUI(0, 0, 'Could not read file', false, modeIndex ? 'bulk' : 'standard');
      }
      e.target.value = '';
    };
    reader.onload = (event) => {
      if (readVersion !== fileReadVersion || isScanning) return;
      domainInput.value = event.target.result;
      updateDomainCounter();
      const count = domainInput.value.split('\n').map(l => l.trim()).filter(l => l).length;
      updateProgressUI(0, 0, `Loaded ${count} domains from file`, false, 'standard');
      fileInput.value = '';
    };
    reader.readAsText(file);
  });

  csvFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    const readVersion = ++fileReadVersion;
    reader.onerror = () => {
      if (readVersion === fileReadVersion && !isScanning) {
        updateProgressUI(0, 0, 'Could not read file', false, modeIndex ? 'bulk' : 'standard');
      }
      e.target.value = '';
    };
    reader.onload = (event) => {
      if (readVersion !== fileReadVersion || isScanning) return;
      const domains = csvInputs(String(event.target.result || ''));
      domainInput.value = domains.join('\n');
      updateDomainCounter();
      updateProgressUI(0, 0, `Loaded ${domains.length} domains from CSV`, false, 'standard');
      csvFileInput.value = '';
    };
    reader.readAsText(file);
  });

  stopBtn.addEventListener('click', () => {
    scanContext.status = 'Stopping after active requests';
    scanContext.stopping = true;
    updateLiveProgressTick();
    stopBtn.disabled = true;
  });

  async function runQueue(items, concurrency, fileType, onResult) {
    let next = 0;
    async function worker() {
      while (!scanContext.stopping && next < items.length) {
        const index = next++;
        const result = await checkDomainSmart(items[index], fileType);
        onResult(result, index);
        scanContext.completed++;
        recordBatchTiming(scanContext.completed);
        updateLiveProgressTick();
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  }

  async function handleCheckClick() {
    const text = domainInput.value;
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    const fileType = fileTypeSelect.value;

    if (lines.length === 0) {
      updateProgressUI(0, 0, 'List is empty!', false, 'standard');
      return;
    }

    const batchSize = clampConcurrency(readConcurrency('standard'));
    standardConcurrencyInput.value = String(batchSize);
    writeConcurrency('standard', batchSize);

    fileReadVersion++;
    isScanning = true;
    results = [];
    tableBody.innerHTML = '';
    downloadBtn.style.display = 'none';

    checkBtn.style.display = 'none';
    stopBtn.style.display = 'block';
    stopBtn.disabled = false;
    standardModeBtn.disabled = true;
    bulkModeBtn.disabled = true;
    loadFileBtn.disabled = true;
    loadCsvBtn.disabled = true;
    domainInput.disabled = true;
    fileTypeSelect.disabled = true;
    standardConcurrencyInput.disabled = true;

    resetProgressTracking('standard', lines.length, 'Processing');
    const progressTimer = setInterval(updateLiveProgressTick, 1000);
    await runQueue(lines, batchSize, fileType, (result) => {
      addResultToTable(result, tableBody);
      results.push(result);
    });
    const completed = scanContext.completed;
    clearInterval(progressTimer);

    const completedAll = completed === lines.length && scanContext.status !== 'Stopped by user';
    if (completedAll) {
      scanContext.status = 'Completed';
      scanContext.stopping = false;
      updateProgressUI(lines.length, lines.length, 'Completed', false, 'standard');
    } else {
      scanContext.status = 'Stopped by user';
      updateProgressUI(completed, lines.length, scanContext.status, true, 'standard');
    }

    isScanning = false;
    standardModeBtn.disabled = false;
    bulkModeBtn.disabled = false;
    checkBtn.style.display = 'block';
    stopBtn.style.display = 'none';
    loadFileBtn.disabled = false;
    loadCsvBtn.disabled = false;
    domainInput.disabled = false;
    fileTypeSelect.disabled = false;
    standardConcurrencyInput.disabled = false;

    if (results.length > 0) downloadBtn.style.display = 'inline-flex';
  }

  function handleDownloadClick() {
    let csv = 'File URL,Status,Lines\n';
    results.forEach(r => {
      const urlForCsv = r.url !== '-' ? r.url : r.domain;
      csv += [urlForCsv, r.status, r.lines].map(escapeCsvCell).join(',') + '\n';
    });
    triggerDownload(csv, 'checker_results.csv');
  }

  checkBtn.addEventListener('click', handleCheckClick);
  downloadBtn.addEventListener('click', handleDownloadClick);

  function updateBulkInputAccept() {
    const type = bulkInputTypeSelect.value;
    bulkFileInput.setAttribute('accept', type === 'csv' ? '.csv' : '.txt');
  }

  function resetBulkLoadState() {
    bulkLines = [];
    bulkCheckBtn.disabled = true;
    bulkDownloadBtn.style.display = 'none';
    bulkDownloadTxtBtn.style.display = 'none';
    bulkResultsArray = [];
    bulkFileStatus.innerText = 'No file selected';
    bulkProgressValue.innerText = '0 / 0';
    bulkTimeValue.innerText = '00:00';
    bulkEtaValue.innerText = '00:00';
    bulkFileInput.value = '';
  }

  bulkInputTypeSelect.addEventListener('change', () => {
    fileReadVersion++;
    updateBulkInputAccept();
    resetBulkLoadState();
  });

  bulkLoadFileBtn.addEventListener('click', () => {
    updateBulkInputAccept();
    bulkFileInput.click();
  });

  bulkFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    const readVersion = ++fileReadVersion;
    reader.onerror = () => {
      if (readVersion === fileReadVersion && !isScanning) {
        updateProgressUI(0, 0, 'Could not read file', false, modeIndex ? 'bulk' : 'standard');
      }
      e.target.value = '';
    };
    reader.onload = (event) => {
      if (readVersion !== fileReadVersion || isScanning) return;
      const selectedInputType = bulkInputTypeSelect.value;

      if (selectedInputType === 'csv') {
        bulkLines = csvInputs(String(event.target.result || ''));
      } else {
        bulkLines = String(event.target.result || '').split(/\r\n|\n|\r/).map(line => line.trim()).filter(Boolean);
      }

      bulkFileStatus.innerText = `File loaded: ${bulkLines.length} domains ready.`;
      bulkProgressValue.innerText = `0 / ${bulkLines.length}`;
      bulkTimeValue.innerText = '00:00';
      bulkEtaValue.innerText = '00:00';
      bulkCheckBtn.disabled = bulkLines.length === 0;
      bulkDownloadBtn.style.display = 'none';
      bulkDownloadTxtBtn.style.display = 'none';
      bulkFileInput.value = '';
      updateProgressUI(0, bulkLines.length, 'Ready', false, 'bulk');
    };

    reader.readAsText(file);
  });

  function buildBulkHeader(checkType, includeStatus) {
    if (checkType === 'both') {
      if (includeStatus) {
        return 'Domain,ads.txt Status,app-ads.txt Status';
      }
      return 'Domain,ads.txt Lines,app-ads.txt Lines';
    }

    if (includeStatus) {
      return 'File URL,Status';
    }
    return 'File URL,Lines';
  }

  bulkStopBtn.addEventListener('click', () => {
    scanContext.status = 'Stopping after active requests';
    scanContext.stopping = true;
    updateLiveProgressTick();
    bulkStopBtn.disabled = true;
  });

  async function handleBulkCheckClick() {
    const fileType = bulkFileTypeSelect.value;
    const total = bulkLines.length;
    const includeStatus = bulkIncludeStatus.checked;

    if (total === 0) return;

    const batchSize = clampConcurrency(readConcurrency('bulk'));
    bulkConcurrencyInput.value = String(batchSize);
    writeConcurrency('bulk', batchSize);

    fileReadVersion++;
    isScanning = true;
    bulkResultsArray = [buildBulkHeader(fileType, includeStatus)];
    bulkDownloadBtn.style.display = 'none';
    bulkDownloadTxtBtn.style.display = 'none';

    bulkCheckBtn.style.display = 'none';
    bulkStopBtn.style.display = 'block';
    bulkStopBtn.disabled = false;
    standardModeBtn.disabled = true;
    bulkModeBtn.disabled = true;
    bulkLoadFileBtn.disabled = true;
    bulkInputTypeSelect.disabled = true;
    bulkFileTypeSelect.disabled = true;
    bulkIncludeStatus.disabled = true;
    bulkConcurrencyInput.disabled = true;
    fileTypeSelect.disabled = true;

    bulkFileStatus.innerText = 'Processing...';

    resetProgressTracking('bulk', total, 'Processing');
    bulkTimerInterval = setInterval(updateLiveProgressTick, 1000);

    await runQueue(bulkLines, batchSize, fileType, (res, index) => {
      if (fileType === 'both') {
        // Read structured sub-results directly instead of regex-parsing the
        // human-readable status string back into fields.
        const normalized = normalizeDomain(res.domain);
        const rowDomain = normalized || res.domain;
        const adsResult = res.details && res.details.ads
          ? res.details.ads
          : { status: 'Error', lines: 0, url: '-' };
        const appAdsResult = res.details && res.details.appAds
          ? res.details.appAds
          : { status: 'Error', lines: 0, url: '-' };

        if (includeStatus) {
          bulkResultsArray[index + 1] = (
            [
              escapeCsvCell(rowDomain),
              escapeCsvCell(adsResult.status),
              escapeCsvCell(appAdsResult.status)
            ].join(',')
          );
        } else {
          bulkResultsArray[index + 1] = (
            [
              escapeCsvCell(rowDomain),
              adsResult.lines,
              appAdsResult.lines
            ].join(',')
          );
        }
      } else {
        const urlForCsv = res.url !== '-' ? res.url : res.domain;
        if (includeStatus) {
          bulkResultsArray[index + 1] = `${escapeCsvCell(urlForCsv)},${escapeCsvCell(res.status)}`;
        } else {
          bulkResultsArray[index + 1] = `${escapeCsvCell(urlForCsv)},${res.lines}`;
        }
      }

    });
    bulkResultsArray = bulkResultsArray.filter(row => row !== undefined);
    const completed = scanContext.completed;

    clearInterval(bulkTimerInterval);
    bulkTimerInterval = null;

    const completedAll = completed === total && scanContext.status !== 'Stopped by user';
    if (completedAll) {
      bulkFileStatus.innerText = 'Completed successfully!';
      scanContext.status = 'Completed';
      scanContext.stopping = false;
      updateProgressUI(total, total, 'Completed', false, 'bulk');
    } else {
      bulkFileStatus.innerText = 'Stopped by user.';
      scanContext.status = 'Stopped by user';
      updateProgressUI(completed, total, scanContext.status, true, 'bulk');
    }

    isScanning = false;
    standardModeBtn.disabled = false;
    bulkModeBtn.disabled = false;
    bulkCheckBtn.style.display = 'block';
    bulkStopBtn.style.display = 'none';
    bulkLoadFileBtn.disabled = false;
    bulkInputTypeSelect.disabled = false;
    bulkFileTypeSelect.disabled = false;
    bulkIncludeStatus.disabled = false;
    bulkConcurrencyInput.disabled = false;
    fileTypeSelect.disabled = false;

    if (bulkResultsArray.length > 1) {
      bulkDownloadBtn.style.display = 'inline-flex';
      bulkDownloadTxtBtn.style.display = 'inline-flex';
    }
  }

  bulkCheckBtn.addEventListener('click', handleBulkCheckClick);

  bulkDownloadBtn.addEventListener('click', () => {
    const csvContent = bulkResultsArray.join('\n');
    triggerDownload(csvContent, 'bulk_checker_results.csv');
  });

  bulkDownloadTxtBtn.addEventListener('click', () => {
    const txtContent = bulkResultsArray.join('\n');
    triggerDownload(txtContent, 'bulk_checker_results.txt');
  });

  function triggerDownload(content, filename) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function checkDomainSmart(rawDomain, fileType) {
    if (fileType === 'url') {
      const parsed = parseHttpUrl(rawDomain);
      const single = parsed ? await probeUrl(parsed.href) : null;
      return {
        domain: rawDomain,
        status: single ? single.status : 'Error',
        lines: single ? single.lines : 0,
        url: single ? single.url : '-',
        cssClass: single ? (single.lines ? 'valid' : 'empty') : 'error'
      };
    }

    const normalizedDomain = normalizeDomain(rawDomain);

    if (!normalizedDomain) {
      return {
        domain: rawDomain,
        status: 'Error',
        lines: 0,
        url: '-',
        cssClass: 'error'
      };
    }

    if (fileType === 'both') {
      const [adsSettled, appAdsSettled] = await Promise.allSettled([
        checkSingleFile(normalizedDomain, 'ads.txt'),
        checkSingleFile(normalizedDomain, 'app-ads.txt')
      ]);

      const adsResult = adsSettled.status === 'fulfilled' ? adsSettled.value : { status: 'Error', lines: 0, url: '-' };
      const appAdsResult = appAdsSettled.status === 'fulfilled' ? appAdsSettled.value : { status: 'Error', lines: 0, url: '-' };

      const status = `ads: ${adsResult.status}${adsResult.status === 'Valid' ? ` (${adsResult.lines})` : ''} / app-ads: ${appAdsResult.status}${appAdsResult.status === 'Valid' ? ` (${appAdsResult.lines})` : ''}`;
      const totalLines = adsResult.lines + appAdsResult.lines;

      let cssClass = 'error';
      if (adsResult.status === 'Valid' || appAdsResult.status === 'Valid') {
        cssClass = 'valid';
      } else if (adsResult.status === 'Empty File' && appAdsResult.status === 'Empty File') {
        cssClass = 'empty';
      }

      const resolvedUrl = adsResult.url !== '-' ? adsResult.url : (appAdsResult.url !== '-' ? appAdsResult.url : '-');

      // Expose structured sub-results so callers don't have to parse `status`.
      return {
        domain: rawDomain,
        status,
        lines: totalLines,
        url: resolvedUrl,
        cssClass,
        details: { ads: adsResult, appAds: appAdsResult }
      };
    }

    const single = await checkSingleFile(normalizedDomain, fileType);

    return {
      domain: rawDomain,
      status: single.status,
      lines: single.lines,
      url: single.url,
      cssClass: single.status === 'Valid' ? 'valid' : (single.status === 'Empty File' ? 'empty' : 'error')
    };
  }

  function addResultToTable(res, tableBodyElement) {
    const row = document.createElement('tr');
    const urlCell = document.createElement('td');
    urlCell.className = 'col-url';
    const urlContent = document.createElement(res.url !== '-' ? 'a' : 'span');
    if (res.url !== '-') {
      urlContent.href = res.url;
      urlContent.target = '_blank';
      urlContent.rel = 'noopener noreferrer';
    } else {
      urlContent.className = 'domain-fallback';
    }
    urlContent.textContent = res.url !== '-' ? res.url : res.domain;
    urlCell.appendChild(urlContent);

    const statusCell = document.createElement('td');
    statusCell.className = 'col-status';
    const badge = document.createElement('span');
    badge.className = `status-badge ${res.cssClass}`;
    badge.textContent = res.status;
    statusCell.appendChild(badge);

    const linesCell = document.createElement('td');
    linesCell.className = 'col-lines';
    linesCell.textContent = String(res.lines);
    row.append(urlCell, statusCell, linesCell);
    tableBodyElement.appendChild(row);
  }

  function applyTheme(theme) {
    document.body.classList.toggle('dark', theme === 'dark');
  }
}

document.addEventListener('DOMContentLoaded', initPopup);
