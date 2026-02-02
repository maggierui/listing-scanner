# eBay Listings Scanner - Project Documentation

## Project Overview

**Project Name:** eBay Listings Scanner (ebay-listings-scanner)

**Main Purpose:** An intelligent eBay listing scanner that helps users find underpriced or niche items from non-specialist sellers. The application searches eBay based on user-defined criteria and filters out professional/high-volume sellers, helping identify casual sellers (estate sales, general sellers) who may list items at better prices.

**Core Use Case:** Finding jewelry lots, collectibles, or other items from non-specialist sellers rather than established dealers who typically price items at market rates.

---

## Technology Stack

- **Backend:** Node.js with Express.js
- **Database:** PostgreSQL (configured for Heroku deployment)
- **Frontend:** Vanilla JavaScript with HTML/CSS (no framework)
- **API Integration:** eBay Browse API v1 and OAuth 2.0
- **Deployment:** Heroku
- **Package Manager:** npm
- **Module System:** ES Modules (import/export)

---

## Application Flow

1. **User Input** → User enters search criteria via web form:
   - Search phrases (keywords to find items)
   - Typical phrases (category identifiers to detect specialists)
   - Feedback threshold (max seller rating)
   - Item conditions (New, Used, Refurbished, etc.)

2. **Scanning Process:**
   - Authenticates with eBay API (OAuth 2.0 client credentials)
   - Searches for items matching search phrases
   - Filters by item condition
   - Groups results by seller
   - **Intelligent Seller Filtering:**
     - Fetches each seller's complete inventory (up to 100 items)
     - Analyzes what percentage of seller's inventory matches "typical phrases"
     - Excludes sellers with >20% category match (specialists)
     - Excludes high-feedback sellers (over threshold)
   - Returns one listing per qualified seller

3. **Results Storage:**
   - Stores search configurations in database
   - Links found items to saved searches (many-to-many relationship)
   - Tracks when items were first found and last seen

4. **Display:** Shows filtered results in web interface with real-time logging

---

## Architecture & Key Components

### Core Business Logic

The application's key innovation is its **intelligent seller filtering algorithm**:

1. For each search phrase, fetch up to 200 eBay listings
2. Group listings by seller
3. For each seller:
   - Check feedback score against threshold
   - Fetch seller's entire inventory (up to 100-200 items)
   - Calculate what % of their inventory matches "typical phrases"
   - **Decision criteria:**
     - Exclude if >20% match (specialist dealer)
     - Exclude if 0% match (completely irrelevant)
     - Include if 0.1-20% match (casual seller with occasional relevant items)
4. Return one listing per qualified seller

This prevents overwhelming results from professional dealers and focuses on casual sellers.

### Database Schema

**Three main tables:**

1. **saved_searches** - User search configurations
   - `id` (SERIAL PRIMARY KEY)
   - `name` (TEXT)
   - `search_phrases` (TEXT[])
   - `typical_phrases` (TEXT[])
   - `feedback_threshold` (INTEGER)
   - `conditions` (TEXT[])
   - `created_at` (TIMESTAMP)

2. **all_search_results** - Unique eBay items
   - `id` (SERIAL PRIMARY KEY)
   - `item_id` (TEXT UNIQUE) - eBay item ID
   - `title` (TEXT)
   - `price` (NUMERIC)
   - `url` (TEXT)
   - `seller_id` (TEXT)
   - `first_found_at` (TIMESTAMP)
   - `last_seen_at` (TIMESTAMP)
   - `is_active` (BOOLEAN)
   - Indexes on `item_id` and `last_seen_at`

3. **search_result_mappings** - Many-to-many relationship
   - `search_id` (INTEGER)
   - `result_id` (INTEGER)
   - Composite PRIMARY KEY (search_id, result_id)
   - Foreign keys to both tables

---

## Directory Structure

