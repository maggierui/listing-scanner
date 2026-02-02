# eBay Listings Scanner - Architecture Decisions

This document records why specific decisions were made during the migration from Heroku + PostgreSQL to local-only SQLite. This prevents future AI assistants from undoing these decisions.

---

## Decision 1: SQLite Instead of PostgreSQL

**Date:** 2026-01-31
**Status:** Implemented ✓

### Decision
Replace PostgreSQL with SQLite for local-only deployment.

### Context
- Original setup used Heroku + PostgreSQL ($20-30/month)
- User runs scans weekly, single-user only
- Hosting costs were the primary problem
- ~10 saved searches, moderate data volume

### Rationale
- **Cost:** SQLite is free, no hosting needed ($0/month)
- **Simplicity:** File-based, no server process to manage
- **Performance:** Fast for single-user workloads
- **Portability:** Single file, easy backup/transfer
- **Sufficient scale:** Handles thousands of items easily

### Alternatives Considered
- **Stick with PostgreSQL:** Too expensive for single-user
- **MongoDB/Redis:** Overkill for structured data
- **JSON files:** No querying capability, data integrity issues
- **Cloud databases (Supabase/PlanetScale):** Still costs money, unnecessary complexity

### Why NOT to change this
SQLite is perfect for this use case. Only consider alternatives if:
- Multi-user support is needed (then use PostgreSQL)
- Deploying to cloud (then use managed database)
- Data grows beyond 1M items (then consider PostgreSQL)

---

## Decision 2: better-sqlite3 Library

**Date:** 2026-01-31
**Status:** Implemented ✓

### Decision
Use better-sqlite3 instead of node-sqlite3 or other SQLite libraries.

### Context
- Need reliable SQLite bindings for Node.js
- Several options available (node-sqlite3, better-sqlite3, sql.js)

### Rationale
- **Synchronous API:** Simpler code, no async/await needed
- **Performance:** Fastest SQLite library for Node.js
- **Stability:** Battle-tested, widely used
- **Prepared statements:** Built-in, prevents SQL injection
- **Transactions:** Native support with simple API

### Alternatives Considered
- **node-sqlite3:** Async API more complex, slower
- **sql.js:** In-memory only, not suitable for persistence
- **Knex/Sequelize:** ORM overhead, unnecessary for simple app

### Why NOT to change this
better-sqlite3 is the de facto standard for Node.js + SQLite. Only change if:
- Need async API for some reason (then use node-sqlite3)
- Want ORM features (then add Knex/Sequelize layer)

---

## Decision 3: Synchronous Database API

**Date:** 2026-01-31
**Status:** Implemented ✓

### Decision
Use synchronous database calls instead of async/await.

### Context
- better-sqlite3 is synchronous by design
- Original PostgreSQL code used async/await everywhere
- Mixed async/sync code can be confusing

### Rationale
- **Library design:** better-sqlite3 is optimized for sync
- **Simplicity:** No need for async/await on DB calls
- **Performance:** SQLite operations are fast, no benefit from async
- **Fewer bugs:** No race conditions or promise issues

### Example
```javascript
// Before (PostgreSQL + pg)
const result = await pool.query('SELECT * FROM searches');
return result.rows;

// After (SQLite + better-sqlite3)
const result = db.prepare('SELECT * FROM searches').all();
return result;
```

### Why NOT to change this
Don't add async/await to database calls just to be consistent with eBay API calls. The patterns are different:
- **Database:** Local file I/O (fast, synchronous)
- **eBay API:** Network I/O (slow, must be async)

---

## Decision 4: 7-Day Deduplication Window

**Date:** 2026-01-31
**Status:** Implemented ✓

### Decision
Skip items seen in the last 7 days during scans.

### Context
- User runs scans weekly
- Scanning same items repeatedly wastes API calls
- Need to balance freshness vs performance

