# eBay Listings Scanner

An intelligent eBay listing scanner that helps you find underpriced items from non-specialist sellers (estate sales, casual sellers) rather than professional dealers.

## What It Does

- Searches eBay based on your criteria (keywords, conditions, feedback threshold)
- **Analyzes seller inventory** to detect specialists vs casual sellers
- Excludes sellers with >20% specialization in your target category
- Returns one listing per qualified seller
- Saves results to SQLite database with deduplication
- Auto-exports results to CSV for easy analysis

## Key Features

- **Smart Deduplication:** Skips items seen in last 7 days (faster scans)
- **Saved Searches:** Store ~10 search configurations for reuse
- **Auto CSV Export:** Results saved to `exports/` folder automatically
- **Historical Tracking:** Track items over time (first_found_at, last_seen_at)
- **Auto Cleanup:** Marks items inactive if not seen in 90 days
- **$0 Hosting Cost:** Runs locally, no cloud fees

## Tech Stack

- **Backend:** Node.js + Express
- **Database:** SQLite (better-sqlite3)
- **Frontend:** Vanilla HTML/JS/CSS
- **APIs:** eBay Browse API v1 + OAuth 2.0

## Setup

### Prerequisites

- Node.js >= 18.0.0
- eBay Developer Account (for API credentials)

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd listing-scanner
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**

   Create a `.env` file in the project root:
   ```
   EBAY_CLIENT_ID=your_ebay_app_id
   EBAY_CLIENT_SECRET=your_ebay_app_secret
   ```

   Get your eBay credentials at: https://developer.ebay.com/

4. **Test the setup**
   ```bash
   node test-migration.js
   ```
   You should see "✓ All tests passed!"

5. **Start the server**
   ```bash
   npm start
   ```

6. **Open in browser**

   Navigate to: http://localhost:3000

## Usage

### Running a Scan

1. **Fill in the search form:**
   - **Search Phrases:** Keywords to find items (e.g., "jewelry lot, jewelry collection")
   - **Item Conditions:** Select desired conditions (New, Used, etc.)
   - **Typical Phrases:** Category identifiers to detect specialists (e.g., "14k gold, sterling silver")
   - **Feedback Threshold:** Max seller feedback score (e.g., 1000)

2. **Optional: Save the search**
   - Check "Save this search for future use"
   - Enter a name for the search

3. **Click "Start Scan"**
   - Progress spinner will show
   - Scan takes 2-5 minutes depending on results
   - Results appear when complete

4. **View Results**
   - Results table shows: Title, Price, Seller, Feedback Score, Link
   - Results auto-exported to `exports/` folder as CSV

### Using Saved Searches

1. Select a saved search from the dropdown
2. Form fields will auto-populate
3. Click "Start Scan" to run it again
4. View previous results by selecting the search

### Downloading Data

- **Download Logs:** Click "Download Logs" button (for debugging)
- **Download Results:** Click "Download Search Results (CSV)"
- **Download History:** Click "Download Previous Listings (CSV)"
- **Auto Exports:** Check `exports/` folder for timestamped CSV files

## Project Structure

```
listing-scanner/
├── src/                      # Source code
│   ├── constants/            # eBay condition mappings
│   ├── db/                   # SQLite database manager
│   ├── routes/               # Express API routes
│   ├── services/             # Business logic (eBay, scanner, auth)
│   └── utils/                # Logging and helpers
├── views/                    # HTML templates
├── public/                   # Static assets (CSS, JS)
├── tests/                    # Test files
├── exports/                  # Auto-generated CSV exports
├── scanner.db                # SQLite database
├── index.js                  # Main entry point
└── *.txt                     # Daily log files
```

## How It Works

### Intelligent Seller Filtering

The core innovation is the **seller specialization algorithm**:

1. Search eBay for items matching your keywords
2. Group results by seller
3. For each seller:
   - Fetch their inventory (up to 100-200 items)
   - Calculate what % matches your "typical phrases"
   - **Decision:**
     - 0% match → Exclude (irrelevant)
     - 0.1-20% match → **Include (casual seller)** ✓
     - >20% match → Exclude (specialist)
4. Return one listing per qualified seller

This filters out professional dealers who specialize in your target category.

### Deduplication

- **Scans:** Skip items seen in last 7 days (faster, fewer API calls)
- **Cleanup:** Mark items inactive if not seen in 90 days (keeps database clean)
- **Tracking:** Update `last_seen_at` on every scan (UPSERT pattern)

### Rate Limiting