```
listing-scanner/
├── index.js                    # Main entry point (Express server)
├── index-off.js                # Legacy version (backup, auto-scanning)
├── package.json                # Dependencies and scripts
├── Procfile                    # Heroku deployment config
├── .gitignore                  # Git ignore rules
├── .slugignore                 # Heroku slug ignore
├── csv-handlers.js             # CSV export utilities
├── get_categories.js           # Standalone eBay category fetcher
├── test.js                     # Database testing script
├── dashboard.html              # Secondary UI (WIP)
│
├── src/
│   ├── constants/
│   │   └── conditions.js       # eBay condition ID mappings
│   │
│   ├── db/
│   │   └── DatabaseListingsManager.js  # Database operations (singleton)
│   │
│   ├── routes/
│   │   └── api.js              # Express API routes
│   │
│   ├── services/
│   │   ├── auth.js             # eBay OAuth 2.0 authentication
│   │   ├── ebay.js             # eBay API interaction & seller analysis
│   │   └── scanner.js          # Scan orchestration
│   │
│   └── utils/
│       ├── helpers.js          # Utility functions (delay)
│       └── logger.js           # Dual logging (console + file)
│
├── views/
│   └── index.html              # Main UI (search form & results)
│
├── public/
│   ├── css/
│   │   └── main.css            # Application styles
│   │
│   └── js/
│       ├── client.js           # Main frontend logic
│       └── dashboard.js        # Dashboard logic (WIP)
│
└── tests/
    ├── run-tests.js            # Test orchestrator
    ├── test-db.js              # Database tests
    ├── test-api.js             # API tests
    └── test-ebay.js            # eBay API tests
```

---

## Key Files & Their Purposes

### Root Level

- **index.js** - Main Express server, middleware setup, route configuration, static file serving
- **index-off.js** - Legacy standalone version with auto-scanning (5-minute intervals), kept for reference
- **csv-handlers.js** - Functions to generate CSV exports of listings and search results
- **get_categories.js** - Standalone utility to fetch complete eBay category taxonomy (577KB CSV, 2MB JSON)
- **test.js** - Basic database connection and CRUD testing script

### Source Code (`src/`)

#### Constants
- **conditions.js** - Maps eBay condition IDs (1000-7000) to names and text variants. Handles eBay's inconsistent condition strings.

#### Database
- **DatabaseListingsManager.js** - Singleton class managing all PostgreSQL operations:
  - Table creation and initialization
  - Search CRUD operations
  - Item UPSERT with duplicate handling
  - Results retrieval with filtering
  - Connection pooling and SSL configuration

#### Routes
- **api.js** - Express router with all API endpoints:
  - `POST /api/scan` - Start new scan
  - `GET /api/results` - Poll scan status
  - `GET /api/saves/searches` - List saved searches
  - `POST /api/saves/search` - Save search config
  - `GET /api/saves/search/:id/results` - Get results
  - `GET /api/logs` - Download log file
  - `GET /api/conditions` - Get condition mappings

#### Services
- **auth.js** - eBay OAuth 2.0 client credentials flow, returns access tokens
- **ebay.js** - Core business logic (420 lines):
  - Search eBay for phrases (200 item limit)
  - Group by seller
  - Fetch seller inventory (up to 200 items)
  - Calculate specialization percentage
  - Filter based on 20% threshold
  - Rate limiting (1-second delays, 5000/day limit)
- **scanner.js** - Orchestrates scanning process:
  - Manages scan state (`scanInProgress`, `scanResults`)
  - Validates input
  - Iterates through search phrases
  - Aggregates results
  - Updates status and logs

#### Utils
- **logger.js** - Singleton logger with dual output:
  - Console (for Heroku logs)
  - Daily text files (ebay-scanner-YYYY-MM-DD.txt)
  - In-memory buffer (last 50 messages for web display)
  - EST/EDT timestamps
- **helpers.js** - Utility functions (e.g., `delay(ms)` for rate limiting)

### Frontend

#### Views
- **index.html** - Main UI with:
  - Search form (saved searches dropdown, phrases, conditions, threshold)
  - Real-time log display
  - Results table with seller info
  - Download buttons (logs, results CSV)

#### Public Assets
- **client.js** - Main frontend logic (326 lines):
  - Form submission and validation
  - Saved search loading and selection
  - Result polling and display
  - CSV downloads
  - Duplicate search detection