### Rationale
- **Weekly usage:** 7 days aligns with scan frequency
- **API efficiency:** Reduces calls to eBay by ~50-70%
- **Freshness:** Still catches new items and price changes
- **Not too aggressive:** 1-day window would miss items

### Alternatives Considered
- **1 day:** Too short, misses items
- **30 days:** Too long, user wants recent updates
- **No deduplication:** Wastes API calls

### Why NOT to change this
7 days is tuned for weekly scans. Only adjust if:
- User changes to daily scans (then use 1-2 days)
- User changes to monthly scans (then use 14-30 days)

---

## Decision 5: 90-Day Cleanup Threshold

**Date:** 2026-01-31
**Status:** Implemented ✓

### Decision
Mark items as inactive if not seen in 90 days.

### Context
- Database will grow over time with old items
- Old listings are likely expired/sold
- Need to keep database performant

### Rationale
- **Data hygiene:** Remove stale data automatically
- **Performance:** Queries filter `is_active = 1`
- **Storage:** Keeps database size manageable
- **Soft delete:** Items not deleted, just marked inactive

### Alternatives Considered
- **30 days:** Too aggressive, might remove valid items
- **No cleanup:** Database grows indefinitely
- **Hard delete:** Loses historical data

### Why NOT to change this
90 days is a safe threshold for eBay listings (usually 30-day duration + buffer). Only change if:
- User wants permanent history (then remove cleanup)
- Storage is an issue (then use 60 days)

---

## Decision 6: JSON Storage for Arrays

**Date:** 2026-01-31
**Status:** Implemented ✓

### Decision
Store arrays (search_phrases, typical_phrases, conditions) as JSON strings in SQLite.

### Context
- PostgreSQL has native array types (TEXT[])
- SQLite does not have native array types
- Need to store multiple values in a single column

### Rationale
- **SQLite limitation:** No native array type
- **JSON support:** SQLite has good JSON functions
- **Simplicity:** Easy to parse with JSON.parse()
- **Schema flexibility:** Can add fields without migration

### Alternatives Considered
- **Separate table:** search_phrases table with foreign key
  - Too complex for small arrays (~2-5 items)
- **Comma-separated:** Hard to query, parsing issues with commas in data
- **Multiple columns:** Inflexible, requires schema changes

### Example
```javascript
// Save
saveSearch(name, searchPhrases, typicalPhrases, ...) {
    stmt.run(name, JSON.stringify(searchPhrases), ...);
}

// Load
getSavedSearches() {
    const searches = stmt.all();
    return searches.map(s => ({
        ...s,
        search_phrases: JSON.parse(s.search_phrases)
    }));
}
```

### Why NOT to change this
JSON storage is standard for SQLite. Only change if:
- Need complex queries on array elements (then use separate table)
- Arrays grow very large (then normalize schema)

---

## Decision 7: Remove Real-Time Log Streaming

**Date:** 2026-01-31
**Status:** Implemented ✓

### Decision
Simplify UI by removing real-time log streaming, keep basic log display.

### Context
- Original UI showed real-time logs during scan
- User doesn't need real-time updates (scans take minutes)
- Complexity for minimal benefit

### Rationale
- **User feedback:** "I don't need to see the live stream unless it is for debugging"
- **Simplicity:** Less frontend code to maintain
- **Sufficient UX:** Spinner + final results is enough
- **Debugging:** Daily log files still available

### What Remains
- Spinner during scan
- "Recent activity" area shows last few messages
- Download logs button for debugging
- Final results displayed when complete

### Why NOT to change this
User explicitly stated real-time logs aren't needed. Don't add complexity unless:
- User specifically requests live progress tracking
- Scans take longer than 5 minutes (then add progress bar)

---

## Decision 8: Auto CSV Export

**Date:** 2026-01-31
**Status:** Implemented ✓

### Decision
Automatically export scan results to CSV file after each scan.

### Context
- User wants CSV exports for analysis
- Manual download worked but required extra click
- Results should persist outside database

