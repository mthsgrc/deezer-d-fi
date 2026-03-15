import os
import json
from pathlib import Path

class Config:
    def __init__(self):
        self.config_file = Path(__file__).parent / 'config.json'
        self.default_config = {
            'arl': '',
            'download_path': str(Path(__file__).parent / 'downloads'),
            'quality': 3,  # 1 = 128kbps, 3 = 320kbps, 9 = flac
            'organize_by_folder': True,
            'create_playlist_folders': False,
            'track_path_template': '{artist}/{album}/{track_number:02d} - {track}',
            'album_path_template': '{artist}/{album}',
            'playlist_path_template': 'Playlists/{playlist_name}'
        }
        self.config = self.load_config()
    
    def load_config(self):
        try:
            if self.config_file.exists():
                with open(self.config_file, 'r') as f:
                    config = json.load(f)
                # Merge with defaults
                return {**self.default_config, **config}
            else:
                self.save_config(self.default_config)
                return self.default_config.copy()
        except Exception as e:
            print(f"Error loading config: {e}")
            return self.default_config.copy()
    
    def save_config(self, config=None):
        try:
            config_to_save = config or self.config
            with open(self.config_file, 'w') as f:
                json.dump(config_to_save, f, indent=2)
            return True
        except Exception as e:
            print(f"Error saving config: {e}")
            return False
    
    def get(self, key, default=None):
        return self.config.get(key, default)
    
    def set(self, key, value):
        self.config[key] = value
        return self.save_config()
    
    def is_configured(self):
        return bool(self.config.get('arl'))
