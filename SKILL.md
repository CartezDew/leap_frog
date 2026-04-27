# SKILL.md — GA4 Website Analytics Dashboard Data Parsing & Analysis

## Purpose
This skill defines how to ingest, classify, parse, and analyze Google Analytics 4 (GA4) data exports for a website analytics dashboard. It is designed for mid-market B2B service companies but can be adapted to any GA4 export.

## Scope
- Parsing Excel files containing GA4 data exports
- Auto-classifying sheets by data type (Source, Device, City, Page Path, User, Contact, Medium, Source-Medium-Device)
- Reshaping the GA4 wide monthly format into analysis-ready long format
- Calculating bounce rate, engagement rate, bot scores, user engagement scores
- Producing dashboard-ready aggregations for each report section

---

## 1. FILE INGESTION & SHEET CLASSIFICATION

### 1.1 Upload Flow
The user uploads one or more Excel files (.xlsx). The backend reads every sheet in every uploaded file and classifies each sheet into a data category. No filename-based assumptions are made.

### 1.2 Classification Logic (Hybrid: Sheet Name → Column Headers → User Prompt)

**Step 1 — Match by sheet tab name (case-insensitive, partial match):**

| If tab name contains... | Classify as |
|---|---|
| `source-medium` or `source_medium` | `source_medium_device` |
| `source` (but not `source-medium`) | `source` |
| `medium` | `medium` |
| `device` | `device` |
| `city` | `city` |
| `page path` or `page_path` or `pagepath` | `page_path` |
| `contact` | `contact` |
| `user` | `user` |
| `new - est` or `new_est` or `established` | `new_established` |
| `consolidated` | `consolidated` |

**Important ordering:** Check for `source-medium` BEFORE `source` and `medium` individually, otherwise the compound sheet gets misclassified.

**Step 2 — If tab name does not match, examine column headers:**

Read row 0 and row 1 of the sheet. Look for fingerprint columns:

| Fingerprint columns in row 0 or row 1 | Classify as |
|---|---|
| `Session source` AND `Device category` (both present) | `source_medium_device` |
| `Session source` (without Device category) | `source` |
| `Session medium` | `medium` |
| `Device category` | `device` |
| `City` (as a column header, not a data value) | `city` |
| `Page path and screen class` or values starting with `/` | `page_path` |
| `Effective user ID` or `Stream name` | `user` |
| `how_can_we_help_you_` or `Conversion Date` | `contact` |
| `New / established` | `new_established` |
| `Category` AND `Session Source` AND `Month` (all present) | `consolidated` |

**Step 3 — If neither matches, flag as `unrecognized`** and present the user a dropdown to manually classify.

### 1.3 Pre-built Analysis Sheets (Pass Through)
Some uploaded files may contain pre-built analysis sheets (Executive Summary, Actionable Insights, Bounce Rate Analysis, User ID Engagement, Traffic Sources, Page Path Analysis, Unicorn Pages, Contact Form Intel, Bot Traffic Intelligence). These are display-ready summary sheets created by a prior analysis process. They should be:
- Detected by checking if row 0, column B contains a title string with `|` separator (e.g., "BOUNCE RATE DEEP DIVE  |  Leapfrog Services 2025")
- Stored as-is for rendering in the dashboard's corresponding section
- NOT re-parsed through the wide monthly reshaping logic

---

## 2. DATA STRUCTURE: THE WIDE MONTHLY FORMAT

### 2.1 Format Description
The raw GA4 data sheets (Source, Medium, Device, City, Page Path, Source-Medium-Device, New-Established) all share the same wide monthly layout:

```
Row 0:  [Label Column Header] [1] [1] [1] [1] [1] [1] [1] [1] [2] [2] [2] ...
Row 1:  [Dimension Name]      [Sessions] [Engaged sessions] [Total users] [New users] [Active users] [Bounce rate] [Event count] [Avg engagement time] [Sessions] [Engaged sessions] ...
Row 2+: [Dimension Value]     [Jan data across 8 cols] [Feb data across 8 cols] ... [Dec data across 8 cols]
```