### Rationale
- **Convenience:** No extra step needed
- **Backup:** Results saved even if database corrupted
- **Analysis:** Easy to open in Excel/Google Sheets
- **Historical record:** Timestamped files show scan history

### Implementation
```javascript
// After scan completes
if (allListings.length > 0) {
    const exportPath = await autoExportScanResults(allListings, 'scan');
    await logger.log(`Results exported to: ${exportPath}`);
}
```

### Filename Format
`{searchName}_{timestamp}.csv`
Example: `jewelry_lot_2026-01-31T14-30-00.csv`

### Why NOT to change this
Auto-export is a quality-of-life feature. Only disable if:
- Disk space is severely limited
- User doesn't want automatic files
- Performance is an issue (unlikely)

---

## Decision 9: Remove Dashboard

**Date:** 2026-01-31
**Status:** Implemented ✓

### Decision
Remove incomplete dashboard.html and dashboard.js files.

### Context
- Dashboard partially implemented but non-functional
- Referenced non-existent API endpoints
- Added complexity without benefit

### Rationale
- **Incomplete:** Never finished, would need significant work
- **Unnecessary:** Simple results table is sufficient
- **Maintenance:** Less code to maintain
- **Focus:** Keep app simple and focused

### What Remains
Main UI (index.html) provides:
- Search form
- Saved searches dropdown
- Results table
- CSV export buttons

### Why NOT to change this
Dashboard was incomplete and not needed. Only add advanced features if:
- User specifically requests analytics
- Need to visualize trends over time
- Managing many more searches (>20)

---

## Decision 10: In-Memory Scan State

**Date:** 2026-01-31
**Status:** Kept (Not Changed)

### Decision
Keep scan state (scanResults, scanInProgress) in memory rather than database.

### Context
- Original code used in-memory state
- State lost on server restart (was a bug on Heroku)
- Could persist to database for resume capability

### Rationale
- **Local deployment:** Server restarts are rare
- **Quick scans:** Scans complete in minutes, not hours
- **Simplicity:** No need to persist transient state
- **User workflow:** User starts scan and waits for results

### Why This Works Now
- Heroku: Dynos restart frequently → state lost
- Local: Server runs continuously → state persists

### Why NOT to change this
Persisting scan state to database adds complexity for minimal benefit. Only change if:
- Scans take >30 minutes (then add resume capability)
- Server restarts frequently (then persist state)
- Multiple concurrent scans needed (then use queue system)

---

## Decision 11: Fixed Port 3000

**Date:** 2026-01-31
**Status:** Implemented ✓

### Decision
Use fixed port 3000 instead of dynamic PORT environment variable.

### Context
- Heroku sets PORT dynamically (required for cloud)
- Local deployment can use fixed port
- Simpler configuration

### Rationale
- **Predictability:** Always available at localhost:3000
- **Bookmarks:** User can bookmark URL
- **No config:** Don't need to set PORT in .env
- **Convention:** 3000 is standard for Node.js apps

### Why NOT to change this
Fixed port is fine for local-only app. Only change if:
- Port 3000 conflicts with another app (then use 3001, 3002, etc.)
- Deploying to cloud (then use process.env.PORT)

---

## Decision 12: Singleton Database Manager

**Date:** 2026-01-31
**Status:** Kept (Not Changed)

### Decision
Keep DatabaseListingsManager as singleton pattern.

### Context
- Original code exported singleton instance
- Could instead instantiate per-request
- Singleton means shared database connection

### Rationale
- **SQLite limitation:** One writer at a time
- **Performance:** No overhead creating connections
- **Simplicity:** Single source of truth
- **WAL mode:** Handles concurrent reads well

### Implementation
```javascript
class DatabaseListingsManager { /* ... */ }
const dbManager = new DatabaseListingsManager();
export default dbManager;  // Singleton
```

### Why NOT to change this
Singleton is correct for SQLite. Only change if:
- Need connection pooling (then switch to PostgreSQL)
- Multiple database files (then use factory pattern)

---

## Decision 13: Keep Express.js

