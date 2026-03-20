/**
 * Frontend Application Controller
 * Handles configuration, search, and download functionality
 */

class DeezerDownloader {
    constructor() {
        this.config = {};
        this.activeDownloads = {};
        this.init();
    }

    /**
     * Initialize the application
     */
    init() {
        try {
            this.loadConfig();
            this.setupEventListeners();
            this.setupKeywordButtons();
        } catch (error) {
            this.handleError('Failed to initialize application', error);
        }
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Config form
        const configForm = document.getElementById('config-form');
        if (configForm) {
            configForm.addEventListener('submit', (e) => this.saveConfig(e));
        }

        // Search form
        const searchForm = document.getElementById('search-form');
        if (searchForm) {
            searchForm.addEventListener('submit', (e) => this.performSearch(e));
        }

        // Button events
        const toggleArl = document.getElementById('toggle-arl');
        if (toggleArl) {
            toggleArl.addEventListener('click', () => this.toggleArlVisibility());
        }

        const clearArl = document.getElementById('clear-arl');
        if (clearArl) {
            clearArl.addEventListener('click', () => this.clearArl());
        }

        const cancelConfig = document.getElementById('cancel-config');
        if (cancelConfig) {
            cancelConfig.addEventListener('click', () => this.cancelConfig());
        }

        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => this.showConfigSection());
        }
    }

    /**
     * Setup keyword button functionality
     */
    setupKeywordButtons() {
        const keywordButtons = document.querySelectorAll('.keyword-btn');
        keywordButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const keyword = e.target.dataset.keyword;
                const target = e.target.dataset.target;
                this.insertKeyword(target, keyword);
            });
        });
    }

    /**
     * Load configuration from server
     */
    async loadConfig() {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            this.config = data.config;

            if (data.configured) {
                this.showSearchSection();
            } else {
                this.showConfigSection();
            }
        } catch (error) {
            this.handleError('Failed to load configuration', error);
        }
    }

    /**
     * Save configuration to server
     */
    async saveConfig(e) {
        e.preventDefault();
        
        try {
            const formData = new FormData(e.target);
            const configData = {
                arl: formData.get('arl'),
                quality: parseInt(formData.get('quality')),
                track_path_template: formData.get('track_path_template'),
                album_path_template: formData.get('album_path_template'),
                playlist_path_template: formData.get('playlist_path_template'),
                organize_by_folder: formData.get('organize_by_folder') === 'on',
                download_lyrics: formData.get('download_lyrics') === 'on'
            };

            const response = await fetch('/api/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(configData)
            });

            if (response.ok) {
                this.hideError();
                await this.loadConfig();
            } else {
                const error = await response.json();
                this.showError(error.error || 'Failed to save configuration');
            }
        } catch (error) {
            this.handleError('Failed to save configuration', error);
        }
    }

    /**
     * Perform search
     */
    async performSearch(e) {
        e.preventDefault();

        const query = document.getElementById('search-query').value.trim();
        const type = document.getElementById('search-type').value;

        if (!query) {
            this.showError('Please enter a search query');
            return;
        }

        this.showLoading(true);
        this.hideError();

        try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&type=${type}`);
            
            if (response.ok) {
                const data = await response.json();
                this.displaySearchResults(data, type);
            } else {
                const error = await response.json();
                this.showError(error.error || 'Search failed');
            }
        } catch (error) {
            this.handleError('Search failed', error);
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * Display search results
     */
    displaySearchResults(results, type) {
        const container = document.getElementById('search-results');
        container.innerHTML = '';

        let data = [];
        if (results[type] && results[type].data) {
            data = results[type].data;
        }

        if (!data || data.length === 0) {
            container.innerHTML = '<p class="no-results">No results found.</p>';
            return;
        }

        const resultsList = document.createElement('div');
        resultsList.className = 'results-list';

        data.forEach(item => {
            const resultItem = this.createResultItem(item, type);
            resultsList.appendChild(resultItem);
        });

        container.appendChild(resultsList);
    }

    /**
     * Create search result item
     */
    createResultItem(item, type) {
        const div = document.createElement('div');
        div.className = 'result-card';

        let content = '';
        let downloadButton = '';

        const coverUrl = this.getDeezerCoverUrl(item.ALB_PICTURE, 250);
        const coverHtml = coverUrl ?
            `<img src="${coverUrl}" alt="Album Cover" class="result-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
         <div class="result-cover-placeholder" style="display: none;">${this.createPlaceholderIcon('album')}</div>` :
            `<div class="result-cover-placeholder">${this.createPlaceholderIcon('album')}</div>`;

        switch (type) {
            case 'TRACK':
                content = this.createTrackCard(item, coverHtml);
                downloadButton = `<button class="download-btn" onclick="app.downloadTrack('${item.SNG_ID}', '${this.escapeHtml(item.SNG_TITLE)}')">Download</button>`;
                break;
            case 'ALBUM':
                content = this.createAlbumCard(item, coverHtml);
                downloadButton = '';
                break;
            case 'ARTIST':
                content = this.createArtistCard(item);
                // Load album count for artist
                this.loadArtistAlbumCount(item.ART_ID);
                downloadButton = '';
                break;
            case 'PLAYLIST':
                content = this.createPlaylistCard(item, coverHtml);
                downloadButton = `<button class="download-btn" onclick="app.downloadPlaylist('${item.PLAYLIST_ID}', '${this.escapeHtml(item.TITLE)}')">Download Playlist</button>`;
                break;
        }

        div.innerHTML = `
            <div class="card-content">
                ${content}
            </div>
            <div class="card-actions">
                ${downloadButton}
            </div>
        `;
        return div;
    }

    /**
     * Create track card HTML
     */
    createTrackCard(item, coverHtml) {
        return `
        <div class="track-card">
            <div class="track-cover">
                ${coverHtml}
            </div>
            <div class="track-details">
                <h3 class="track-title">${this.escapeHtml(item.SNG_TITLE)}</h3>
                <div class="track-meta">
                    <a href="/artist/${item.ART_ID}" class="track-artist-link">${this.escapeHtml(item.ART_NAME)}</a>
                    <a href="/album/${item.ALB_ID}" class="track-album-link">${this.escapeHtml(item.ALB_TITLE)}</a>
                </div>
                <div class="track-stats">
                    <span class="track-duration">${this.formatTrackDuration(item.DURATION)}</span>
                    <span class="track-number">Track ${item.TRACK_NUMBER || 'N/A'}</span>
                </div>
            </div>
        </div>
    `;
    }

    /**
     * Create album card HTML
     */
    createAlbumCard(item, coverHtml) {
        return `
        <a href="/album/${item.ALB_ID}" class="album-card-link">
            <div class="album-card">
                <div class="album-cover">
                    ${coverHtml}
                </div>
                <div class="album-details">
                    <h3 class="album-title">${this.escapeHtml(item.ALB_TITLE)}</h3>
                    <div class="album-meta">
                        <span class="album-artist">${this.escapeHtml(item.ART_NAME)}</span>
                        <span class="album-year">${item.PHYSICAL_RELEASE_DATE ? item.PHYSICAL_RELEASE_DATE.substring(0, 4) : 'Unknown'}</span>
                    </div>
                    <div class="album-stats">
                        <span class="album-tracks">${item.NUMBER_TRACK || 0} tracks</span>
                        <span class="album-type">${this.getAlbumType(item)}</span>
                    </div>
                </div>
            </div>
        </a>
    `;
    }

    /**
     * Create artist card HTML
     */
    createArtistCard(item) {
        const artistCoverUrl = item.ART_PICTURE ? this.getDeezerCoverUrl(item.ART_PICTURE, 250, 'artist') : null;
        const artistCoverHtml = artistCoverUrl ?
            `<img src="${artistCoverUrl}" alt="Artist Image" class="result-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
         <div class="result-cover-placeholder artist-placeholder" style="display: none;">${this.createPlaceholderIcon('artist')}</div>` :
            `<div class="result-cover-placeholder artist-placeholder">${this.createPlaceholderIcon('artist')}</div>`;

        return `
        <a href="/artist/${item.ART_ID}" class="artist-card-link">
            <div class="artist-card">
                <div class="artist-cover">
                    ${artistCoverHtml}
                </div>
                <div class="artist-details">
                    <h3 class="artist-name">${this.escapeHtml(item.ART_NAME)}</h3>
                    <div class="artist-stats">
                        <span class="artist-fans">${this.formatNumber(item.NB_FAN)} fans</span>
                        <span class="artist-albums" id="artist-albums-${item.ART_ID}">Loading albums...</span>
                    </div>
                    <div class="artist-genre">
                        <span class="genre-tag">${item.ROLE || 'Artist'}</span>
                    </div>
                </div>
            </div>
        </a>
    `;
    }

    /**
     * Create playlist card HTML
     */
    createPlaylistCard(item, coverHtml) {
        return `
        <div class="playlist-card">
            <div class="playlist-cover">
                ${coverHtml}
            </div>
            <div class="playlist-details">
                <h3 class="playlist-title">${this.escapeHtml(item.TITLE)}</h3>
                <div class="playlist-stats">
                    <span class="playlist-songs">${item.NB_SONG} songs</span>
                    <span class="playlist-duration">${this.formatNumber(item.NB_FAN || 0)} followers</span>
                </div>
                <div class="playlist-user">
                    <span class="user-name">${this.escapeHtml(item.USER || 'Various Artists')}</span>
                </div>
            </div>
        </div>
    `;
    }

    /**
     * Download track
     */
    async downloadTrack(trackId, trackTitle) {
        try {
            const response = await fetch(`/api/download/track/${trackId}`);
            const data = await response.json();

            if (response.ok) {
                // Use global download manager if available
                if (window.downloadManager) {
                    window.downloadManager.addDownload(data.download_id, {
                        type: 'track',
                        title: trackTitle,
                        trackId: trackId
                    });
                } else {
                    // Fallback to local tracking
                    this.activeDownloads[data.download_id] = {
                        type: 'track',
                        title: trackTitle,
                        status: 'starting'
                    };
                    this.updateDownloadsList();
                    this.pollDownloadStatus(data.download_id);
                }
            } else {
                this.showError(data.error || 'Download failed');
            }
        } catch (error) {
            this.handleError('Download failed', error);
        }
    }

    /**
     * Download playlist
     */
    async downloadPlaylist(playlistId, playlistTitle) {
        try {
            const response = await fetch(`/api/download/playlist/${playlistId}`);
            const data = await response.json();

            if (response.ok) {
                // Use global download manager if available
                if (window.downloadManager) {
                    window.downloadManager.addDownload(data.download_id, {
                        type: 'playlist',
                        title: playlistTitle,
                        playlistId: playlistId
                    });
                } else {
                    // Fallback to local tracking
                    this.activeDownloads[data.download_id] = {
                        type: 'playlist',
                        title: playlistTitle,
                        status: 'starting'
                    };
                    this.updateDownloadsList();
                    this.pollDownloadStatus(data.download_id);
                }
            } else {
                this.showError(data.error || 'Download failed');
            }
        } catch (error) {
            this.handleError('Download failed', error);
        }
    }

    /**
     * Poll download status
     */
    pollDownloadStatus(downloadId) {
        const maxAttempts = 60;
        let attempts = 0;

        const poll = async () => {
            if (attempts >= maxAttempts) {
                delete this.activeDownloads[downloadId];
                this.updateDownloadsList();
                return;
            }

            attempts++;

            try {
                const response = await fetch(`/api/download/status/${downloadId}`);
                const status = await response.json();

                if (response.ok) {
                    this.activeDownloads[downloadId] = {
                        ...this.activeDownloads[downloadId],
                        ...status
                    };
                    this.updateDownloadsList();

                    if (status.status === 'completed' || status.status === 'error') {
                        setTimeout(() => {
                            delete this.activeDownloads[downloadId];
                            this.updateDownloadsList();
                        }, 5000);
                        return;
                    }
                }
            } catch (error) {
                // Silently handle polling errors
            }

            setTimeout(poll, 2000);
        };

        poll();
    }

    /**
     * Update downloads list
     */
    updateDownloadsList() {
        const container = document.getElementById('download-list');
        container.innerHTML = '';

        if (Object.keys(this.activeDownloads).length === 0) {
            container.innerHTML = '<p class="no-downloads">No active downloads.</p>';
            return;
        }

        Object.entries(this.activeDownloads).forEach(([id, download]) => {
            const item = document.createElement('div');
            item.className = 'download-item';
            item.innerHTML = `
            <div class="download-info">
                <h4>${this.escapeHtml(download.title || 'Unknown')}</h4>
                <p>Status: ${download.status || 'starting'}</p>
                ${download.progress ? `<p>Progress: ${download.progress}%</p>` : ''}
                ${download.current_track && download.total_tracks ? `<p>Track ${download.current_track} of ${download.total_tracks}</p>` : ''}
                ${download.message ? `<p>${this.escapeHtml(download.message)}</p>` : ''}
                ${download.result && download.result.lyrics_file ? `<p>Lyrics: ${this.escapeHtml(download.result.lyrics_file)} (${download.result.lyrics_format.toUpperCase()})</p>` : ''}
            </div>
        `;
            container.appendChild(item);
        });
    }

    /**
     * Show/hide loading indicator
     */
    showLoading(show) {
        const loading = document.getElementById('search-loading');
        if (show) {
            loading.classList.remove('hidden');
        } else {
            loading.classList.add('hidden');
        }
    }

    /**
     * Show error message
     */
    showError(message) {
        const errorDiv = document.getElementById('error-message');
        errorDiv.textContent = message;
        errorDiv.classList.remove('hidden');
        errorDiv.focus();

        setTimeout(() => {
            this.hideError();
        }, 5000);
    }

    /**
     * Hide error message
     */
    hideError() {
        document.getElementById('error-message').classList.add('hidden');
    }

    /**
     * Handle errors consistently
     */
    handleError(message, error) {
        console.error(message, error);
        this.showError(message);
    }

    /**
     * Show configuration section
     */
    showConfigSection() {
        document.getElementById('config-section').classList.remove('hidden');
        document.getElementById('search-section').classList.add('hidden');
        document.getElementById('downloads-section').classList.add('hidden');

        if (this.config.arl && this.config.arl.length > 3) {
            document.getElementById('config-message').textContent = 'Configuration found. You can update your settings below.';
            document.getElementById('arl').value = this.config.arl;
        } else {
            document.getElementById('config-message').textContent = 'Please configure your Deezer ARL cookie to continue.';
            document.getElementById('arl').value = '';
        }

        // Update form with current config
        document.getElementById('quality').value = this.config.quality || '3';
        document.getElementById('track_path_template').value = this.config.track_path_template || '{artist}/{album}/{track_number:02d} - {track}';
        document.getElementById('album_path_template').value = this.config.album_path_template || '{artist}/{album}';
        document.getElementById('playlist_path_template').value = this.config.playlist_path_template || 'Playlists/{playlist_name}';
        document.getElementById('organize_by_folder').checked = this.config.organize_by_folder !== false;
        document.getElementById('download_lyrics').checked = this.config.download_lyrics !== false;

        document.getElementById('config-form').classList.remove('hidden');
    }

    /**
     * Show search section
     */
    showSearchSection() {
        document.getElementById('config-section').classList.add('hidden');
        document.getElementById('search-section').classList.remove('hidden');
        // Hide old downloads section since we now have sidebar
        const oldDownloadsSection = document.getElementById('downloads-section');
        if (oldDownloadsSection) {
            oldDownloadsSection.classList.add('hidden');
        }
    }

    /**
     * Toggle ARL visibility
     */
    toggleArlVisibility() {
        const arlInput = document.getElementById('arl');
        const toggleBtn = document.getElementById('toggle-arl');

        if (arlInput.type === 'password') {
            arlInput.type = 'text';
            toggleBtn.textContent = 'Hide';
        } else {
            arlInput.type = 'password';
            toggleBtn.textContent = 'Show';
        }
    }

    /**
     * Clear ARL field
     */
    clearArl() {
        if (confirm('Are you sure you want to clear the ARL cookie? You will need to re-enter it.')) {
            document.getElementById('arl').value = '';
            document.getElementById('arl').focus();
        }
    }

    /**
     * Cancel configuration
     */
    cancelConfig() {
        if (this.config.arl && this.config.arl.length > 3) {
            this.showSearchSection();
        } else {
            this.showError('Please configure your settings before continuing');
        }
    }

    /**
     * Insert keyword into template field
     */
    insertKeyword(fieldId, keyword) {
        const field = document.getElementById(fieldId);
        const start = field.selectionStart;
        const end = field.selectionEnd;
        const value = field.value;

        const newValue = value.substring(0, start) + keyword + value.substring(end);
        field.value = newValue;

        const newCursorPos = start + keyword.length;
        field.setSelectionRange(newCursorPos, newCursorPos);
        field.focus();
    }

    /**
     * Get Deezer cover URL
     */
    getDeezerCoverUrl(pictureHash, size = 250, type = 'cover') {
        if (!pictureHash) return null;

        const sizeMap = {
            56: '56x56',
            120: '120x120',
            250: '250x250',
            500: '500x500'
        };

        const sizeStr = sizeMap[size] || sizeMap[250];
        const imagePath = type === 'artist' ? 'artist' : 'cover';
        return `https://cdn-images.dzcdn.net/images/${imagePath}/${pictureHash}/${sizeStr}-000000-80-0-0.jpg`;
    }

    /**
     * Create placeholder icon
     */
    createPlaceholderIcon(type = 'album') {
        const icons = {
            album: `<svg viewBox="0 0 24 24" fill="currentColor" style="width: 24px; height: 24px;">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"/>
        </svg>`,
            artist: `<svg viewBox="0 0 24 24" fill="currentColor" style="width: 24px; height: 24px;">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
        </svg>`,
            playlist: `<svg viewBox="0 0 24 24" fill="currentColor" style="width: 24px; height: 24px;">
            <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h6v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
        </svg>`
        };

        return icons[type] || icons.album;
    }

    /**
     * Format track duration
     */
    formatTrackDuration(duration) {
        if (!duration) return 'Unknown';
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    /**
     * Format number with locale
     */
    formatNumber(num) {
        if (!num) return '0';
        return num.toLocaleString();
    }

    /**
     * Get album type
     */
    getAlbumType(album) {
        if (album.TYPE === '0') return 'Single';
        if (album.TYPE === '3') return 'EP';
        if (album.SUBTYPES) {
            if (album.SUBTYPES.isLive) return 'Live';
            if (album.SUBTYPES.isCompilation) return 'Compilation';
            if (album.SUBTYPES.isKaraoke) return 'Karaoke';
        }
        return 'Album';
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Load album count for an artist
     */
    async loadArtistAlbumCount(artistId) {
        try {
            const response = await fetch(`/api/artist/${artistId}/albums-count`);
            const data = await response.json();
            
            const albumCountElement = document.getElementById(`artist-albums-${artistId}`);
            if (albumCountElement && data.total !== undefined) {
                // Build categorized count display
                let html = `<span style="font-weight: normal;">${data.total} total</span>`;
                
                const categories = [];
                if (data.album > 0) categories.push(`${data.album} albums`);
                if (data.ep > 0) categories.push(`${data.ep} EPs`);
                if (data.single > 0) categories.push(`${data.single} singles`);
                if (data.live > 0) categories.push(`${data.live} live`);
                if (data.compilation > 0) categories.push(`${data.compilation} compilations`);
                if (data.karaoke > 0) categories.push(`${data.karaoke} karaoke`);
                
                if (categories.length > 0) {
                    html += `<br><small style="font-size: 0.8em; opacity: 0.8;">${categories.join(' • ')}</small>`;
                }
                
                albumCountElement.innerHTML = html;
            }
        } catch (error) {
            console.log(`Failed to load album count for artist ${artistId}`);
            const albumCountElement = document.getElementById(`artist-albums-${artistId}`);
            if (albumCountElement) {
                albumCountElement.textContent = 'Album count unavailable';
            }
        }
    }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    window.app = new DeezerDownloader();
});
