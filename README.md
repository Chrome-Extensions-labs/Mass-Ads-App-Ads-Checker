# Mass Ads & App-Ads Checker

A browser-native logging and validation toolkit for high-volume `ads.txt` / `app-ads.txt` checks with exportable operational diagnostics.

[![Gist](https://img.shields.io/badge/gist.github-version_of_this_repository-DCDCDC?style=for-the-badge&logo=github)](https://gist.github.com/OstinUA/26e4653a2a107fde839467ad21db5e02)

[![Chrome Store](https://img.shields.io/badge/platform-Chrome_Extension-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white)](https://chromewebstore.google.com/search/OstinUA)
[![Chrome Portfolio](https://img.shields.io/badge/Chrome_Web_Store-Portfolio-34A853?style=for-the-badge&logo=google-chrome&logoColor=white)](https://devs-in-exile.pages.dev/extensions)

[![Version](https://img.shields.io/badge/version-2.7.2-30BA8F?style=for-the-badge)](./manifest.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-1f6feb?style=for-the-badge)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-ff9800?style=for-the-badge)](./manifest.json)

> [!NOTE]
> This repository ships as a Chrome Extension focused on AdOps validation workflows. The “logging library” terminology in this README refers to its structured result tracking, status reporting, and CSV observability outputs.

## Table of Contents

- [Features](#features)
- [Tech Stack & Architecture](#tech-stack--architecture)
- [Getting Started](#getting-started)
- [Testing](#testing)
- [Deployment](#deployment)
- [Usage](#usage)
- [Configuration](#configuration)
- [License](#license)
- [Contacts & Community Support](#contacts--community-support)

## Features

- Dashboard-style popup UI with compact Standard/Bulk workflows and clearer control grouping.
- High-throughput batch domain scanning with configurable per-mode concurrency (`1-20`) persisted in `localStorage`.
- Multi-protocol endpoint probing sequence to maximize discovery success:
  - `https://www.<domain>/<fileType>`
  - `https://<domain>/<fileType>`
  - `http://www.<domain>/<fileType>`
  - `http://<domain>/<fileType>`
- Content-type sanity filtering to skip false-positive HTML error pages.
- IAB-centric record parsing that counts only `DIRECT` and `RESELLER` rows as valid.
- Real-time progress telemetry with animated progress bar and rolling ETA (`Processed`, `Elapsed`, `ETA`, `Status`).
- Downloadable CSV report artifact for BI ingestion, spreadsheet QA, or audit handoff.
- Persistent UI personalization via theme state (`light` / `dark`) stored in `localStorage`.
- Browser-side operation model that helps bypass server-side anti-bot behavior that blocks headless scripts.

> [!TIP]
> For very large input lists, split domains into chunks (for example 300-500 domains per run) to reduce browser memory pressure and keep UI interactions responsive.

## Tech Stack & Architecture

### Core Languages, Platform, and Dependencies

- Language: Vanilla JavaScript (ES6+) and HTML/CSS.
- Runtime: Chrome Extension popup context (Manifest V3).
- Network layer: Browser-native `fetch` with `AbortController` timeout protection.
- Persistence: Web Storage API (`localStorage`) for theme preference.
- Export pipeline: `Blob` + object URL download flow for CSV generation.
- External package dependencies: none (zero-install runtime in browser).

### Project Structure

```text
AdOps-Txt-Scanner/
├── manifest.json        # Extension metadata and permissions
├── background.js        # Window/popup launch behavior
├── index.html           # UI markup + CSS theme tokens
├── assets/
│   ├── css/popup.css   # Popup stylesheet and theme tokens
│   └── js/popup.js     # Scanner logic, parsing, progress, CSV export
├── icons/
│   └── icon128.png      # Extension icon asset
├── LICENSE              # MIT license text
└── README.md            # Project documentation
```

### Key Design Decisions

1. Browser-first execution
   - Avoids common server-side HTTP fingerprinting barriers.
   - Keeps the validation loop close to end-user workflows.

2. Deterministic probing strategy
   - Ordered URL fallback reduces false negatives.
   - `https://www.<domain>` is tried first because most public sites canonicalize to the `www` host; trying apex first wastes a roundtrip on every redirect-to-www site.
   - Fast-exit behavior returns immediately on first valid textual response.

3. Lightweight structured logging model
   - Each scan result emits a normalized record:
     - `domain`
     - `status`
     - `lines`
     - `url`
     - `cssClass`
     - `details` (only for `both` mode: structured `ads` and `appAds` sub-results)
   - This schema is mirrored in UI rows and CSV output for consistency.

4. Defensive parsing model
   - Removes BOM artifacts.
   - Strips comments and validates semantic token position.

```mermaid
flowchart TD
    A[Domain Input List] --> B[Batch Scheduler]
    B --> C[URL Probe Strategy]
    C --> D{HTTP 200 + Non-HTML?}
    D -- No --> E[Try Next Variant]
    E --> C
    D -- Yes --> F[Parse Lines]
    F --> G[Count DIRECT/RESELLER]
    G --> H[Result Object]
    H --> I[UI Table Update]
    H --> J[Progress Counter]
    H --> K[CSV Export Buffer]
```

> [!IMPORTANT]
> This extension validates accessibility and basic semantic formatting of seller declarations. It does not verify business authenticity, contractual validity, or financial settlement integrity.

## Getting Started

### Prerequisites

- Google Chrome (current stable recommended).
- Access to `chrome://extensions/`.
- Git (for cloning and updating source).

### Installation

1. Clone the repository:

```bash
git clone https://github.com/<your-org>/AdOps-Txt-Scanner.git
cd AdOps-Txt-Scanner
```

2. Load the extension unpacked:

```text
Chrome -> chrome://extensions/ -> Enable Developer mode -> Load unpacked -> Select AdOps-Txt-Scanner folder
```

3. Open the extension popup and run a smoke check with 2-3 domains.

> [!WARNING]
> Corporate endpoint security products may block non-HTTPS probes. If scans unexpectedly fail, test from a clean browser profile first.

## Testing

This project does not currently include an automated unit/integration test framework. Use the following quality checks:

```bash
# JavaScript syntax validation
node --check assets/js/popup.js

# Validate extension manifest JSON format
python -m json.tool manifest.json > /dev/null

# Optional: inspect pending changes before release
git status --short
```

Manual validation checklist:

1. Load extension in Chrome and confirm popup renders.
2. Toggle `Light` / `Dark` theme and reopen popup to verify persistence.
3. Run scan against known domains with valid `ads.txt` and invalid endpoints.
4. Export CSV and confirm row schema + field ordering.

## Deployment

### Production Packaging

```bash
# From repository root
zip -r adops-txt-scanner.zip manifest.json index.html assets background.js icons LICENSE README.md
```

### CI/CD Integration Guidelines

- Add a pipeline stage for syntax checks (`node --check assets/js/popup.js`).
- Add a JSON lint stage for `manifest.json`.
- Run extension smoke tests in ephemeral Chrome profiles (optional advanced stage).
- Publish signed package through Chrome Web Store release channels (draft -> trusted testers -> public).

### Containerization

Containerization is not required for runtime because the artifact is a browser extension. If needed, use containers only for CI verification steps (linting, packaging, validation scripts).

> [!CAUTION]
> Never commit Web Store private keys, OAuth client secrets, or publishing credentials to this repository.

## Usage

### 1) Initialize a Basic Scan Session

```javascript
// Example invocation model aligned with assets/js/popup.js behavior
const fileType = 'ads.txt';
const domains = ['example.com', 'google.com'];

for (const domain of domains) {
  // checkDomainSmart probes URL variants and returns normalized result payload
  const result = await checkDomainSmart(domain, fileType);
  console.log(result.status, result.lines, result.url);
}
```

### 2) Parse and Count Valid Seller Lines

```javascript
// countValidLines ignores comments and only accepts DIRECT/RESELLER
const content = `
# comment line
google.com, pub-123, DIRECT
example.org, pub-456, RESELLER
`;

const validCount = countValidLines(content);
console.log(validCount); // 2
```

### 3) Export Aggregated Results as CSV

```javascript
let csv = 'File URL,Status,Lines\n';
results.forEach((r) => {
  const rowUrl = r.url !== '-' ? r.url : r.domain;
  csv += `${rowUrl},${r.status},${r.lines}\n`;
});

const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
const url = URL.createObjectURL(blob);
```

## Configuration

### Runtime Options

- `fileTypeSelect`
  - Values: `ads.txt`, `app-ads.txt`, `both`, `url`.
  - Effect: Changes endpoint suffix used in URL probing.

- `concurrency.standard` (`localStorage`)
  - Default: `10` (range `1-20`, clamped on blur and run).
  - Effect: Controls Standard Mode parallel request count.

- `concurrency.bulk` (`localStorage`)
  - Default: `15` (range `1-20`, clamped on blur and run).
  - Effect: Controls Bulk Mode parallel request count.

- Request timeout
  - Current default: `15000` ms using `AbortController` (`REQUEST_TIMEOUT_MS`).
  - Effect: Prevents long-hanging network calls. Tuned to tolerate slow CDNs and HTTP fallback variants without false `Error` rows.

### Environment Variables (`.env`)

No `.env` variables are required for current runtime.

> [!NOTE]
> If you later migrate this scanner into a backend service, introduce `.env` keys for timeout, concurrency, and retry budgets to support predictable production behavior.

### Startup Flags and Config Files

- No CLI startup flags are currently used.
- Primary config surfaces are:
  - `manifest.json` for extension metadata.
  - UI controls in `index.html`.
  - Runtime constants in `assets/js/popup.js`.

## License

This project is distributed under the MIT License. See [`LICENSE`](LICENSE) for the full legal text.

## Contacts & Community Support

## Support the Project

[![Patreon](https://img.shields.io/badge/Patreon-OstinFCT-f96854?style=flat-square&logo=patreon)](https://www.patreon.com/OstinFCT)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-fctostin-29abe0?style=flat-square&logo=ko-fi)](https://ko-fi.com/fctostin)
[![Boosty](https://img.shields.io/badge/Boosty-Support-f15f2c?style=flat-square)](https://boosty.to/ostinfct)
[![YouTube](https://img.shields.io/badge/YouTube-FCT--Ostin-red?style=flat-square&logo=youtube)](https://www.youtube.com/@FCT-Ostin)
[![Telegram](https://img.shields.io/badge/Telegram-FCTostin-2ca5e0?style=flat-square&logo=telegram)](https://t.me/FCTostin)

If you find this tool useful, consider leaving a star on GitHub or supporting the author directly.