- **dashboard.js** - Advanced filtering UI (WIP, 75 lines)
- **main.css** - Application styling

### Tests
- **run-tests.js** - Test suite runner
- **test-db.js** - Database operation validation
- **test-api.js** - API endpoint testing
- **test-ebay.js** - eBay API integration tests

---

## Design Patterns

### 1. Singleton Pattern
- `DatabaseListingsManager` - Single database connection pool
- `Logger` - Single logger instance
- Prevents resource duplication

### 2. Repository Pattern
- `DatabaseListingsManager` encapsulates all data access
- Clean separation from business logic
- Easier testing and maintenance

### 3. Service Layer Pattern
- Services contain business logic (scanner, ebay, auth)
- Routes handle HTTP only
- Clear separation of concerns

### 4. Asynchronous Processing
- Scan starts immediately, processes in background
- Client polls for updates via `/api/results`
- Real-time log streaming
- Non-blocking server

### 5. State Management
- In-memory `scanResults` object tracks current scan
- `scanInProgress` flag prevents concurrent scans
- Log messages buffered for UI display

---

## Key Features

### Intelligent Seller Filtering
The core innovation - analyzes seller's entire inventory to detect specialists:
- Fetches up to 100-200 items per seller
- Calculates % matching "typical phrases"
- Excludes >20% match (professional dealers)
- Includes 0.1-20% match (casual sellers)

### Saved Searches
- Store search configurations for reuse
- Quickly reload previous search parameters
- Track results over time

### Real-Time Updates
- Live log streaming during scan
- Progress indicators
- Error display

### CSV Export
- Download search results
- Export historical listings
- Timestamped files

### Duplicate Prevention
- UPSERT pattern (ON CONFLICT DO UPDATE)
- Updates `last_seen_at` for existing items
- Composite primary keys prevent duplicate mappings

### Rate Limiting
- 1-second delays between API calls
- Tracks daily usage (5000 limit)
- 5-second request timeouts
- Graceful error handling

---

## Environment Configuration

### Required Environment Variables

Create a `.env` file with:

```env
EBAY_CLIENT_ID=your_ebay_app_id
EBAY_CLIENT_SECRET=your_ebay_app_secret
DATABASE_URL=postgresql://user:pass@host:5432/dbname
PORT=3000
```

### Database Configuration

**Production (Heroku):**
- Uses `DATABASE_URL` environment variable
- SSL enabled automatically (detects amazonaws.com)

**Local Development:**
- Falls back to `postgresql://localhost:5432/test_db`
- No SSL required
- Create database: `createdb test_db`

---

## Development Workflow

### Setup

```bash
# Install dependencies
npm install

# Set up database
createdb test_db  # or use Heroku PostgreSQL

# Configure environment
cp .env.example .env  # Edit with your credentials

# Start server
npm start
```

### Testing

```bash
# Run all tests
npm test

# Individual test suites
npm run test:db
npm run test:api
npm run test:ebay
```

### Deployment (Heroku)

```bash
# Create Heroku app
heroku create your-app-name

# Add PostgreSQL
heroku addons:create heroku-postgresql:mini

# Set environment variables
heroku config:set EBAY_CLIENT_ID=your_id
heroku config:set EBAY_CLIENT_SECRET=your_secret

# Deploy
git push heroku main

# View logs
heroku logs --tail
```

---

## API Endpoints

### Scanning
- `POST /api/scan` - Start new scan
  - Body: `{ searchPhrases, conditions, typicalPhrases, feedbackThreshold, saveSearch?, searchName? }`
  - Returns: `{ message: "Scan started" }`

- `GET /api/results` - Get current scan status
  - Returns: `{ status, listings[], logs[], startedAt, completedAt, error? }`

### Saved Searches
- `GET /api/saves/searches` - List all saved searches
- `GET /api/saves/search/:id` - Get search details
- `POST /api/saves/search` - Save new search
- `GET /api/saves/search/:id/results` - Get results for search

### Utilities
- `GET /api/logs` - Download daily log file
- `GET /api/conditions` - Get available eBay conditions

---

## Rate Limits & Constraints

