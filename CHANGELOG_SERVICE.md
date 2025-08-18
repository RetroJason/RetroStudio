# Changelog Service Implementation

## Overview
The changelog service tracks user visits and shows what's changed since their last visit by displaying git commit logs.

## Components Added

### 1. Changelog Service (`scripts/services/changelog-service.js`)
- Tracks last visit timestamp and commit hash using cookies
- Fetches current commit and git logs from admin.php API
- Shows modal with changes since last visit
- Provides testing functions for development

### 2. Admin.php API Enhancement
- Added `/admin.php?api=changelog` endpoint
- Returns current commit hash and git log in JSON format
- Supports `since` parameter for commits since a specific hash
- Supports `limit` parameter for number of commits
- CORS enabled for local development

### 3. Testing Interface in Admin.php
- "Test Changelog Modal" button
- "Reset Visit Tracking" button 
- "View Current Commit" button
- Direct API testing link

## How It Works

1. **First Visit**: Service records current timestamp and commit hash in cookies
2. **Subsequent Visits**: Service compares stored commit hash with current commit
3. **If Different**: Fetches commit log and shows "What's New" modal
4. **If Same**: No modal shown, user is up to date

## Testing the Feature

### Method 1: Admin Panel
1. Visit `http://localhost:8000/admin.php` 
2. Login with password: `retro2025`
3. Use testing buttons in "Changelog Testing" section

### Method 2: Browser Console
1. Visit `http://localhost:8000/index.html`
2. Open browser console
3. Run these commands:

```javascript
// Test the changelog modal manually
window.changelogService.showTestChangelog();

// Reset visit tracking (next visit will show changes)
window.changelogService.resetVisitTracking();

// Check current commit
window.changelogService.getCurrentCommitHash().then(hash => console.log('Current commit:', hash));

// Get recent commits
window.changelogService.getCommitLog().then(commits => console.log('Recent commits:', commits));
```

### Method 3: Simulate New Changes
1. Make some git commits to the repository
2. Reset visit tracking using admin panel or console
3. Refresh the application - should show changelog modal

## API Endpoints

### GET /admin.php?api=changelog
Returns current commit and recent commits:

```json
{
  "current_commit": "full_commit_hash",
  "current_short": "short_hash", 
  "commits": [
    {
      "hash": "short_hash",
      "fullHash": "full_commit_hash",
      "author": "Author Name",
      "email": "author@email.com", 
      "date": "2024-08-16T12:00:00+00:00",
      "message": "Commit message"
    }
  ],
  "timestamp": "2024-08-16T12:00:00+00:00"
}
```

### Parameters
- `since=commit_hash` - Get commits since this hash
- `limit=N` - Limit number of commits (max 50, default 10)

## Cookie Storage
- `retrostudio_last_visit` - Timestamp of last visit
- `retrostudio_last_commit` - Commit hash from last visit
- Both cookies expire after 1 year

## Files Modified/Added
- `scripts/services/changelog-service.js` (new)
- `admin.php` (enhanced with API)
- `index.html` (added script include)
- `version.json` (fallback version info)
- `update-version.sh` and `update-version.bat` (version updaters)

## Future Enhancements
- Integration with GitHub webhooks for automated updates
- More detailed commit formatting (file changes, etc.)
- User preferences for changelog frequency
- Integration with application update mechanism
