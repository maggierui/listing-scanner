# eBay Listings Scanner - Context Documentation

## Tech Stack

### Backend
- **Runtime:** Node.js >= 18.0.0
- **Framework:** Express.js 4.x
- **Database:** SQLite (better-sqlite3)
- **Module System:** ES Modules (import/export)

### Frontend
- **UI:** Vanilla JavaScript, HTML, CSS
- **No Framework:** Simple form-based interface
- **Styling:** Custom CSS

### External APIs
- **eBay Browse API v1:** Item search and seller inventory
- **eBay OAuth 2.0:** Client credentials authentication

### Key Dependencies
- `better-sqlite3@^11.0.0` - SQLite database (synchronous API)
- `express@^4.18.2` - Web server
- `node-fetch@^3.3.2` - HTTP client for eBay API
- `csv-stringify@^6.5.2` - CSV generation
- `dotenv@^16.4.7` - Environment variables

## Folder Structure

```
listing-scanner/
├── src/                          # Source code
│   ├── constants/                # Configuration constants
│   │   └── conditions.js         # eBay condition ID mappings
│   ├── db/                       # Database layer
│   │   └── DatabaseListingsManager.js  # SQLite operations (singleton)
│   ├── routes/                   # Express routes
│   │   └── api.js                # API endpoints
│   ├── services/                 # Business logic
│   │   ├── auth.js               # eBay OAuth 2.0
│   │   ├── ebay.js               # eBay API + seller analysis
│   │   └── scanner.js            # Scan orchestration
│   └── utils/                    # Utilities
│       ├── helpers.js            # Helper functions (delay)
│       └── logger.js             # Dual logging (console + file)
│
├── views/                        # HTML templates
│   └── index.html                # Main UI
│
├── public/                       # Static assets
│   ├── css/
│   │   └── main.css              # Application styles
│   └── js/
│       └── client.js             # Frontend logic
│
├── tests/                        # Test files
│   ├── run-tests.js              # Test orchestrator
│   ├── test-db.js                # Database tests
│   ├── test-api.js               # API tests
│   └── test-ebay.js              # eBay API tests
│
├── exports/                      # Auto-generated CSV exports
├── scanner.db                    # SQLite database file
├── csv-handlers.js               # CSV export functions
├── index.js                      # Main entry point
├── package.json                  # Dependencies
├── .env                          # Environment variables (gitignored)
└── *.txt                         # Daily log files
```

## Database Schema

### Table: saved_searches
Stores user's search configurations.

```sql
CREATE TABLE saved_searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    search_phrases TEXT NOT NULL,        -- JSON array
    typical_phrases TEXT NOT NULL,       -- JSON array
    feedback_threshold INTEGER NOT NULL,
    conditions TEXT NOT NULL,            -- JSON array
    created_at TEXT DEFAULT (datetime('now'))
)
```

**Purpose:** Reusable search configurations (~10 searches)
**JSON Fields:** Arrays stored as JSON strings, parsed on retrieval

### Table: all_search_results
Stores unique eBay items found during searches.

```sql
CREATE TABLE all_search_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT UNIQUE NOT NULL,       -- eBay's item ID
    title TEXT NOT NULL,
    price REAL,
    url TEXT,
    seller_id TEXT,
    first_found_at TEXT DEFAULT (datetime('now')),
    last_seen_at TEXT DEFAULT (datetime('now')),
    is_active INTEGER DEFAULT 1         -- 1=active, 0=inactive
)

CREATE INDEX idx_results_item_id ON all_search_results(item_id);
CREATE INDEX idx_results_last_seen ON all_search_results(last_seen_at);
```

**Purpose:** Track items over time, deduplicate, historical data
**Key Features:**
- UNIQUE constraint on item_id prevents duplicates
- Indexes for fast lookups and date filtering
- last_seen_at updated on every scan (UPSERT)

### Table: search_result_mappings
Many-to-many relationship between searches and items.