**Date:** 2026-01-31
**Status:** Kept (Not Changed)

### Decision
Keep Express.js as web framework instead of switching to FastAPI/Python.

### Context
- User was open to Python ("Language preference: Stick with Node.js or switch to Python?")
- Could rewrite backend in Python with FastAPI
- Original code is Node.js/Express

### Rationale
- **Migration effort:** Keep existing codebase working
- **Familiarity:** User already has Node.js setup
- **Dependencies:** eBay code already in JavaScript
- **Not broken:** Express works fine for this app

### Why NOT to change this
Only switch to Python if:
- User specifically requests it
- Need Python-specific libraries (pandas, etc.)
- Complete rewrite is acceptable

---

## Decision 14: No Authentication

**Date:** 2026-01-31
**Status:** Kept (Not Changed)

### Decision
No user authentication or authorization.

### Context
- App runs locally on user's computer
- Single user only
- No sensitive data exposed

### Rationale
- **Threat model:** localhost:3000 is not exposed to internet
- **Simplicity:** No login, sessions, passwords to manage
- **User requirement:** "I don't need multi-users"

### Security Considerations
- eBay API keys in .env (not committed to git)
- Database file is local (not shared)
- No remote access to server

### Why NOT to change this
Authentication is unnecessary for local-only app. Only add if:
- App is deployed to cloud
- Multiple users need access
- Sensitive data needs protection

---

## Summary of Key Constraints

These should NOT be changed without careful consideration:

1. **SQLite database** - Perfect for single-user local app
2. **Synchronous DB API** - Matches better-sqlite3 design
3. **7-day deduplication** - Tuned for weekly usage
4. **90-day cleanup** - Safe threshold for eBay listings
5. **JSON array storage** - Standard for SQLite
6. **20% specialization threshold** - Core business logic
7. **Auto CSV export** - User convenience feature
8. **In-memory scan state** - Fine for local deployment
9. **Singleton DB manager** - Correct for SQLite
10. **No authentication** - Unnecessary for localhost

## When to Reconsider Decisions

### If usage pattern changes:
- Daily scans → Adjust deduplication window (1-2 days)
- Monthly scans → Adjust deduplication window (14-30 days)
- Multiple concurrent scans → Add queue system, persist state

### If deployment model changes:
- Cloud deployment → Use PostgreSQL, add authentication
- Multi-user → Add authentication, session management
- Heroku/Vercel → Use managed database, dynamic PORT

### If data volume changes:
- >1M items → Consider PostgreSQL, optimize indexes
- >100 saved searches → Add dashboard, better UI

### If performance issues:
- Slow scans → Profile, optimize SQL queries
- High API usage → Increase deduplication window
- Memory leaks → Review in-memory state management

---

## Decision 15: Generic Search Term Instead of Wildcard for Seller Inventory

**Date:** 2026-02-01
**Status:** Implemented ✓ (Updated to use "vintage")

### Decision
Use generic search term (`q=vintage`) instead of wildcard (`q=*`) when fetching seller inventory for specialization analysis.

### Context
The seller specialization check is a core feature:
1. Find items using search phrases (e.g., "jewelry lot", "vintage jewelry collection")
2. For each seller found, fetch their inventory
3. Analyze what % of their inventory contains typical phrases (e.g., "necklace", "bracelet", "ring")
4. Exclude sellers with >20% match (specialists) or 0% match (irrelevant)
5. Include sellers with 0.1-20% match (casual sellers) ✓

The problem: Fetching seller inventory used `q=*&seller=username` (wildcard search), but eBay's Browse API no longer allows wildcard searches without additional filters.

### eBay API Errors Encountered
- **Error 12023**: "This keyword search results in a response that is too large to return. Either change the keyword or add additional query parameters and/or filters."
- **Error 12006**: "The 'limit' value should be between 1 and 200 (inclusive)." (cascading error when total count = 0)
- **Error 12001**: Empty search phrases caused "The call must have a valid 'q' parameter." (fixed by filtering empty strings)

