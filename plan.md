# eBay Listings Scanner - Implementation Plan

## Project Intent

Create a local-only, low-maintenance eBay listing scanner that helps users find underpriced items from non-specialist sellers (estate sales, casual sellers) rather than professional dealers.

## Scope

### Core Functionality
1. **Search Configuration**
   - Users can define search phrases (keywords to find items)
   - Users can define typical phrases (category identifiers to detect specialists)
   - Users can set feedback threshold (max seller rating)
   - Users can select item conditions (New, Used, etc.)
   - Save search configurations for reuse (~10 searches)

2. **Intelligent Seller Filtering**
   - Fetch seller's inventory (up to 100-200 items)
   - Calculate what % of inventory matches typical phrases
   - Exclude sellers with >20% match (specialists)
   - Exclude high-feedback sellers (over threshold)
   - Return one listing per qualified seller

3. **Data Persistence**
   - Store search configurations in SQLite
   - Track items over time (first_found_at, last_seen_at)
   - Deduplicate items seen in last 7 days
   - Auto-cleanup items not seen in 90 days

4. **Results Export**
   - Auto-export scan results to CSV (exports/ folder)
   - Manual CSV download of current results
   - Manual CSV download of historical items

### Non-Goals
- Multi-user support (single user only)
- Real-time scanning (batch processing is fine)
- Cloud hosting (local-only)
- Mobile access (desktop web UI only)
- Authentication/authorization (local app)
- Advanced analytics/dashboards (simple results table)

## Usage Pattern

- **Frequency:** Weekly scans (on-demand)
- **Searches:** ~10 saved search configurations
- **Concurrency:** One scan at a time
- **Duration:** Variable (depends on eBay API response times)
- **Results:** Show filtered results in web UI, auto-export to CSV

## Success Criteria

1. **Cost:** $0/month (no hosting costs)
2. **Maintenance:** Minimal (just npm dependencies)
3. **Performance:** Faster scans via deduplication (skip items seen in 7 days)
4. **Reliability:** No state loss (SQLite persistence)
5. **Usability:** Simple web UI at localhost:3000

## Implementation Approach

### Phase 1: Database Migration ✓
- Replace PostgreSQL with SQLite
- Update all database operations to use better-sqlite3
- Remove Heroku-specific code
- Test CRUD operations

### Phase 2: Smart Deduplication ✓
- Add getRecentItemIds() to skip items seen in 7 days
- Add cleanupOldItems() to remove items not seen in 90 days
- Reduce API calls by filtering duplicates early

### Phase 3: UI Simplification ✓
- Remove incomplete dashboard
- Keep core flow: saved searches → run scan → view results
- Simplify log display (just show recent activity)

### Phase 4: Auto CSV Export ✓
- Export results to exports/ folder after each scan
- Timestamp filenames for easy tracking
- Keep manual download buttons

### Phase 5: Testing & Documentation ✓
- Test database operations
- Test saved searches CRUD
- Update README with local setup instructions
- Create context and decisions documentation

## Future Enhancements (Out of Scope)

- Scheduled scanning (cron jobs)
- Email notifications for new findings
- Price tracking and alerts
- Seller analysis history
- Multi-user support with authentication
- Web deployment option (Fly.io, Railway)
