# Flask Deezer Downloader

A minimal Flask web application for searching and downloading music from Deezer using the d-fi-core library.

## Features

- **Search Music**: Search for tracks, albums, artists, and playlists
- **Download Tracks**: Individual track downloads with metadata
- **Download Albums/Playlists**: Batch downloads (planned)
- **Progress Tracking**: Real-time download progress
- **Configuration Management**: ARL cookie, quality settings, download paths
- **Minimal Design**: Clean, simple interface focused on functionality
- **Git Version Control**: Full tracking of changes

## Requirements

- Python 3.7+
- Node.js 12+
- npm or yarn
- Git

## Installation

1. **Clone the repository** (if not already created):
   ```bash
   git clone <repository-url>
   cd flask-deezer-app
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

5. **Ensure d-fi-core is available**:
   - The project expects d-fi-core to be available at `../d-fi-core`
   - If you have it elsewhere, update the `package.json` path

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
   - Click download buttons to save tracks

## Configuration

The application stores configuration in `config.json`:

```json
{
  "arl": "your_arl_cookie_here",
  "download_path": "./downloads",
  "quality": 3,
  "organize_by_folder": true,
  "create_playlist_folders": false
}
```

- `arl`: Your Deezer ARL cookie (required)
- `download_path`: Where to save downloaded files
- `quality`: 1 (128kbps), 3 (320kbps), or 9 (FLAC)
- `organize_by_folder`: Create artist folders
- `create_playlist_folders`: Create folders for playlists

## Project Structure

```
flask-deezer-app/
├── app.py                 # Main Flask application
├── config.py             # Configuration management
├── deezer_api.js         # Node.js wrapper for d-fi-core
├── requirements.txt       # Python dependencies
├── package.json          # Node.js dependencies
├── templates/
│   ├── base.html         # Base template
│   └── index.html        # Main interface
├── static/
│   ├── style.css         # Styling
│   └── script.js         # JavaScript utilities
├── downloads/            # Download directory
├── config.json          # Configuration file (auto-generated)
└── README.md            # This file
```

## API Endpoints

- `GET /` - Main interface
- `GET/POST /api/config` - Configuration management
- `GET /api/search` - Search music
- `GET /api/download/track/<id>` - Download track
- `GET /api/download/status/<id>` - Download status
- `GET /api/track/<id>` - Track information
- `GET /api/album/<id>` - Album information

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

1. **"d-fi-core not found"**:
   - Ensure d-fi-core is installed at `../d-fi-core`
   - Update the path in `package.json` if needed

2. **"ARL cookie invalid"**:
   - Get a fresh ARL cookie from Deezer
   - Ensure you're logged in to Deezer in your browser

3. **"Node.js not found"**:
   - Install Node.js from https://nodejs.org
   - Ensure `node` is in your PATH

4. **"Permission denied"**:
   - Check download directory permissions
   - Ensure the application can write to the download path

### Debug Mode

Enable debug logging by setting the log level in `app.py`:

```python
logging.basicConfig(level=logging.DEBUG)
```

## License

MIT License - see LICENSE file for details.

## Disclaimer

This application is for educational purposes only. Please respect copyright laws and the terms of service of music streaming platforms.