### Rationale
Using "vintage" as a generic cross-category term instead of wildcard:
- **Fixes API error**: eBay accepts specific search terms
- **Cross-category sampling**: "Vintage" appears in many categories (furniture, clothing, jewelry, collectibles, electronics)
- **Better representation**: Samples across seller's full inventory, not just one category
- **Preserves logic**: Still calculates specialization ratio accurately
- **Simple solution**: Minimal code change, no need for category IDs or complex queries

### Alternatives Considered

**Option 1: Generic cross-category term** (CHOSEN)
- `q=vintage&seller=username`
- Pros: Simple, fixes error, samples across many categories
- Cons: May not capture 100% of inventory if seller doesn't use "vintage" in listings

**Option 2: Use eBay category IDs**
- `q=*&seller=username&category_ids=281`
- Pros: More accurate, sees all items in category
- Cons: Need to hardcode category IDs, may still fail with wildcard

**Option 3: Use typical phrases**
- `q=necklace&seller=username` (use first typical phrase)
- Pros: Dynamic, directly relevant
- Cons: Might be too narrow, miss items with different terminology

**Option 4: Skip seller inventory analysis**
- Just filter by feedback score, skip specialization check
- Pros: Simplest, fastest
- Cons: Loses core feature - can't detect specialists

**Option 5: Try eBay Trading API**
- Use `GetSellerList` call instead
- Pros: Designed for getting seller listings
- Cons: Different auth method, may be deprecated, more complex

### Implementation
```javascript
// Before (FAILED - Error 12023 with wildcard, Error 12001 without q parameter)
const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?` +
    `filter=seller:${encodeURIComponent(sellerUsername)}` + // ❌ Missing required 'q' parameter
    `&limit=200`;

// After (WORKS)
const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?` +
    `q=vintage` + // ✓ Generic cross-category term
    `&filter=seller:${encodeURIComponent(sellerUsername)}` +
    `&limit=200`;
```

Also added validation to filter empty strings from search phrases:
```javascript
const validSearchPhrases = searchPhrases.filter(phrase => phrase && phrase.trim() !== '');
```

### Why NOT to change this
This solution preserves the seller specialization check (core feature) while working within eBay's API constraints. Only change if:

- **eBay allows wildcards again**: Then revert to `q=*` for full inventory sampling
- **Better generic term found**: If another term provides better cross-category coverage (e.g., "lot", "new", "used")
- **eBay provides better API**: If a new endpoint allows fetching seller inventory directly
- **Accuracy issues**: If the "vintage" sample causes false negatives/positives, try:
  - Different generic terms (e.g., "lot", "new", "used")
  - Multiple search terms combined
  - eBay Trading API's `GetSellerList` endpoint

### Future Enhancement Ideas
If the "vintage" term proves insufficient:
1. **Try alternative generic terms**: Test other cross-category terms
   - "lot" (common in bulk/collection listings)
   - "new" / "used" (condition terms that appear everywhere)
   - "-" (hyphen/dash, very common in formatted titles)
2. **Multiple search terms**: Try several generic terms and combine results for better sampling
3. **eBay Trading API**: Switch to `GetSellerList` endpoint if it provides better access to full inventory
4. **Category mapping**: Use eBay category IDs to search across all categories

---

## Decision 16: Shared Progress State Module

**Date:** 2026-02-01
**Status:** Implemented ✓

### Decision
Create a separate progress.js module to track scan progress, avoiding circular dependencies between scanner.js and ebay.js.

### Context
- Frontend needs detailed progress updates during scans
- Progress includes: current phrase, sellers processed, qualified sellers
- scanner.js orchestrates the scan, ebay.js processes sellers
- Direct imports between scanner.js ↔ ebay.js would create circular dependency
- Need shared state accessible from both modules

