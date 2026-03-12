from flask import Flask, render_template, request, jsonify, send_file
from flask_cors import CORS
import subprocess
import json
import os
import sys
from pathlib import Path
import threading
import time
import logging
from config import Config

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Initialize configuration
config = Config()

# Ensure downloads directory exists
Path(config.get('download_path')).mkdir(parents=True, exist_ok=True)

# Global variable to track download progress
download_progress = {}

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
                'create_playlist_folders': config.get('create_playlist_folders', False)
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
        
        # Update other settings
        for key in ['quality', 'download_path', 'organize_by_folder', 'create_playlist_folders']:
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
            
            # Download track
            result = deezer_api.call_node_script('downloadTrack', {
                'track_id': track_id,
                'quality': config.get('quality', 3),
                'download_path': config.get('download_path'),
                'organize_by_folder': config.get('organize_by_folder', True)
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
            
            total_tracks = len(album_tracks)
            download_progress[download_id]['total_tracks'] = total_tracks
            
            for i, track in enumerate(album_tracks):
                download_progress[download_id]['current_track'] = i + 1
                
                # Handle both dictionary and string formats
                if isinstance(track, dict):
                    track_title = track.get('SNG_TITLE', 'Unknown')
                    track_id = track.get('SNG_ID')
                elif isinstance(track, str):
                    track_title = track
                    track_id = track
                else:
                    track_title = str(track)
                    track_id = str(track)
                
                print(f"Processing track {i+1}: ID={track_id}, Title={track_title}")
                
                download_progress[download_id]['message'] = f'Downloading track {i + 1} of {total_tracks}: {track_title}'
                download_progress[download_id]['progress'] = (i / total_tracks) * 100
                
                try:
                    result = deezer_api.call_node_script('downloadTrack', {
                        'track_id': track_id,
                        'quality': config.get('quality', 3),
                        'download_path': config.get('download_path'),
                        'organize_by_folder': config.get('organize_by_folder', True)
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

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
