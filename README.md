# Deezer D-Fi Web Application

A modern Flask web application for searching, browsing, and downloading music from Deezer with a clean, user-friendly interface.

## Features

- **Search Music**: Search for tracks, albums, artists, and playlists
- **Album Detail Pages**: Browse complete albums with track listings and artwork
- **Download Tracks**: Individual track downloads with metadata
- **Download Albums**: Full album downloads with organized file structure
- **Progress Tracking**: Real-time download progress with status updates
- **Responsive Design**: Modern, mobile-friendly interface
- **Configuration Management**: ARL cookie, quality settings, download paths
- **Git Version Control**: Full tracking of changes

## Requirements

- Python 3.7+
- Node.js 12+
- npm or yarn
- Git

## Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/mthsgrc/deezer-d-fi.git
   cd deezer-d-fi
   ```

2. **Create and activate virtual environment**:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install Python dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Install Node.js dependencies**:
   ```bash
   npm install
   ```

The application will automatically download and use the published d-fi-core package from npm.

## Usage

1. **Start the Flask application**:
   ```bash
   source venv/bin/activate && python app.py
   ```

2. **Open your browser** and navigate to `http://localhost:5000`

3. **Configure your ARL cookie**:
   - Go to Deezer in your browser
   - Open developer tools and find your ARL cookie
   - Enter it in the configuration section

4. **Search and download music**:
   - Use the search bar to find music
   - **For albums**: Click on album titles to view detailed track listings
   - **For tracks**: Click download buttons to save individual tracks
   - **From album pages**: Download individual tracks or the entire album

## Configuration

The application stores configuration in `config.json`:

```json
{
  "arl": "your_arl_cookie_here",
  "download_path": "./downloads",
  "quality": 3,
  "organize_by_folder": true,
  "create_playlist_folders": false,
  "track_path_template": "{artist}/{album}/{track_number:02d} - {track}",
  "album_path_template": "{artist}/{album}"
}
```

- `arl`: Your Deezer ARL cookie (required)
- `download_path`: Where to save downloaded files
- `quality`: 1 (128kbps), 3 (320kbps), or 9 (FLAC)
- `organize_by_folder`: Create artist folders
- `create_playlist_folders`: Create folders for playlists
- `track_path_template`: Template for individual track file paths
- `album_path_template`: Template for album folder structure

## Project Structure

```
deezer-d-fi/
├── app.py                 # Main Flask application
├── config.py             # Configuration management
├── deezer_api.js         # Node.js wrapper for d-fi-core
├── requirements.txt      # Python dependencies
├── package.json          # Node.js dependencies
├── templates/
│   ├── base.html         # Base template
│   ├── index.html        # Main interface
│   └── album_detail.html # Album detail page
├── static/
│   ├── style.css         # Styling
│   └── script.js         # JavaScript utilities
├── downloads/            # Download directory
├── config.json          # Configuration file (auto-generated)
└── README.md            # This file
```

## API Endpoints

- `GET /` - Main interface
- `GET /album/<id>` - Album detail page with track listing
- `GET/POST /api/config` - Configuration management
- `GET /api/search` - Search music
- `GET /api/download/track/<id>` - Download track
- `GET /api/download/album/<id>` - Download entire album
- `GET /api/download/status/<id>` - Download status
- `GET /api/track/<id>` - Track information
- `GET /api/album/<id>` - Album information (JSON API)

## Album Detail Pages

The application features dedicated album detail pages that provide:

- **Large album artwork** (250x250px) for visual browsing
- **Complete track listings** with track numbers, titles, and durations
- **Individual track downloads** with one-click download buttons
- **Full album download** for batch downloading all tracks
- **Responsive design** that works on desktop and mobile devices
- **Clean, modern interface** with hover effects and smooth interactions

### How to Use Album Detail Pages

1. Search for albums using the search bar
2. Click on any album in the search results to open its detail page
3. Browse the track listing and artwork
4. Download individual tracks or the entire album as needed

## Getting ARL Cookie

1. Open Deezer in your web browser
2. Log in to your account
3. Open developer tools (F12)
4. Go to Application/Storage → Cookies → https://www.deezer.com
5. Find the `arl` cookie and copy its value

## Development

The application uses a hybrid Python/Node.js architecture:

- **Flask** handles the web interface and user interactions
- **Node.js** with **d-fi-core** handles Deezer API communication
- **Subprocess** communication bridges the two

This approach allows us to leverage the existing d-fi-core library while building a Python web application.

## Git Workflow

The project is tracked with Git from initialization:

```bash
# View commit history
git log --oneline

# View current status
git status

# Add changes
git add .

# Commit changes
git commit -m "Descriptive message"
```

## Troubleshooting

### Common Issues

1. **"ARL cookie invalid"**:
   - Get a fresh ARL cookie from Deezer
   - Ensure you're logged in to Deezer in your browser

2. **"Node.js not found"**:
   - Install Node.js from https://nodejs.org
   - Ensure `node` is in your PATH

3. **"Permission denied"**:
   - Check download directory permissions
   - Ensure the application can write to the download path

4. **"Module not found" errors**:
   - Run `npm install` to install Node.js dependencies
   - Run `pip install -r requirements.txt` for Python dependencies

### Debug Mode

Enable debug logging by setting the log level in `app.py`:

```python
logging.basicConfig(level=logging.DEBUG)
```

## License

MIT License - see LICENSE file for details.

## Disclaimer

This application is for educational purposes only. Please respect copyright laws and the terms of service of music streaming platforms.
