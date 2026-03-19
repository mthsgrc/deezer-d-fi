from flask import Flask, render_template, request, jsonify, send_file
from flask_cors import CORS
import subprocess
import json
import os
import sys
from pathlib import Path
import threading
import time
import weakref
from concurrent.futures import ThreadPoolExecutor, as_completed
import logging
import re
from config import Config

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Performance improvements: DownloadManager with automatic cleanup
class DownloadManager:
    """Manages download progress tracking with automatic cleanup"""
    
    def __init__(self):
        self._downloads = {}
        self._cleanup_thread = None
        self._running = True
        self._start_cleanup_thread()
    
    def _start_cleanup_thread(self):
        """Start background cleanup thread"""
        def cleanup_worker():
            while self._running:
                try:
                    current_time = time.time()
                    to_remove = []
                    for download_id, data in self._downloads.items():
                        status = data.get('status', '')
                        created = data.get('created_time', current_time)
                        
                        # Remove completed/error downloads after 5 minutes
                        if status in ['completed', 'error'] and current_time - created > 300:
                            to_remove.append(download_id)
                        # Remove active downloads after 1 hour (they're likely stuck)
                        elif status not in ['completed', 'error'] and current_time - created > 3600:
                            to_remove.append(download_id)
                    
                    for download_id in to_remove:
                        del self._downloads[download_id]
                        logger.info(f"Cleaned up download {download_id}")
                        
                except Exception as e:
                    logger.error(f"Cleanup error: {e}")
                time.sleep(60)  # Run cleanup every minute
        
        self._cleanup_thread = threading.Thread(target=cleanup_worker, daemon=True)
        self._cleanup_thread.start()
    
    def add_download(self, download_id, initial_data=None):
        """Add a new download tracking entry"""
        self._downloads[download_id] = {
            'created_time': time.time(),
            'status': 'starting',
            'progress': 0,
            'message': 'Initializing...',
            **(initial_data or {})
        }
    
    def update_download(self, download_id, **updates):
        """Update download progress"""
        if download_id in self._downloads:
            self._downloads[download_id].update(updates)
    
    def get_download(self, download_id):
        """Get download status"""
        return self._downloads.get(download_id)
    
    def remove_download(self, download_id):
        """Remove download tracking"""
        self._downloads.pop(download_id, None)
    
    def shutdown(self):
        """Shutdown cleanup thread"""
        self._running = False
        if self._cleanup_thread:
            self._cleanup_thread.join(timeout=1)