- **Row 0** contains month numbers (1–12), each repeated 8 times
- **Row 1** contains metric names, repeating the same 8 metrics for each month
- **Row 2 onward** contains data rows, one per dimension value (e.g., one row per source, one per city)
- **Total columns:** 1 (label) + 12 months × 8 metrics = **97 columns** (or 98 if there's a second label column like Source-Medium-Device which has both source/medium and device category)

### 2.2 The 8 Metrics Per Month (in order)
```
Column offset 0: Sessions
Column offset 1: Engaged sessions
Column offset 2: Total users
Column offset 3: New users
Column offset 4: Active users
Column offset 5: Bounce rate (raw ratio, NOT percentage)
Column offset 6: Event count
Column offset 7: Average engagement time per session (in seconds)
```

### 2.3 Reshaping Algorithm
Convert wide format to long format (one row per dimension value per month):

```python
def reshape_wide_to_long(df_raw, id_column_name):
    """
    Converts GA4 wide monthly export into long format.
    
    Parameters:
        df_raw: pandas DataFrame read with header=None
        id_column_name: string name for the dimension column (e.g., 'Source', 'City')
    
    Returns:
        pandas DataFrame with columns:
        [id_column_name, Month, Sessions, Engaged_sessions, Total_users, 
         New_users, Active_users, Bounce_rate_raw, Event_count, Avg_engagement_time]
    """
    metrics = [
        'Sessions', 'Engaged_sessions', 'Total_users', 'New_users',
        'Active_users', 'Bounce_rate_raw', 'Event_count', 'Avg_engagement_time'
    ]
    records = []
    for row_i in range(2, len(df_raw)):
        label = df_raw.iloc[row_i, 0]
        if pd.isna(label) or str(label).strip() in ['Grand Total', '']:
            continue
        for month in range(1, 13):
            base_col = 1 + (month - 1) * 8
            record = {id_column_name: str(label).strip(), 'Month': month}
            for k, metric in enumerate(metrics):
                try:
                    val = df_raw.iloc[row_i, base_col + k]
                    record[metric] = float(val) if pd.notna(val) else 0.0
                except (IndexError, ValueError):
                    record[metric] = 0.0
            records.append(record)
    return pd.DataFrame(records)
```

**For Source-Medium-Device sheets:** The first TWO columns are labels (source/medium in col 0, device category in col 1). Adjust `base_col = 2 + (month - 1) * 8` and capture both label columns.

### 2.4 Special Case: Contact Sheet
The Contact sheet does NOT use the wide monthly format. It has a flat table structure:

```
Row 0 (headers): user | how_can_we_help_you_ | Conversion Date | Conversion Page | Conversion Title
Row 1+: data rows
```

Parse with `pd.read_excel(sheet_name='Contact', header=0)` directly. No reshaping needed.

### 2.5 Special Case: User Sheet
The User sheet does NOT use the wide monthly format. It has a flat table structure:

```
Row 0 (headers): Effective user ID | Stream name | Month | New users | Sessions | Views | Views per session | Engaged sessions | Bounce rate | Average session duration | Event count | Events per session
Row 1+: data rows (one row per user ID per month)
```

Parse with `pd.read_excel(sheet_name='User', header=0)` directly. No reshaping needed.

**Note:** The Month column in the User sheet contains month NAMES as strings ("January", "February", etc.), NOT month numbers. Convert to integers using:
```python
month_map = {'January':1, 'February':2, 'March':3, 'April':4, 'May':5, 'June':6,
             'July':7, 'August':8, 'September':9, 'October':10, 'November':11, 'December':12}
df['Month'] = df['Month'].map(month_map)
```

### 2.6 Special Case: Consolidated Data Sheet
The Consolidated Data sheet is already in long format:

```
Row 0 (headers): Month | Date | Category | Session Source | Sessions | Engaged sessions | Total users | New users | Active users | Bounce rate | Bounce rate % | Event count | Average engagement time per session | Remove_Noise
Row 1+: data rows
```

Parse with `pd.read_excel(sheet_name='Consolidated Data', header=0)`. The `Category` column indicates which dimension is represented (Medium, Source, Device, City). Filter by Category to isolate each dimension.

---

## 3. CALCULATED METRICS & FORMULAS

### 3.1 Bounce Rate
```
Bounce Rate = 1 − (Engaged Sessions ÷ Total Sessions)
```
**IMPORTANT:** Do NOT use the raw `Bounce_rate_raw` column from the GA4 export directly for display. Instead, always calculate bounce rate from the Engaged Sessions and Sessions columns. The raw column stores a per-row ratio that may differ from the aggregate calculation when summing across months or dimension values.

**Display format:** Percentage with one decimal place (e.g., "38.1%")

### 3.2 Engagement Rate
```
Engagement Rate = Engaged Sessions ÷ Total Sessions
```
This is the inverse of bounce rate. Display as percentage.

### 3.3 New User Rate
```
New User Rate = New Users ÷ Total Users
```

### 3.4 Return Rate
```
Return Rate = 1 − (New Users ÷ Total Users)
```
A return rate near 0% indicates almost all users are first-time visitors — suspicious for direct traffic, expected for organic.

### 3.5 Events Per Session
```
Events Per Session = Event Count ÷ Sessions
```

### 3.6 Month-over-Month Change
```
MoM Change = Current Month Sessions − Prior Month Sessions
MoM % Change = (Current Month Sessions − Prior Month Sessions) ÷ Prior Month Sessions
```

---

## 4. BOT TRAFFIC CLASSIFICATION

### 4.1 City-Level Bot Scoring
Apply the following scoring to each city in the City data:

| Condition | Points | Notes |
|---|---|---|
| Avg engagement time < 1.0 sec AND sessions > 50 | +4 | Near-zero session duration at volume |
| Avg engagement time < 3.0 sec AND sessions > 30 | +2 | Very low duration at moderate volume |
| Bounce rate ≥ 90% | +4 | Almost no engagement |
| Bounce rate ≥ 75% | +2 | Very high bounce |
| Return rate < 2% AND sessions > 50 | +2 | Almost all "new" users at volume = crawlers |
| City is in KNOWN_DATACENTER_CITIES list | +3 | Known hosting/datacenter location |
| Events per session < 1.0 AND sessions > 20 | +2 | Near-zero interaction |

**KNOWN_DATACENTER_CITIES:**
```python
KNOWN_DATACENTER_CITIES = [
    'Lanzhou', 'Shanghai', 'Lhasa', 'Hangzhou', 'Beijing', 'Guangzhou', 
    'Zhengzhou', 'Shenzhen',  # Chinese datacenter clusters
    'Moses Lake', 'Boydton', 'Ashburn', 'Council Bluffs',  # US datacenter hubs (Microsoft, AWS)
    'Des Moines', 'Singapore', 'North Charleston'  # Additional datacenter/cloud locations
]
```

**Classification thresholds:**

| Score | Label | Color Code |
|---|---|---|
| ≥ 7 | 🤖 CONFIRMED BOT | Red |
| 4–6 | ⚠️ LIKELY BOT | Amber |
| 2–3 | 🔍 SUSPICIOUS | Yellow |
| 0–1 | ✅ HUMAN TRAFFIC | Green |

### 4.2 Source-Level Bot Scoring
Apply similar scoring to traffic sources:

| Condition | Points |
|---|---|
| Avg engagement time < 2.0 sec AND sessions > 20 | +3 |
| Bounce rate ≥ 90% AND sessions > 10 | +4 |
| Return rate < 1% AND sessions > 20 | +2 |
| Source is in KNOWN_SPAM_SOURCES list | +5 |

**KNOWN_SPAM_SOURCES:**
```python
KNOWN_SPAM_SOURCES = [
    'JBCF Zfzcfefuvc',  # Obfuscated bot injection string
    'search.webnavigator.com',  # Known bot crawler
    'moodle.emica.ca',  # LMS scraper bot
]
```

Use the same classification thresholds as city-level scoring.

---

## 5. USER ID ANALYSIS

### 5.1 User ID Type Classification
Classify each user ID by its format:

```python
def classify_user_id(uid):
    uid_str = str(uid)
    if uid_str.startswith('amp-'):
        return 'AMP'  # Google AMP cache mobile user
    if '.' in uid_str:
        parts = uid_str.split('.')
        suffix = parts[-1] if len(parts) == 2 else ''
        if suffix == '2':
            return 'Cross-Device (.2)'  # GA4 cross-device identity bridge
        elif suffix in ('17', '18'):
            return 'Google Signals (.17/.18)'  # Google Signals composite
        else:
            return 'Fractional (other)'
    return 'Standard'  # Normal GA4 client ID
```

### 5.2 User Engagement Scoring
Aggregate each user across all months, then classify:

```python
# Aggregate per user
user_agg = user_df.groupby('User_ID').agg(
    Total_Sessions=('Sessions', 'sum'),
    Total_Views=('Views', 'sum'),
    Total_Engaged=('Engaged_sessions', 'sum'),
    Total_Events=('Event_count', 'sum'),
    Months_Active=('Month', 'nunique'),
    Avg_Session_Duration=('Avg_session_duration', 'mean'),
    Avg_Views_Per_Session=('Views_per_session', 'mean'),
)
user_agg['Engagement_Rate'] = user_agg['Total_Engaged'] / user_agg['Total_Sessions']
```

**High-engagement user definition:**
- Sessions ≥ 3
- Engagement rate ≥ 60%
- Average session duration ≥ 60 seconds
- Bot score < 3

**Multi-month user definition:**
- Months active ≥ 3
- Sessions ≥ 5
- Engagement rate ≥ 50%

### 5.3 User Bot Score
```python
def user_bot_score(row):
    score = 0
    if str(row['User_ID']).endswith('.2'): score += 1  # Mild signal, not conclusive
    if str(row['User_ID']).startswith('amp-'): score += 1  # AMP cache, mild signal
    if row['Total_Sessions'] > 0 and row['Total_Engaged'] == 0: score += 3
    if row['Avg_Session_Duration'] < 2 and row['Total_Sessions'] > 3: score += 2
    if row['Total_Views'] == 0 and row['Total_Sessions'] > 0: score += 2
    if row['Total_Sessions'] > 10 and row['Engagement_Rate'] < 0.1: score += 2
    return score
```

### 5.4 User Persona Assignment
For high-engagement users (bot score < 3), assign behavioral personas:

| Condition | Persona |
|---|---|
| Sessions ≥ 15 AND duration ≥ 300s AND months ≥ 3 | Deep Researcher |
| Sessions ≥ 15 AND duration ≥ 300s AND months ≤ 2 | Intensive Evaluator |
| Sessions ≥ 8 AND duration ≥ 400s AND engagement ≥ 70% | High-Value Prospect |
| Sessions ≥ 8 AND duration ≥ 100s AND months ≥ 3 | Engaged Returning User |
| Sessions ≥ 5 AND duration ≥ 600s | Deep Reader |
| Sessions ≥ 5 AND views/session ≥ 4 | Site Explorer |
| Sessions ≥ 3 AND duration ≥ 300s AND engagement ≥ 80% | Strong Prospect |
| Default | Engaged Visitor |

---

## 6. UNICORN PAGE IDENTIFICATION

A **Unicorn Page** meets BOTH of these criteria:
- Annual sessions ≥ 100
- Calculated bounce rate ≤ 25%

These pages represent the site's best-performing content — visitors who land on them overwhelmingly engage rather than exit.

**Opportunity Pages** (high traffic, high bounce) meet:
- Annual sessions ≥ 100
- Calculated bounce rate ≥ 45%

These pages attract traffic but fail to retain visitors. They are candidates for CTA additions, content improvements, or internal link bridges to service pages.

---

## 7. CONTACT FORM CLASSIFICATION

Classify each contact form submission by scanning the `how_can_we_help_you_` text field:

```python
def classify_contact(text):
    if pd.isna(text):
        return 'Unknown'
    t = str(text).lower()
    if any(k in t for k in ['msp', 'managed it', 'managed service', 'outsourc', 
                              'it support', 'cybersecurity service', 'cmmc', 
                              'microsoft 365', 'help desk', 'it service']):
        return 'Sales Lead'
    if any(k in t for k in ['partner', 'collaboration', 'subcontract']):
        return 'Partnership'
    if any(k in t for k in ['cleaning', 'janitorial', 'payment processing', 
                              'wikipedia', 'staffing', 'spam']):
        return 'Spam'
    if any(k in t for k in ['interview', 'job', 'resume', 'career', 'position']):
        return 'Job Seeker'
    if any(k in t for k in ['bitlocker', 'citrix', 'network error', 'unstable']):
        return 'Support Request'
    if any(k in t for k in ['interested in services', 'looking to get started', 
                              'it & cyber']):
        return 'Sales Lead'
    return 'Needs Review'
```

---

## 8. DASHBOARD SECTIONS & DATA REQUIREMENTS

### 8.1 Executive Summary (Landing Page)
**Data needed:** Medium (annual aggregation), Page Path (homepage row), Contact (count + classification)
**KPIs to display:**
- Total Sessions (sum of all Medium sessions)
- Total Users (sum of all Medium total_users)
- New Users (sum of all Medium new_users)
- Site Average Bounce Rate (1 − sum_engaged / sum_sessions across all mediums)
- Contact Page Sessions (Page Path row for `/contact/`)
- Monthly trend chart (sessions and bounce rate by month)
- Top 10 key insights list

### 8.2 Actionable Insights
**Data needed:** All data types
**Display:** Pre-built analysis sheet if available, otherwise generate from bot actions + user leverage plays + bounce rate fixes (see prior analysis outputs)

### 8.3 Bounce Rate Analysis
**Data needed:** Medium (annual by channel), Page Path (homepage monthly), Page Path (high-bounce pages)
**Display:**
- Bounce rate by channel (medium) with color coding (red > 55%, amber > 45%, green < 40%)
- Homepage monthly bounce rate trend
- High-traffic + high-bounce opportunity pages (sessions ≥ 100, bounce ≥ 45%)
- Bot impact estimate on homepage bounce

### 8.4 User ID Engagement
**Data needed:** User sheet
**Display:**
- Summary stats (total IDs, clean human, confirmed bot, high-engage, multi-month)
- Behavioral benchmarks table (avg duration, views/session, events/session, engagement rate, months active)
- Top 50 engaged user profiles with persona labels
- Multi-month user deep dive

### 8.5 Traffic Sources
**Data needed:** Source (annual aggregation), Device (annual), City (annual top 20)
**Display:**
- Top sources ranked by sessions with bounce rate and assessment
- Device category breakdown with percentage of total
- Top cities with bot classification labels

### 8.6 Page Path Analysis
**Data needed:** Page Path (annual aggregation top 25), Page Path (contact page monthly)
**Display:**
- Top 25 pages by sessions with bounce rate, users, events, content role
- Contact page monthly performance table

### 8.7 Unicorn Pages
**Data needed:** Page Path (filtered for unicorn criteria)
**Display:**
- All pages with sessions ≥ 100 AND bounce rate ≤ 25%, sorted by bounce rate ascending
- Manufacturing pages callout (pages containing 'manufactur' in path)
- Each unicorn page with a "How to Leverage" note

### 8.8 Contact Form Intel
**Data needed:** Contact sheet
**Display:**
- All submissions with classification label
- Lead type summary (count and percentage by category)
- Timeline of submissions by month

### 8.9 Bot Traffic Intelligence
**Data needed:** City (with bot scores), Source (with bot scores), User (with bot scores)
**Display:**
- Summary tiles (confirmed bot sessions, likely bot, suspicious, clean human, bot user IDs, fractional IDs)
- City bot classification table (top 60 cities by sessions)
- Source bot classification table
- Bot scoring methodology explanation

---

## 9. STYLING REQUIREMENTS

### 9.1 Brand Colors (Leapfrog Services)
```css
:root {
  --brand-purple: #522E91;
  --brand-purple-dark: #3A1E69;
  --brand-purple-light: #6B43AA;
  --brand-green: #9ACA3C;
  --brand-green-dark: #7BA82C;
  --text-white: #FFFFFF;
  --text-dark: #1A1A1A;
  --text-muted: #C9B8E0;
  --bg-card: #FFFFFF;
  --bg-band: #F3F4F6;
  --border-light: #E5E7EB;
  --status-red: #DC2626;
  --status-amber: #D97706;
  --status-green: #16A34A;
}
```

### 9.2 CSS Rules
- **ALL styling must be in separate `.css` files.** No inline styles in JSX or HTML. No `style={{}}` props in React components. Every visual property lives in a CSS class.
- Use CSS modules (`.module.css`) or a global stylesheet — never inline.
- Navigation sidebar: fixed left, 260px width, `--brand-purple-dark` background
- Active nav item: `--brand-green` left border accent, slightly lighter background
- Cards: white background, subtle shadow (`0 1px 3px rgba(0,0,0,0.1)`), 8px border-radius
- Tables: header row `--brand-purple` background with white text, alternating row banding `--bg-band`
- Bounce rate color coding: red ≥ 55%, amber ≥ 45%, green < 40%
- Bot classification color coding: red = confirmed, amber = likely, yellow = suspicious, green = human
- Charts: use `--brand-purple` for primary series, `--brand-green` for secondary, `--status-red` for bounce rate

### 9.3 Typography
- Font family: `'Inter', 'Calibri', sans-serif`
- Navigation items: 14px, medium weight
- Page titles: 28px, bold
- Section headers: 20px, semibold
- Body text: 14px, regular
- KPI numbers: 36px, bold
- KPI labels: 12px, uppercase, letter-spacing 0.05em

---

## 10. MONTH NAME MAPPING
```python
MONTH_MAP = {
    'January': 1, 'February': 2, 'March': 3, 'April': 4,
    'May': 5, 'June': 6, 'July': 7, 'August': 8,
    'September': 9, 'October': 10, 'November': 11, 'December': 12
}

MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
```

---

## 11. ERROR HANDLING

- If a sheet has fewer than 97 columns in wide format, pad missing months with zeros
- If a metric value is NaN, treat as 0.0
- If Sessions = 0 for a row, set Bounce Rate to 0 (avoid division by zero)
- If a sheet is entirely empty, skip it and log a warning
- If the uploaded file is not .xlsx or .xls, return a user-friendly error message
- If no sheets match any classification, show all sheet names and ask the user to classify manually

---

## 12. DEFENSIVE PARSING — HANDLING MISSING, RENAMED, OR REORDERED COLUMNS

This section is critical. GA4 exports vary between accounts, export methods (UI download vs. API vs. BigQuery), date ranges, and GA4 versions. The parser must never crash due to a missing column. It must detect what is present, map it correctly, fill gaps gracefully, and tell the user what happened.

### 12.1 Column Name Normalization

Before any matching, normalize every column header:

```python
def normalize_header(header):
    """Normalize a column header for fuzzy matching."""
    if pd.isna(header):
        return ''
    s = str(header).strip().lower()
    s = s.replace('_', ' ').replace('-', ' ')  # underscores and hyphens → spaces
    s = ' '.join(s.split())  # collapse multiple spaces
    return s
```

This ensures "Engaged Sessions", "engaged_sessions", "Engaged sessions ", "ENGAGED SESSIONS", and "engaged-sessions" all normalize to `"engaged sessions"` and match correctly.

### 12.2 Known Aliases for Each Metric

The parser should recognize multiple names for the same metric. If the normalized header matches ANY alias, map it to the canonical metric name:

```python
METRIC_ALIASES = {
    'sessions': ['sessions', 'session count', 'total sessions'],
    'engaged_sessions': ['engaged sessions', 'engaged session count', 'engagedsessions'],
    'total_users': ['total users', 'users', 'user count', 'unique users'],
    'new_users': ['new users', 'new user count', 'first time users', 'first visit users'],
    'active_users': ['active users', 'active user count'],
    'bounce_rate_raw': ['bounce rate', 'bouncerate', 'bounce rate %', 'bounce rate pct'],
    'event_count': ['event count', 'events', 'total events', 'event total'],
    'avg_engagement_time': [
        'average engagement time per session', 'avg engagement time',
        'average session duration', 'avg session duration',
        'engagement time', 'session duration'
    ],
    'views': ['views', 'screen views', 'pageviews', 'page views', 'screen page views'],
    'views_per_session': ['views per session', 'pages per session', 'pageviews per session',
                          'screen views per session'],
    'events_per_session': ['events per session', 'event count per session'],
    'effective_user_id': ['effective user id', 'user id', 'userid', 'client id', 'ga client id'],
    'stream_name': ['stream name', 'data stream', 'stream'],
    'conversion_date': ['conversion date', 'date', 'submission date', 'form date'],
    'conversion_page': ['conversion page', 'page', 'landing page', 'form page'],
    'how_can_we_help': ['how can we help you', 'how can we help you_', 'message', 'inquiry',
                        'comments', 'form message', 'description'],
}

def match_metric(normalized_header, aliases=METRIC_ALIASES):
    """Return the canonical metric name for a normalized header, or None."""
    for canonical, alias_list in aliases.items():
        if normalized_header in alias_list:
            return canonical
    return None
```

### 12.3 Required vs. Optional Metrics

Not all metrics are equally important. If a required metric is missing, the parser should warn the user. If an optional metric is missing, the dashboard displays "N/A" for that field.

**For wide monthly sheets (Source, Medium, Device, City, Page Path):**

| Metric | Required? | If Missing |
|---|---|---|
| Sessions | REQUIRED | Cannot calculate any KPI — show error to user |
| Engaged Sessions | REQUIRED | Cannot calculate bounce rate — show error to user |
| Total Users | REQUIRED | Cannot calculate user counts — show error to user |
| New Users | Optional | Display "N/A" for new user rate; default to 0 |
| Active Users | Optional | Not used in any primary KPI; default to 0 |
| Bounce Rate (raw) | Optional | Calculated from Sessions and Engaged Sessions anyway |
| Event Count | Optional | Display "N/A" for events per session; default to 0 |
| Avg Engagement Time | Optional | Display "N/A" for duration metrics; default to 0 |

**For the User sheet:**

| Column | Required? | If Missing |
|---|---|---|
| Effective User ID | REQUIRED | Cannot identify users — show error |
| Month | REQUIRED | Cannot aggregate by time — show error |
| Sessions | REQUIRED | Cannot calculate engagement — show error |
| Engaged Sessions | REQUIRED | Cannot calculate bounce — show error |
| Views | Optional | Default to 0, skip views-based metrics |
| Views Per Session | Optional | Default to 0 |
| Event Count | Optional | Default to 0 |
| Events Per Session | Optional | Default to 0 |
| Average Session Duration | Optional | Default to 0, skip duration-based personas |
| New Users | Optional | Default to 0 |
| Stream Name | Optional | Ignore if missing |
| Bounce Rate | Optional | Calculated from Sessions and Engaged Sessions |

**For the Contact sheet:**

| Column | Required? | If Missing |
|---|---|---|
| how_can_we_help (or alias) | REQUIRED | Cannot classify leads — show error |
| Conversion Date | Optional | Skip timeline chart; show "Date unknown" |
| Conversion Page | Optional | Skip entry page analysis |
| User ID | Optional | Skip user-level cross-reference |

### 12.4 Dynamic Column Detection for Wide Monthly Format

Instead of hardcoding column offsets (offset 0 = Sessions, offset 1 = Engaged sessions), read Row 1 dynamically and build a position map:

```python
def detect_wide_format_columns(df_raw):
    """
    Reads Row 1 of a wide-format GA4 sheet and returns a dict mapping
    canonical metric names to their column offset within each monthly block.
    
    Returns:
        dict: {canonical_name: offset_within_block} e.g., {'sessions': 0, 'engaged_sessions': 1}
        int: metrics_per_month (number of columns per month block)
        int: num_months (number of month blocks detected)
        list: warnings (any issues found)
    """
    warnings = []
    
    # Read Row 0 to count months
    row0 = df_raw.iloc[0, 1:].tolist()  # skip label column
    month_numbers = [v for v in row0 if pd.notna(v)]
    # Count distinct month transitions
    months_found = []
    current_month = None
    for v in row0:
        if pd.notna(v) and v != current_month:
            months_found.append(v)
            current_month = v
    num_months = len(months_found)
    
    # Read Row 1 to get metric names within the first month block
    row1 = df_raw.iloc[1, 1:].tolist()  # skip label column
    
    # Find how many columns are in the first month block
    # (count consecutive non-NaN headers before the pattern repeats)
    first_block_headers = []
    for v in row1:
        if pd.isna(v):
            break
        first_block_headers.append(normalize_header(v))
        # Check if this header matches the first header (pattern restart)
        if len(first_block_headers) > 1 and first_block_headers[-1] == first_block_headers[0]:
            first_block_headers.pop()  # remove the duplicate
            break
    
    metrics_per_month = len(first_block_headers)
    
    # Map each header to its canonical name
    column_map = {}
    for offset, header in enumerate(first_block_headers):
        canonical = match_metric(header)
        if canonical:
            column_map[canonical] = offset
        else:
            warnings.append(f"Unrecognized metric in column offset {offset}: '{header}'")
    
    # Check for required metrics
    for required in ['sessions', 'engaged_sessions', 'total_users']:
        if required not in column_map:
            warnings.append(f"REQUIRED METRIC MISSING: '{required}' not found in headers. "
                          f"Headers detected: {first_block_headers}")
    
    return column_map, metrics_per_month, num_months, warnings
```

### 12.5 Updated Reshaping Function (Defensive Version)

```python
def reshape_wide_to_long_safe(df_raw, id_column_name):
    """
    Defensive version of the wide-to-long reshaper.
    Dynamically detects columns, handles missing metrics, pads missing months.
    
    Returns:
        tuple: (DataFrame, list_of_warnings)
    """
    column_map, metrics_per_month, num_months, warnings = detect_wide_format_columns(df_raw)
    
    # Determine label column count (1 for most sheets, 2 for Source-Medium-Device)
    label_cols = 1
    row1_col0 = normalize_header(df_raw.iloc[1, 0])
    row1_col1 = normalize_header(df_raw.iloc[1, 1]) if df_raw.shape[1] > 1 else ''
    if 'device' in row1_col1 and ('source' in row1_col0 or 'medium' in row1_col0):
        label_cols = 2  # Source-Medium-Device has 2 label columns
    
    # All canonical metric names we want in the output
    all_metrics = ['sessions', 'engaged_sessions', 'total_users', 'new_users',
                   'active_users', 'bounce_rate_raw', 'event_count', 'avg_engagement_time']
    
    records = []
    for row_i in range(2, len(df_raw)):
        label = df_raw.iloc[row_i, 0]
        if pd.isna(label) or str(label).strip() in ['Grand Total', '']:
            continue
        
        label2 = None
        if label_cols == 2:
            label2 = df_raw.iloc[row_i, 1]
        
        for month_idx in range(num_months):
            base_col = label_cols + month_idx * metrics_per_month
            
            record = {id_column_name: str(label).strip(), 'Month': month_idx + 1}
            if label2 is not None:
                record['Device'] = str(label2).strip() if pd.notna(label2) else ''
            
            for metric in all_metrics:
                if metric in column_map:
                    col = base_col + column_map[metric]
                    if col < df_raw.shape[1]:
                        try:
                            val = df_raw.iloc[row_i, col]
                            record[metric] = float(val) if pd.notna(val) else 0.0
                        except (ValueError, TypeError):
                            record[metric] = 0.0
                    else:
                        record[metric] = 0.0  # Column index out of bounds
                else:
                    record[metric] = 0.0  # Metric not found in this file
            
            records.append(record)
    
    return pd.DataFrame(records), warnings
```

### 12.6 Flat Sheet Column Detection (User, Contact)

For flat-format sheets (User, Contact), use a similar dynamic approach:

```python
def detect_flat_columns(df_raw, expected_aliases):
    """
    Reads the header row of a flat-format sheet and maps each column
    to a canonical name using the alias dictionary.
    
    Parameters:
        df_raw: DataFrame read with header=0 (first row is headers)
        expected_aliases: dict of {canonical_name: [alias_list]}
    
    Returns:
        dict: {canonical_name: actual_column_name_in_df}
        list: warnings
    """
    warnings = []
    column_map = {}
    
    for col in df_raw.columns:
        normalized = normalize_header(col)
        canonical = match_metric(normalized)
        if canonical:
            column_map[canonical] = col  # Map canonical → actual df column name
    
    return column_map, warnings


def safe_read_flat_sheet(df_raw, column_map, required_columns, optional_columns):
    """
    Renames columns to canonical names, fills missing optional columns with defaults.
    
    Returns:
        tuple: (cleaned DataFrame, list_of_warnings)
    """
    warnings = []
    
    # Rename detected columns to canonical names
    rename_map = {actual: canonical for canonical, actual in column_map.items()}
    df = df_raw.rename(columns=rename_map)
    
    # Check required columns
    for req in required_columns:
        if req not in df.columns:
            warnings.append(f"REQUIRED COLUMN MISSING: '{req}'. Dashboard section may be unavailable.")
    
    # Fill missing optional columns with defaults
    for opt, default_val in optional_columns.items():
        if opt not in df.columns:
            df[opt] = default_val
            warnings.append(f"Optional column '{opt}' not found. Defaulting to {default_val}.")
    
    return df, warnings
```

### 12.7 Validation Report

After parsing all sheets, generate a validation report that is displayed to the user on the upload confirmation page:

```python
def generate_validation_report(all_warnings, sheets_found, sheets_expected):
    """
    Returns a structured report for the upload confirmation page.
    """
    report = {
        'status': 'success',  # or 'partial' or 'error'
        'sheets_found': sheets_found,
        'sheets_missing': [s for s in sheets_expected if s not in sheets_found],
        'warnings': all_warnings,
        'critical_errors': [w for w in all_warnings if 'REQUIRED' in w],
        'data_gaps': [w for w in all_warnings if 'Optional' in w or 'Unrecognized' in w],
    }
    
    if report['critical_errors']:
        report['status'] = 'error'
        report['message'] = (
            f"Upload processed with {len(report['critical_errors'])} critical issue(s). "
            f"Some dashboard sections may not display correctly. "
            f"See details below."
        )
    elif report['data_gaps']:
        report['status'] = 'partial'
        report['message'] = (
            f"Upload processed successfully. {len(report['data_gaps'])} optional field(s) "
            f"were not found and will show as N/A in the dashboard."
        )
    else:
        report['status'] = 'success'
        report['message'] = 'All sheets and columns detected successfully. Dashboard is fully populated.'
    
    return report
```

### 12.8 Dashboard Graceful Degradation Rules

When a metric is missing, the dashboard should NOT crash, show a blank page, or display a zero that could be mistaken for real data. Instead:

| Situation | Dashboard Behavior |
|---|---|
| Required metric missing (Sessions, Engaged Sessions, Total Users) | Show a warning banner on the affected page: "This section requires [metric name] data which was not found in the uploaded file." Disable charts/tables that depend on it. |
| Optional metric missing (Event Count, Avg Engagement Time, Views) | Display "—" or "N/A" in the specific cell. All other metrics on the page render normally. Add a small footnote: "Some metrics unavailable in this upload." |
| Entire sheet missing (e.g., no User tab) | Hide the corresponding navigation item or show it grayed out with a tooltip: "Upload a file containing User data to enable this section." |
| Fewer than 12 months of data | Display only the months present. Monthly trend charts auto-adjust their x-axis. KPI tiles show "YTD" instead of "Annual" to reflect partial data. |
| Unrecognized columns present | Ignore them silently. Do not error. Log them in the validation report for developer reference. |
| Duplicate sheet classification (two sheets both match "Source") | Use the larger sheet (more data rows). Log a warning: "Multiple sheets matched 'Source'. Using sheet '[name]' with [N] rows." |

### 12.9 Testing Checklist for Column Resilience

Before deployment, test the parser against these scenarios:

1. **Standard file** — all sheets present, all columns in expected order → should parse with zero warnings
2. **Missing optional columns** — remove "Active users" and "Avg engagement time" from one sheet → should parse with 2 info-level warnings, all other metrics correct
3. **Renamed columns** — change "Engaged sessions" to "Engaged Sessions" (capitalized) → should still match via normalization
4. **Missing entire sheet** — delete the User tab → User ID Engagement nav item should be disabled, all other sections work
5. **Partial months** — provide only January through June (49 columns instead of 97) → should parse 6 months, show "YTD" on tiles
6. **Extra columns** — add a column "Custom Metric 1" that doesn't match any alias → should be silently ignored
7. **Empty file** — upload a .xlsx with no data rows → should show "No data found" message, not crash
8. **Wrong file type** — upload a .csv or .pdf → should show a user-friendly format error