- 1-second delay between eBay API calls
- 5000 calls/day limit (tracked in memory)
- 5-second request timeout

## Database Schema

### saved_searches
Stores your search configurations.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| name | TEXT | Search name |
| search_phrases | TEXT | JSON array of keywords |
| typical_phrases | TEXT | JSON array of category phrases |
| feedback_threshold | INTEGER | Max seller feedback |
| conditions | TEXT | JSON array of condition IDs |
| created_at | TEXT | ISO datetime |

### all_search_results
Stores unique eBay items found.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| item_id | TEXT | eBay item ID (unique) |
| title | TEXT | Item title |
| price | REAL | Item price |
| url | TEXT | eBay listing URL |
| seller_id | TEXT | Seller username |
| first_found_at | TEXT | First discovered |
| last_seen_at | TEXT | Last seen in scan |
| is_active | INTEGER | 1=active, 0=inactive |

### search_result_mappings
Many-to-many relationship between searches and items.

| Column | Type | Description |
|--------|------|-------------|
| search_id | INTEGER | FK to saved_searches |
| result_id | INTEGER | FK to all_search_results |
| found_at | TEXT | When this search found this item |

## API Endpoints

- `POST /api/scan` - Start new scan
- `GET /api/results` - Poll scan status
- `GET /api/saves/searches` - List saved searches
- `GET /api/saves/search/:id` - Get specific search
- `POST /api/saves/search` - Save search
- `GET /api/saves/search/:id/results` - Get results for search
- `GET /api/logs` - Download log file
- `GET /api/conditions` - Get eBay conditions

## Troubleshooting

### Server won't start
- Check Node.js version: `node --version` (need >=18)
- Check if port 3000 is in use
- Check .env file has correct eBay credentials

### Scans fail
- Check eBay API credentials are valid
- Check daily API limit (5000 calls)
- Check log files: `ebay-scanner-YYYY-MM-DD.txt`

### Database errors
- Delete `scanner.db` and restart (will lose data)
- Run `node test-migration.js` to verify database works

### No results found
- Try less restrictive conditions
- Increase feedback threshold
- Adjust typical phrases (may be too specific)

## Development

### Running Tests
```bash
npm test                # Run all tests
node test-migration.js  # Test database operations
```

### Inspecting Database
```bash
sqlite3 scanner.db
sqlite> .tables
sqlite> SELECT * FROM saved_searches;
sqlite> .quit
```

### Viewing Logs
```bash
# Today's log
cat ebay-scanner-2026-01-31.txt

# Follow live
tail -f ebay-scanner-$(date +%Y-%m-%d).txt
```

## Configuration

### eBay Conditions
Edit `src/constants/conditions.js` to add/modify condition mappings.

### Specialization Threshold
Edit `src/services/ebay.js` line 54:
```javascript
const MINIMUM_RATIO = 20;  // Change this to adjust threshold
```

### Deduplication Window
Edit `src/db/DatabaseListingsManager.js` line 154:
```javascript
AND r.last_seen_at > datetime('now', '-7 days')  // Change window
```

### Cleanup Threshold
Edit `src/db/DatabaseListingsManager.js` line 310:
```javascript
WHERE last_seen_at < datetime('now', '-90 days')  // Change threshold
```

## Documentation

- **plan.md** - Project intent and scope
- **context.md** - Architecture, tech stack, conventions
- **decisions.md** - Why decisions were made (for AI assistants)
- **project.md** - Comprehensive project analysis

## Cost Analysis

### Before (Heroku + PostgreSQL)
- Heroku Dyno: $7-25/month
- PostgreSQL: $9+/month
- **Total: $16-34/month**

### After (Local + SQLite)
- Hosting: $0/month
- Database: $0/month
- **Total: $0/month** ✓

## Limitations

- **Single user** - No multi-user support
- **Local only** - Must run on your computer
- **No scheduling** - Manual scan triggering
- **eBay US only** - Marketplace ID hardcoded
- **5000 API calls/day** - eBay limit

## Future Enhancements

- Scheduled scans (cron jobs)
- Email notifications for new findings
- Price tracking and alerts
- Mobile-responsive UI
- Export to Google Sheets
- Multi-marketplace support

## License

[Your License Here]

## Support

For issues or questions:
- Check log files: `ebay-scanner-YYYY-MM-DD.txt`
- Inspect database: `sqlite3 scanner.db`
- Review decisions.md for architecture rationale

## Credits

Built with:
- [Express](https://expressjs.com/)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [eBay Browse API](https://developer.ebay.com/api-docs/buy/browse/overview.html)