# Performance improvements: Smart polling with exponential backoff
class SmartPoller:
    """Intelligent polling with exponential backoff"""
    
    def __init__(self):
        self._poll_intervals = {
            'track': {'min': 1, 'max': 10, 'max_attempts': 60},
            'album': {'min': 1, 'max': 10, 'max_attempts': 120},
            'artist': {'min': 1, 'max': 10, 'max_attempts': 300}
        }
    
    def calculate_interval(self, attempt, download_type, current_status=None):
        """Calculate next poll interval based on download type and status"""
        config = self._poll_intervals.get(download_type, self._poll_intervals['track'])
        
        # Faster polling when status changes or early in process
        if attempt < 3 or current_status in ['starting', 'fetching_info']:
            return config['min']
        
        # Exponential backoff with jitter
        base_interval = min(config['min'] * (2 ** min(attempt // 5, 4)), config['max'])
        jitter = base_interval * 0.1 * (0.5 - time.time() % 1)  # Add small randomness
        
        return base_interval + jitter

# Initialize performance managers
download_manager = DownloadManager()
smart_poller = SmartPoller()

# Thread pool for downloads (max 3 concurrent)
thread_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix='download')

# Initialize configuration
config = Config()

# Ensure downloads directory exists
Path(config.get('download_path')).mkdir(parents=True, exist_ok=True)

# Old global variable - REPLACED by DownloadManager above
download_progress = {}  # Keep for backward compatibility during transition

class PathTemplate:
    """Handles path template substitution with metadata keywords"""
    
    @staticmethod
    def sanitize_filename(name):
        """Remove or replace characters that are unsafe for filenames"""
        if not name:
            return "Unknown"
        
        # Replace problematic characters (but keep path separators for directory structure)
        unsafe_chars = ['<', '>', ':', '"', '\\', '|', '?', '*']
        sanitized = name
        for char in unsafe_chars:
            sanitized = sanitized.replace(char, '_')
        
        # Replace forward slashes only if they're not meant to be path separators
        # This allows template paths like {artist}/{album} to work
        # sanitized = sanitized.replace('/', '_')  # Commented out to allow path structure
        
        # Remove leading/trailing spaces and dots
        sanitized = sanitized.strip(' .')
        
        # Ensure it's not empty
        if not sanitized:
            return "Unknown"
        
        return sanitized
    
    @staticmethod
    def substitute_template(template, metadata):
        """Replace keywords in template with actual metadata"""
        if not template:
            return "Unknown"
        
        # Default values for missing metadata
        defaults = {
            'artist': 'Unknown Artist',
            'album': 'Unknown Album',
            'track': 'Unknown Track',
            'track_number': 1,
            'year': 'Unknown Year',
            'playlist_name': 'Unknown Playlist'
        }
        
        # Merge provided metadata with defaults
        template_data = {**defaults, **metadata}
        
        # Sanitize string values
        for key, value in template_data.items():
            if isinstance(value, str):
                template_data[key] = PathTemplate.sanitize_filename(value)
        
        try:
            # Format the template
            result = template.format(**template_data)
            return PathTemplate.sanitize_filename(result)
        except (KeyError, ValueError) as e:
            logger.warning(f"Template substitution failed: {e}")
            return PathTemplate.sanitize_filename(template)
    
    @staticmethod
    def validate_template(template):
        """Validate that template contains only supported keywords"""
        if not template:
            return True, "Template is empty"
        
        # Find all {keyword} patterns
        pattern = r'\{([^}]+)\}'
        matches = re.findall(pattern, template)
        
        # Supported keywords
        supported_keywords = {
            'artist', 'album', 'track', 'track_number', 'year', 'playlist_name'
        }
        
        for match in matches:
            # Handle format specifiers like {track_number:02d}
            keyword = match.split(':')[0]
            if keyword not in supported_keywords:
                return False, f"Unsupported keyword: {keyword}"
        
        return True, "Template is valid"

class DeezerAPI:
    def __init__(self):
        self.node_script = Path(__file__).parent / 'deezer_api.js'
        self.arl = config.get('arl')
    
    def call_node_script(self, method, params=None):
        """Call Node.js script to interact with d-fi-core"""
        try:
            # Use absolute paths and ensure proper working directory
            script_dir = Path(__file__).parent
            cmd = [
                'node', 
                str(script_dir / 'deezer_api.js'), 
                method,
                json.dumps(params or {}),
                self.arl or ''
            ]
            
            logger.info(f"Calling Node.js script: {method}")
            logger.info(f"Working directory: {script_dir}")
            logger.info(f"Command: {' '.join(cmd)}")
            logger.info(f"ARL length: {len(self.arl) if self.arl else 0}")
            
            # Set environment for OpenSSL legacy provider
            env = os.environ.copy()
            env['NODE_OPTIONS'] = '--openssl-legacy-provider'
            
            result = subprocess.run(
                cmd,
                cwd=script_dir,
                capture_output=True,
                text=True,
                timeout=30,
                env=env
            )
            
            if result.returncode != 0:
                error_msg = result.stderr.strip() or "Unknown error"
                logger.error(f"Node script error: {error_msg}")
                raise Exception(f"Node script error: {error_msg}")
            
            # Check if stdout is empty
            if not result.stdout.strip():
                logger.error("Node script returned empty output")
                raise Exception("Node script returned empty output")
            
            return json.loads(result.stdout)
        except subprocess.TimeoutExpired:
            logger.error("Node script timeout")
            raise Exception("Request timeout")
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON response: {e}")
            logger.error(f"Raw output: {result.stdout if 'result' in locals() else 'No output'}")
            raise Exception(f"Invalid JSON response from Node.js script: {e}")
        except Exception as e:
            logger.error(f"API call failed: {e}")
            raise Exception(f"API call failed: {e}")

# Initialize API
deezer_api = DeezerAPI()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/config', methods=['GET', 'POST'])
def api_config():
    if request.method == 'GET':
        return jsonify({
            'configured': config.is_configured(),
            'config': {
                'arl': config.get('arl', ''),  # Send full ARL for editing
                'arl_display': config.get('arl', '')[:10] + '...' if config.get('arl') else '',  # Display version
                'quality': config.get('quality', 3),
                'download_path': config.get('download_path'),
                'organize_by_folder': config.get('organize_by_folder', True),
                'create_playlist_folders': config.get('create_playlist_folders', False),
                'track_path_template': config.get('track_path_template', '{artist}/{album}/{track_number:02d} - {track}'),
                'album_path_template': config.get('album_path_template', '{artist}/{album}'),
                'playlist_path_template': config.get('playlist_path_template', 'Playlists/{playlist_name}'),
                'download_lyrics': config.get('download_lyrics', True)
            }
        })
    
    elif request.method == 'POST':
        data = request.get_json()
        
        # Update ARL if provided
        if 'arl' in data:
            if not data['arl'].strip():
                return jsonify({'error': 'ARL cookie is required'}), 400
            config.set('arl', data['arl'].strip())
            # Update the API object's ARL
            deezer_api.arl = data['arl'].strip()
            logger.info(f"Updated ARL cookie, length: {len(data['arl'].strip())}")
        
        # Validate path templates if provided
        template_fields = ['track_path_template', 'album_path_template', 'playlist_path_template']
        for field in template_fields:
            if field in data:
                is_valid, message = PathTemplate.validate_template(data[field])
                if not is_valid:
                    return jsonify({'error': f'Invalid {field}: {message}'}), 400
        
        # Update other settings
        for key in ['quality', 'download_path', 'organize_by_folder', 'create_playlist_folders', 'download_lyrics'] + template_fields:
            if key in data:
                config.set(key, data[key])
        
        return jsonify({'success': True})

@app.route('/api/search')
def api_search():
    # Reload config to get latest ARL
    config.config = config.load_config()
    deezer_api.arl = config.get('arl')
    
    if not config.is_configured():
        return jsonify({'error': 'Deezer not configured. Please set ARL cookie.'}), 400
    
    query = request.args.get('q', '').strip()
    search_type = request.args.get('type', 'TRACK').upper()
    limit = int(request.args.get('limit', 15))
    
    logger.info(f"Search request: query='{query}', type='{search_type}'")
    logger.info(f"Current ARL length: {len(config.get('arl', ''))}")
    logger.info(f"API object ARL length: {len(deezer_api.arl or '')}")
    
    if not query:
        return jsonify({'error': 'Search query is required'}), 400
    
    try:
        result = deezer_api.call_node_script('searchMusic', {
            'query': query,
            'types': [search_type],
            'limit': limit
        })
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/download/track/<track_id>')
def api_download_track(track_id):
    if not config.is_configured():
        return jsonify({'error': 'Deezer not configured. Please set ARL cookie.'}), 400
    
    # Initialize progress tracking
    download_id = f"track_{track_id}_{int(time.time())}"
    download_progress[download_id] = {
        'status': 'starting',
        'progress': 0,
        'message': 'Starting download...'
    }
    
    def download_track_background():
        try:
            download_progress[download_id]['status'] = 'fetching_info'
            download_progress[download_id]['message'] = 'Fetching track information...'
            
            # Get track info
            track_info = deezer_api.call_node_script('getTrackInfo', {'track_id': track_id})
            
            download_progress[download_id]['status'] = 'downloading'
            download_progress[download_id]['message'] = f'Downloading {track_info.get("SNG_TITLE", "Unknown")}'
            download_progress[download_id]['progress'] = 25
            
            # Prepare metadata for path template
            metadata = {
                'artist': track_info.get('ART_NAME', 'Unknown Artist'),
                'album': track_info.get('ALB_TITLE', 'Unknown Album'),
                'track': track_info.get('SNG_TITLE', 'Unknown Track'),
                'track_number': int(track_info.get('TRACK_NUMBER', 1)),  # Ensure integer
                'year': track_info.get('PHYSICAL_RELEASE_DATE', 'Unknown Year')[:4] if track_info.get('PHYSICAL_RELEASE_DATE') else 'Unknown Year'
            }
            
            # Generate download path using template
            track_template = config.get('track_path_template', '{artist}/{album}/{track_number:02d} - {track}')
            relative_path = PathTemplate.substitute_template(track_template, metadata)
            download_path = Path(config.get('download_path')) / relative_path
            
            # Ensure parent directory exists
            download_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Download track
            result = deezer_api.call_node_script('downloadTrack', {
                'track_id': track_id,
                'quality': config.get('quality', 3),
                'download_path': str(download_path.parent),
                'organize_by_folder': False,  # We handle organization ourselves
                'filename': download_path.name,
                'download_lyrics': config.get('download_lyrics', True)
            })
            
            download_progress[download_id]['status'] = 'completed'
            download_progress[download_id]['progress'] = 100
            download_progress[download_id]['message'] = f'Downloaded: {result.get("filename", "Unknown")}'
            download_progress[download_id]['result'] = result
            
        except Exception as e:
            download_progress[download_id]['status'] = 'error'
            download_progress[download_id]['message'] = f'Error: {str(e)}'
    
    # Start download in background
    thread = threading.Thread(target=download_track_background)
    thread.daemon = True
    thread.start()
    
    return jsonify({'download_id': download_id})

@app.route('/api/download/status/<download_id>')
def api_download_status(download_id):
    if download_id in download_progress:
        return jsonify(download_progress[download_id])
    else:
        return jsonify({'error': 'Download not found'}), 404

@app.route('/api/track/<track_id>')
def api_track_info(track_id):
    if not config.is_configured():
        return jsonify({'error': 'Deezer not configured. Please set ARL cookie.'}), 400
    
    try:
        result = deezer_api.call_node_script('getTrackInfo', {'track_id': track_id})
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/album/<album_id>')
def api_album_info(album_id):
    if not config.is_configured():
        return jsonify({'error': 'Deezer not configured. Please set ARL cookie.'}), 400
    
    try:
        album_info = deezer_api.call_node_script('getAlbumInfo', {'album_id': album_id})
        album_tracks = deezer_api.call_node_script('getAlbumTracks', {'album_id': album_id})
        
        return jsonify({
            'info': album_info,
            'tracks': album_tracks
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/artist/<artist_id>')
def api_artist_info(artist_id):
    if not config.is_configured():
        return jsonify({'error': 'Deezer not configured. Please set ARL cookie.'}), 400
    
    try:
        artist_info = deezer_api.call_node_script('getArtistInfo', {'artist_id': artist_id})
        discography = deezer_api.call_node_script('getDiscography', {'artist_id': artist_id})
        
        return jsonify({
            'info': artist_info,
            'discography': discography
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/album/<album_id>')
def album_detail(album_id):
    if not config.is_configured():
        return jsonify({'error': 'Deezer not configured. Please set ARL cookie.'}), 400
    
    try:
        album_info = deezer_api.call_node_script('getAlbumInfo', {'album_id': album_id})
        album_tracks = deezer_api.call_node_script('getAlbumTracks', {'album_id': album_id})
        
        return render_template('album_detail.html', album=album_info, tracks=album_tracks)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/artist/<artist_id>/albums-count')
def api_artist_albums_count(artist_id):
    if not config.is_configured():
        return jsonify({'error': 'Deezer not configured. Please set ARL cookie.'}), 400
    
    try:
        discography = deezer_api.call_node_script('getDiscography', {'artist_id': artist_id})
        
        # Initialize album type counters
        album_counts = {
            'album': 0,      # Studio albums (TYPE '1')
            'ep': 0,         # EPs (TYPE '3')
            'single': 0,      # Singles (TYPE '0')
            'live': 0,        # Live albums
            'compilation': 0, # Compilations
            'karaoke': 0,     # Karaoke albums
            'total': 0
        }
        
        # Count albums by this artist only and categorize them
        if discography and discography.get('data'):
            for album in discography['data']:
                if album.get('ART_ID') == artist_id:
                    album_counts['total'] += 1
                    
                    # Categorize by TYPE field
                    if album.get('TYPE') == '0':
                        album_counts['single'] += 1
                    elif album.get('TYPE') == '3':
                        album_counts['ep'] += 1
                    elif album.get('TYPE') == '1':
                        # Check SUBTYPES for TYPE '1' albums
                        if album.get('SUBTYPES'):
                            subtypes = album['SUBTYPES']
                            if subtypes.get('isLive'):
                                album_counts['live'] += 1
                            elif subtypes.get('isCompilation'):
                                album_counts['compilation'] += 1
                            elif subtypes.get('isKaraoke'):
                                album_counts['karaoke'] += 1
                            else:
                                album_counts['album'] += 1
                        else:
                            album_counts['album'] += 1
        
        return jsonify(album_counts)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/album/<album_id>/details')
def api_album_details(album_id):
    if not config.is_configured():
        return jsonify({'error': 'Deezer not configured. Please set ARL cookie.'}), 400
    
    try:
        album_info = deezer_api.call_node_script('getAlbumInfo', {'album_id': album_id})
        return jsonify(album_info)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/artist/<artist_id>')
def artist_detail(artist_id):
    if not config.is_configured():
        return jsonify({'error': 'Deezer not configured. Please set ARL cookie.'}), 400
    
    try:
        artist_info = deezer_api.call_node_script('getArtistInfo', {'artist_id': artist_id})
        discography = deezer_api.call_node_script('getDiscography', {'artist_id': artist_id})
        
        # Filter albums to only include those by the main artist (for fast loading)
        filtered_albums = []
        if discography and discography.get('data'):
            filtered_albums = [album for album in discography['data'] if album.get('ART_ID') == artist_id]
        
        return render_template('artist_detail.html', artist=artist_info, discography={'data': filtered_albums})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/download/album/<album_id>')
def api_download_album(album_id):
    if not config.is_configured():
        return jsonify({'error': 'Deezer not configured. Please set ARL cookie.'}), 400
    
    download_id = f"album_{album_id}_{int(time.time())}"
    download_progress[download_id] = {
        'status': 'starting',
        'progress': 0,
        'message': 'Starting album download...'
    }
    
    def download_album_background():
        try:
            download_progress[download_id]['status'] = 'fetching_info'
            download_progress[download_id]['message'] = 'Fetching album information...'
            
            album_info = deezer_api.call_node_script('getAlbumInfo', {'album_id': album_id})
            album_tracks_response = deezer_api.call_node_script('getAlbumTracks', {'album_id': album_id})
            
            # Extract tracks from response (could be list or dict with 'items' key)
            if isinstance(album_tracks_response, dict):
                album_tracks = album_tracks_response.get('items', []) or album_tracks_response.get('data', [])
            elif isinstance(album_tracks_response, list):
                album_tracks = album_tracks_response
            else:
                album_tracks = []
            
            print(f"Extracted {len(album_tracks)} tracks from album")
            if album_tracks:
                print(f"First track: {album_tracks[0]}")
            
            # Prepare album metadata for path template
            album_metadata = {
                'artist': album_info.get('ART_NAME', 'Unknown Artist'),
                'album': album_info.get('ALB_TITLE', 'Unknown Album'),
                'year': album_info.get('PHYSICAL_RELEASE_DATE', 'Unknown Year')[:4] if album_info.get('PHYSICAL_RELEASE_DATE') else 'Unknown Year'
            }
            
            # Generate album base path using template
            album_template = config.get('album_path_template', '{artist}/{album}')
            album_base_path = Path(config.get('download_path')) / PathTemplate.substitute_template(album_template, album_metadata)
            
            # Ensure album directory exists
            album_base_path.mkdir(parents=True, exist_ok=True)
            
            total_tracks = len(album_tracks)
            download_progress[download_id]['total_tracks'] = total_tracks
            
            for i, track in enumerate(album_tracks):
                download_progress[download_id]['current_track'] = i + 1
                
                # Handle both dictionary and string formats
                if isinstance(track, dict):
                    track_title = track.get('SNG_TITLE', 'Unknown')
                    track_id = track.get('SNG_ID')
                    track_number = track.get('TRACK_NUMBER', i + 1)
                elif isinstance(track, str):
                    track_title = track
                    track_id = track
                    track_number = i + 1
                else:
                    track_title = str(track)
                    track_id = str(track)
                    track_number = i + 1
                
                print(f"Processing track {i+1}: ID={track_id}, Title={track_title}")
                
                download_progress[download_id]['message'] = f'Downloading track {i + 1} of {total_tracks}: {track_title}'
                download_progress[download_id]['progress'] = (i / total_tracks) * 100
                
                try:
                    # Get detailed track info for accurate metadata
                    track_info = deezer_api.call_node_script('getTrackInfo', {'track_id': track_id})
                    
                    # Prepare track metadata for path template
                    track_metadata = {
                        'artist': track_info.get('ART_NAME', album_metadata['artist']),
                        'album': track_info.get('ALB_TITLE', album_metadata['album']),
                        'track': track_info.get('SNG_TITLE', track_title),
                        'track_number': int(track_info.get('TRACK_NUMBER', track_number)),  # Ensure integer
                        'year': track_info.get('PHYSICAL_RELEASE_DATE', album_metadata['year'])[:4] if track_info.get('PHYSICAL_RELEASE_DATE') else album_metadata['year']
                    }
                    
                    # Generate track path using template (for individual file naming)
                    track_template = config.get('track_path_template', '{artist}/{album}/{track_number:02d} - {track}')
                    relative_track_path = PathTemplate.substitute_template(track_template, track_metadata)
                    track_filename = Path(relative_track_path).name  # Just the filename, since we're in album folder
                    
                    result = deezer_api.call_node_script('downloadTrack', {
                        'track_id': track_id,
                        'quality': config.get('quality', 3),
                        'download_path': str(album_base_path),
                        'organize_by_folder': False,  # We handle organization ourselves
                        'filename': track_filename,
                        'download_lyrics': config.get('download_lyrics', True)
                    })
                except Exception as track_error:
                    print(f'Failed to download track {track_title}: {track_error}')
                    continue
            
            download_progress[download_id]['status'] = 'completed'
            download_progress[download_id]['progress'] = 100
            download_progress[download_id]['message'] = f'Downloaded album: {album_info.get("ALB_TITLE", "Unknown")}'
            
        except Exception as e:
            download_progress[download_id]['status'] = 'error'
            download_progress[download_id]['message'] = f'Error: {str(e)}'
    
    thread = threading.Thread(target=download_album_background)
    thread.daemon = True
    thread.start()
    
    return jsonify({'download_id': download_id})

@app.route('/api/download/artist/<artist_id>')
def api_download_artist_discography(artist_id):
    if not config.is_configured():
        return jsonify({'error': 'Deezer not configured. Please set ARL cookie.'}), 400
    
    download_id = f"artist_{artist_id}_{int(time.time())}"
    download_progress[download_id] = {
        'status': 'starting',
        'progress': 0,
        'message': 'Starting discography download...'
    }
    
    def download_discography_background():
        try:
            download_progress[download_id]['status'] = 'fetching_info'
            download_progress[download_id]['message'] = 'Fetching artist discography...'
            
            # Get artist info and discography
            artist_info = deezer_api.call_node_script('getArtistInfo', {'artist_id': artist_id})
            discography_response = deezer_api.call_node_script('getDiscography', {'artist_id': artist_id})
            
            # Extract albums from response
            if isinstance(discography_response, dict):
                albums = discography_response.get('data', [])
            elif isinstance(discography_response, list):
                albums = discography_response
            else:
                albums = []
            
            # Filter albums to only include those by the main artist
            albums = [album for album in albums if album.get('ART_ID') == artist_id]
            
            if not albums:
                download_progress[download_id]['status'] = 'error'
                download_progress[download_id]['message'] = 'No albums found for this artist'
                return
            
            # Sort albums by release date (newest first)
            albums.sort(key=lambda x: x.get('DIGITAL_RELEASE_DATE', x.get('PHYSICAL_RELEASE_DATE', '1970-01-01')), reverse=True)
            
            total_albums = len(albums)
            download_progress[download_id]['total_albums'] = total_albums
            download_progress[download_id]['current_album'] = 0
            
            # Prepare artist metadata for path template
            artist_metadata = {
                'artist': artist_info.get('ART_NAME', 'Unknown Artist')
            }
            
            for i, album in enumerate(albums):
                download_progress[download_id]['current_album'] = i + 1
                album_title = album.get('ALB_TITLE', 'Unknown Album')
                album_id = album.get('ALB_ID')
                
                download_progress[download_id]['message'] = f'Downloading album {i + 1} of {total_albums}: {album_title}'
                download_progress[download_id]['progress'] = (i / total_albums) * 100
                
                try:
                    # Get album info and tracks
                    album_info = deezer_api.call_node_script('getAlbumInfo', {'album_id': album_id})
                    album_tracks_response = deezer_api.call_node_script('getAlbumTracks', {'album_id': album_id})
                    
                    # Extract tracks
                    if isinstance(album_tracks_response, dict):
                        album_tracks = album_tracks_response.get('items', []) or album_tracks_response.get('data', [])
                    elif isinstance(album_tracks_response, list):
                        album_tracks = album_tracks_response
                    else:
                        album_tracks = []
                    
                    # Prepare album metadata for path template
                    album_metadata = {
                        'artist': album_info.get('ART_NAME', artist_metadata['artist']),
                        'album': album_info.get('ALB_TITLE', album_title),
                        'year': album_info.get('PHYSICAL_RELEASE_DATE', 'Unknown Year')[:4] if album_info.get('PHYSICAL_RELEASE_DATE') else 'Unknown Year'
                    }
                    
                    # Generate album base path using template
                    album_template = config.get('album_path_template', '{artist}/{album}')
                    album_base_path = Path(config.get('download_path')) / PathTemplate.substitute_template(album_template, album_metadata)
                    
                    # Ensure album directory exists
                    album_base_path.mkdir(parents=True, exist_ok=True)
                    
                    # Download all tracks in the album
                    for j, track in enumerate(album_tracks):
                        # Handle both dictionary and string formats
                        if isinstance(track, dict):
                            track_title = track.get('SNG_TITLE', 'Unknown')
                            track_id = track.get('SNG_ID')
                            track_number = track.get('TRACK_NUMBER', j + 1)
                        elif isinstance(track, str):
                            track_title = track
                            track_id = track
                            track_number = j + 1
                        else:
                            track_title = str(track)
                            track_id = str(track)
                            track_number = j + 1
                        
                        try:
                            # Get detailed track info for accurate metadata
                            track_info = deezer_api.call_node_script('getTrackInfo', {'track_id': track_id})
                            
                            # Prepare track metadata for path template
                            track_metadata = {
                                'artist': track_info.get('ART_NAME', album_metadata['artist']),
                                'album': track_info.get('ALB_TITLE', album_metadata['album']),
                                'track': track_info.get('SNG_TITLE', track_title),
                                'track_number': int(track_info.get('TRACK_NUMBER', track_number)),
                                'year': track_info.get('PHYSICAL_RELEASE_DATE', album_metadata['year'])[:4] if track_info.get('PHYSICAL_RELEASE_DATE') else album_metadata['year']
                            }
                            
                            # Generate track path using template
                            track_template = config.get('track_path_template', '{artist}/{album}/{track_number:02d} - {track}')
                            relative_track_path = PathTemplate.substitute_template(track_template, track_metadata)
                            track_filename = Path(relative_track_path).name
                            
                            # Download track
                            result = deezer_api.call_node_script('downloadTrack', {
                                'track_id': track_id,
                                'quality': config.get('quality', 3),
                                'download_path': str(album_base_path),
                                'organize_by_folder': False,
                                'filename': track_filename,
                                'download_lyrics': config.get('download_lyrics', True)
                            })
                            
                        except Exception as track_error:
                            print(f'Failed to download track {track_title}: {track_error}')
                            continue
                    
                except Exception as album_error:
                    print(f'Failed to download album {album_title}: {album_error}')
                    continue
            
            download_progress[download_id]['status'] = 'completed'
            download_progress[download_id]['progress'] = 100
            download_progress[download_id]['message'] = f'Downloaded discography: {artist_info.get("ART_NAME", "Unknown")}'
            
        except Exception as e:
            download_progress[download_id]['status'] = 'error'
            download_progress[download_id]['message'] = f'Error: {str(e)}'
    
    thread = threading.Thread(target=download_discography_background)
    thread.daemon = True
    thread.start()
    
    return jsonify({'download_id': download_id})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