### eBay API Limits
- **Daily limit:** 5000 calls per day
- **Rate limiting:** 1-second delay between calls
- **Request timeout:** 5 seconds
- **Search limit:** 200 items per search phrase
- **Seller inventory:** Up to 200 items fetched per seller

### Application Limits
- **Concurrent scans:** 1 at a time (prevents overwhelming API)
- **Log buffer:** Last 50 messages in memory
- **Seller analysis sample:** Up to 100 items per seller

---

## Notable Implementation Details

### eBay Condition Mapping
eBay uses inconsistent condition text. The app maps variants to standard IDs:
- ID 1000 = "New" (variants: "New", "Brand New")
- ID 3000 = "Used" (variants: "Used", "Pre-owned", "Pre owned")
- Multiple refurbished grades (2000-2030)
- Conditions from "New" to "For parts or not working"

### Seller Specialization Algorithm
```
1. Fetch seller's total listing count
2. Sample up to 100 items
3. For each item, check if title matches any "typical phrase"
4. Calculate: matchCount / totalSampled
5. Decision:
   - If 0%: Skip (irrelevant seller)
   - If 0.1-20%: Include (casual seller)
   - If >20%: Skip (specialist)
```

### Logging Strategy
- **Console:** For Heroku log aggregation
- **File:** Daily logs (ebay-scanner-YYYY-MM-DD.txt)
- **Memory:** Last 50 messages for web UI
- **Timestamps:** EST/EDT timezone

### Error Handling
- Try-catch blocks throughout
- Database transaction rollback on errors
- Graceful API error responses
- Retry logic for critical operations

---

## Known Issues & TODOs

### Incomplete Features
1. **Dashboard** - dashboard.html references non-existent API endpoints
2. **API routes** - Some routes reference undefined variables:
   - `EBAY_CONDITIONS` in api.js (should import from constants)
   - Missing `fs` import for log downloads

### Code Duplication
- `index-off.js` duplicates functionality from modular version
- Consider removing or consolidating

### Scalability Concerns
1. **Single scan limitation** - In-memory state won't work with multiple server instances
2. **API tracking** - Call count resets on restart (not persisted)
3. **No queueing** - Multiple users can't queue scans

### Potential Improvements
1. Implement Redis for distributed state management
2. Add scan queue system
3. Persist API call counts to database
4. Complete dashboard functionality
5. Add user authentication
6. Implement webhook notifications
7. Add email alerts for new findings

---

## Dependencies

### Production
- `express@^4.18.2` - Web framework
- `pg@^8.13.1` - PostgreSQL client
- `node-fetch@^3.3.2` - HTTP client
- `dotenv@^16.4.7` - Environment variables
- `csv-stringify@^6.5.2` - CSV generation

### Development
- Node.js >= 18.0.0 required
- PostgreSQL 12+ recommended

---

## Useful Commands

```bash
# Start server
npm start

# Run tests
npm test

# Fetch eBay categories
node get_categories.js

# Test database connection
node test.js

# View logs
tail -f ebay-scanner-$(date +%Y-%m-%d).txt

# Heroku logs
heroku logs --tail

# Database backup
pg_dump $DATABASE_URL > backup.sql
```

---

## Security Considerations

1. **API Credentials** - Never commit `.env` file
2. **SQL Injection** - All queries use parameterized statements
3. **Rate Limiting** - Built-in to prevent API abuse
4. **SSL** - Database connections use SSL in production
5. **CORS** - Not configured (consider for production API)

---

## Performance Optimizations

1. **Connection Pooling** - PostgreSQL connection pool
2. **Batch Processing** - Process sellers in chunks
3. **Indexing** - Database indexes on frequently queried columns
4. **Caching** - Access token reused across requests
5. **Async Operations** - Non-blocking I/O throughout

---

## Support & Resources

- **eBay Developer Program:** https://developer.ebay.com/
- **eBay Browse API:** https://developer.ebay.com/api-docs/buy/browse/overview.html
- **PostgreSQL Documentation:** https://www.postgresql.org/docs/

---

*Last Updated: 2026-01-31*