```sql
CREATE TABLE search_result_mappings (
    search_id INTEGER REFERENCES saved_searches(id),
    result_id INTEGER REFERENCES all_search_results(id),
    found_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (search_id, result_id)
)
```

**Purpose:** Link items to searches that found them
**Relationships:**
- One search can find many items
- One item can be found by many searches
- Composite primary key prevents duplicate mappings

## API Endpoints

### Scan Operations
- `POST /api/scan` - Start new scan
  - Body: `{ searchPhrases, typicalPhrases, feedbackThreshold, conditions }`
  - Returns: `{ message: "Scan started successfully" }`
  - Status: 200 (success), 409 (scan in progress), 400 (missing params)

- `GET /api/results` - Poll scan status
  - Returns: `{ status, listings[], logs[], lastUpdated, error? }`
  - Status: Polls during scan, returns final results when complete

### Saved Searches
- `GET /api/saves/searches` - List all saved searches
- `GET /api/saves/search/:id` - Get specific search details
- `POST /api/saves/search` - Save new search configuration
- `GET /api/saves/search/:id/results` - Get results for saved search

### Utilities
- `GET /api/logs` - Download daily log file
- `GET /api/conditions` - Get available eBay conditions

## Key Files & Responsibilities

### index.js (Main Entry Point)
- Creates Express server
- Initializes database (calls dbManager.init())
- Configures middleware and routes
- Serves static files and HTML
- Handles graceful shutdown (closes database)

### DatabaseListingsManager.js (Data Layer)
- **Singleton pattern** - Single instance exported
- **Synchronous API** - All methods are synchronous (better-sqlite3)
- **Key Methods:**
  - `init()` - Create tables and indexes
  - `saveSearch()` - Store search config (returns ID)
  - `getSavedSearches()` - Retrieve all searches
  - `saveSearchResult()` - UPSERT item with transaction
  - `getSearchResults()` - Get items for a search
  - `checkExistingResults()` - Get items seen in last 7 days
  - `getRecentItemIds()` - Get Set of recent item IDs (deduplication)
  - `cleanupOldItems()` - Mark items inactive if not seen in 90 days

### ebay.js (Business Logic)
- **Core Algorithm:** Intelligent seller filtering
- **Key Functions:**
  - `fetchListingsForPhrase()` - Search eBay, filter, analyze sellers
  - `fetchSellerListings()` - Analyze seller's inventory for specialization
  - `getSellerInventoryBrowseAPI()` - Fetch seller's items
- **Rate Limiting:** 1-second delay between API calls
- **Deduplication:** Filters out items seen in last 7 days

### scanner.js (Orchestration)
- **State Management:** In-memory scanResults object
- **Key Function:** `startScan()` - Orchestrates entire scan
- **Flow:**
  1. Clean up old items (90 days)
  2. Get eBay access token
  3. Iterate through search phrases
  4. Aggregate results
  5. Auto-export to CSV
  6. Update scan status

### client.js (Frontend)
- Form submission and validation
- Saved search loading and selection
- Result polling (while scan in progress)
- Result display
- CSV download functions

## eBay Condition Mapping

eBay uses inconsistent condition text. We map variants to standard IDs:

```javascript
EBAY_CONDITIONS = {
  NEW: { id: 1000, name: 'New', variants: ['New', 'Brand New'] },
  USED: { id: 3000, name: 'Used', variants: ['Used', 'Pre-owned', 'Pre owned'] },
  // ... etc
}
```

## Important Conventions

### Database
- **Foreign keys enabled:** `PRAGMA foreign_keys = ON`
- **WAL mode:** Better concurrency, faster writes
- **JSON storage:** Arrays stored as JSON strings, parsed on read
- **Datetime format:** ISO 8601 text format (SQLite datetime() function)
- **Transactions:** Used for multi-step operations (saveSearchResult)

### API Rate Limiting
- **1-second delay** between eBay API calls
- **5000 calls/day limit** (tracked in memory, resets on restart)
- **5-second timeout** on requests
- **Graceful error handling** for rate limit responses (429)