### Rationale
- **Avoids circular dependencies**: Independent module imported by both scanner and ebay
- **Single source of truth**: progressState object shared across modules
- **Simple API**: Clear functions for updating different aspects of progress
- **No database overhead**: In-memory state (progress is ephemeral)
- **Clean separation**: Progress tracking logic isolated from business logic

### Implementation
```javascript
// progress.js - Shared state module
export const progressState = {
    currentPhrase: '',
    currentPhraseIndex: 0,
    totalPhrases: 0,
    sellersProcessed: 0,
    totalSellers: 0,
    qualifiedSellers: 0
};

export function resetProgress() { /* ... */ }
export function updatePhraseProgress(phrase, phraseIndex, totalPhrases) { /* ... */ }
export function updateSellerProgress(sellersProcessed, totalSellers, qualifiedSellers) { /* ... */ }
```

### Usage Pattern
```javascript
// scanner.js
import { resetProgress, updatePhraseProgress, progressState } from './progress.js';

async function startScan() {
    resetProgress();
    for (let i = 0; i < searchPhrases.length; i++) {
        updatePhraseProgress(phrase, i, searchPhrases.length);
        // ...
    }
}

// ebay.js
import { updateSellerProgress } from './progress.js';

async function fetchListingsForPhrase() {
    // ...
    updateSellerProgress(processed, total, qualified);
}

// API endpoint exposes progressState
GET /api/scan/progress → returns progressState
```

### Alternatives Considered

**Option 1: Shared module** (CHOSEN)
- Pros: Clean, no circular dependencies, simple
- Cons: Global state (acceptable for single-user app)

**Option 2: Pass callbacks**
- scanner.js passes progress callback to ebay.js
- Pros: More functional, no global state
- Cons: Complex API, harder to read

**Option 3: Event emitter**
- Use Node.js EventEmitter for progress events
- Pros: Decoupled, event-driven
- Cons: Overkill for simple progress tracking

**Option 4: Store in database**
- Persist progress state to SQLite
- Pros: Survives restarts
- Cons: Unnecessary I/O, progress is ephemeral

**Option 5: Return progress from functions**
- ebay.js returns progress data to scanner.js, scanner updates state
- Pros: Pure functions, no shared state
- Cons: Complex return types, harder to maintain

### Why NOT to change this
This approach is ideal for a single-user local app with short-lived scans. Only change if:
- **Multi-user support needed**: Then use per-session progress tracking
- **Long-running scans**: Then consider persisting progress for resume capability
- **Distributed architecture**: Then use message queue or database for progress
- **Complex progress tracking**: Then use event emitter pattern

---

## Summary of Key Constraints

These should NOT be changed without careful consideration:

1. **SQLite database** - Perfect for single-user local app
2. **Synchronous DB API** - Matches better-sqlite3 design
3. **7-day deduplication** - Tuned for weekly usage
4. **90-day cleanup** - Safe threshold for eBay listings
5. **JSON array storage** - Standard for SQLite
6. **20% specialization threshold** - Core business logic
7. **Auto CSV export** - User convenience feature
8. **In-memory scan state** - Fine for local deployment
9. **Singleton DB manager** - Correct for SQLite
10. **No authentication** - Unnecessary for localhost
11. **Generic search term for seller inventory** - Works within eBay API constraints
12. **Shared progress state module** - Avoids circular dependencies

## When to Reconsider Decisions

### If usage pattern changes:
- Daily scans → Adjust deduplication window (1-2 days)
- Monthly scans → Adjust deduplication window (14-30 days)
- Multiple concurrent scans → Add queue system, persist state

### If deployment model changes:
- Cloud deployment → Use PostgreSQL, add authentication
- Multi-user → Add authentication, session management
- Heroku/Vercel → Use managed database, dynamic PORT

### If data volume changes:
- >1M items → Consider PostgreSQL, optimize indexes
- >100 saved searches → Add dashboard, better UI

### If performance issues:
- Slow scans → Profile, optimize SQL queries
- High API usage → Increase deduplication window
- Memory leaks → Review in-memory state management