### Logging
- **Dual logging:** Console (for terminal) + File (for debugging)
- **Daily files:** ebay-scanner-YYYY-MM-DD.txt
- **Timestamps:** EST/EDT timezone
- **Buffer:** Last 50 messages in memory (for web UI)

### CSV Export
- **Auto-export:** After each scan to exports/ folder
- **Filename format:** `{searchName}_{timestamp}.csv`
- **Manual export:** Download buttons in UI
- **Columns:** title, price, currency, seller, feedbackScore, itemId, link

### Code Style
- **ES Modules:** import/export syntax
- **Async/await:** For I/O operations
- **Synchronous DB:** better-sqlite3 is sync by design
- **No TypeScript:** Plain JavaScript
- **No build step:** Direct Node.js execution

## Environment Variables

Required in `.env` file:

```
EBAY_CLIENT_ID=your_ebay_app_id
EBAY_CLIENT_SECRET=your_ebay_app_secret
```

Optional (defaults provided):
- `PORT=3000` - Server port (fixed for local)
- `DATABASE_URL` - Not used (SQLite uses file path)

## What Must NOT Be Changed

### Core Algorithm
The **20% threshold** for seller specialization is carefully tuned:
- 0% match → **Include** (casual seller with one-off jewelry item)
- 0.1-20% match → **Include** (casual seller with some jewelry)
- >20% match → **Exclude** (specialist)

**Logic Update (2026-02-01):** Originally 0% sellers were excluded. However, if a seller has a jewelry lot listing but 0% of their "vintage" inventory is jewelry, it means they're a casual/estate sale seller who occasionally has jewelry - exactly our target audience. These sellers are now included.

**DO NOT** change this without understanding the business logic.

### Database Schema
The three-table design with many-to-many mapping is intentional:
- Prevents duplicate item storage
- Allows item tracking over time
- Supports multiple searches finding same item

**DO NOT** flatten or denormalize without considering implications.

### Deduplication Window
- **7 days** for checkExistingResults (skip recent items during scan)
- **90 days** for cleanupOldItems (mark inactive)

These are optimized for weekly usage patterns.

### Synchronous vs Async
- **Database operations:** Synchronous (better-sqlite3 design)
- **eBay API calls:** Async (network I/O)
- **File operations:** Async (logger, CSV export)

**DO NOT** mix patterns without understanding the library APIs.

## Common Patterns

### UPSERT Pattern
```javascript
INSERT INTO all_search_results (item_id, title, price, url, seller_id)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT (item_id) DO UPDATE
SET last_seen_at = datetime('now'), is_active = 1
```

Used to update existing items or insert new ones.

### Transaction Pattern
```javascript
const transaction = this.db.transaction(() => {
    // Multiple operations
    stmt1.run(...);
    stmt2.run(...);
});
transaction(); // Execute atomically
```

Used in saveSearchResult to ensure consistency.

### Deduplication Pattern
```javascript
const recentItemIds = dbManager.getRecentItemIds(7);
const newItems = items.filter(item => !recentItemIds.has(item.itemId));
```

Used to skip items seen in last 7 days.

## Development Workflow

### Local Setup
```bash
npm install
node test-migration.js  # Verify database works
npm start               # Start server at localhost:3000
```

### Testing
```bash
npm test                # Run all tests
node test-migration.js  # Test database operations
```

### Debugging
- Check logs: `ebay-scanner-YYYY-MM-DD.txt`
- Inspect database: `sqlite3 scanner.db`
- View exports: `exports/` folder

## Performance Considerations

### Database
- **Indexes** on item_id and last_seen_at for fast lookups
- **WAL mode** for better concurrency
- **Synchronous API** eliminates async overhead

### API Calls
- **Deduplication** reduces unnecessary API calls
- **Rate limiting** prevents throttling
- **Caching** of access tokens

### Memory
- **In-memory state** for current scan (lost on restart, but that's OK)
- **Log buffer** limited to last 50 messages
- **No large data structures** kept in memory
