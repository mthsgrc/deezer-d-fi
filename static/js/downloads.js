/**
 * Global Download Manager
 * Provides persistent download tracking across pages while maintaining backend authority
 */

class DownloadManager {
    constructor() {
        this.activeDownloads = {};
        this.storageKey = 'activeDownloadIds';
        this.init();
    }

    /**
     * Initialize download manager
     */
    init() {
        // Setup sidebar first
        this.setupSidebar();
        
        // Then load stored downloads after a short delay to ensure sidebar is ready
        setTimeout(() => {
            this.loadStoredDownloads();
        }, 50);
    }

    /**
     * Load stored download IDs from localStorage and fetch current status
     */
    async loadStoredDownloads() {
        try {
            const storedIds = localStorage.getItem(this.storageKey);
            if (storedIds) {
                const downloadIds = JSON.parse(storedIds);
                console.log('Loading stored download IDs:', downloadIds);
                
                // Fetch status for each stored download ID
                for (const downloadId of downloadIds) {
                    await this.fetchDownloadStatus(downloadId);
                }
                
                // Start polling for all loaded downloads
                console.log('Starting polling for loaded downloads');
                this.startPolling();
            }
        } catch (error) {
            console.error('Failed to load stored downloads:', error);
        }
    }

    /**
     * Save download IDs to localStorage
     */
    saveDownloadIds() {
        try {
            const downloadIds = Object.keys(this.activeDownloads);
            localStorage.setItem(this.storageKey, JSON.stringify(downloadIds));
            console.log('Saved download IDs to localStorage:', downloadIds);
        } catch (error) {
            console.error('Failed to save download IDs:', error);
        }
    }

    /**
     * Add a new download to tracking
     */
    addDownload(downloadId, downloadData) {
        this.activeDownloads[downloadId] = {
            ...downloadData,
            status: 'starting',
            progress: 0,
            addedTime: Date.now()
        };
        
        this.saveDownloadIds();
        this.updateSidebar();
        this.startPolling(downloadId);
    }

    /**
     * Fetch download status from backend
     */
    async fetchDownloadStatus(downloadId) {
        try {
            const response = await fetch(`/api/download/status/${downloadId}`);
            if (response.ok) {
                const status = await response.json();
                console.log(`Fetched status for ${downloadId}:`, status);
                
                this.activeDownloads[downloadId] = {
                    ...this.activeDownloads[downloadId],
                    ...status
                };
                
                // Save to localStorage and update sidebar
                this.saveDownloadIds();
                this.updateSidebar();
                
                // Remove completed/error downloads after 5 seconds
                if (status.status === 'completed' || status.status === 'error') {
                    setTimeout(() => {
                        this.removeDownload(downloadId);
                    }, 5000);
                }
            } else {
                // Download not found on backend, remove from tracking
                console.log(`Download ${downloadId} not found on backend, removing from tracking`);
                this.removeDownload(downloadId);
            }
        } catch (error) {
            console.error(`Failed to fetch status for ${downloadId}:`, error);
        }
    }

    /**
     * Start polling for a specific download
     */
    startPolling(downloadId = null) {
        const poll = async (id) => {
            let attempts = 0;
            const maxAttempts = id && this.activeDownloads[id]?.type === 'discography' ? 120 : 60;
            
            const pollInterval = setInterval(async () => {
                // Check if download still exists in our tracking
                if (!this.activeDownloads[id]) {
                    clearInterval(pollInterval);
                    return;
                }
                
                if (attempts >= maxAttempts) {
                    clearInterval(pollInterval);
                    this.removeDownload(id);
                    return;
                }
                
                attempts++;
                console.log(`Polling download ${id}, attempt ${attempts}`);
                await this.fetchDownloadStatus(id);
                
                // Stop polling if download is completed or errored
                if (this.activeDownloads[id]?.status === 'completed' || 
                    this.activeDownloads[id]?.status === 'error') {
                    clearInterval(pollInterval);
                    return;
                }
            }, 2000);
        };

        if (downloadId) {
            console.log('Starting polling for download:', downloadId);
            poll(downloadId);
        } else {
            // Poll all active downloads
            console.log('Starting polling for all active downloads');
            Object.keys(this.activeDownloads).forEach(id => {
                if (this.activeDownloads[id].status !== 'completed' && 
                    this.activeDownloads[id].status !== 'error') {
                    poll(id);
                }
            });
        }
    }

    /**
     * Cancel a download
     */
    async cancelDownload(downloadId) {
        try {
            const response = await fetch(`/api/download/cancel/${downloadId}`, {
                method: 'POST'
            });
            
            if (response.ok) {
                this.removeDownload(downloadId);
                this.showNotification('Download cancelled', 'info');
            } else {
                this.showNotification('Failed to cancel download', 'error');
            }
        } catch (error) {
            console.error('Failed to cancel download:', error);
            this.showNotification('Failed to cancel download', 'error');
        }
    }

    /**
     * Retry a failed download
     */
    async retryDownload(downloadId) {
        const download = this.activeDownloads[downloadId];
        if (!download) return;

        try {
            // Remove the failed download
            this.removeDownload(downloadId);
            
            // Restart download based on type
            if (download.type === 'track') {
                await this.downloadTrack(download.trackId, download.title);
            } else if (download.type === 'album') {
                await this.downloadAlbum(download.albumId, download.title);
            } else if (download.type === 'discography') {
                await this.downloadDiscography(download.artistId, download.title);
            }
            
            this.showNotification('Download restarted', 'success');
        } catch (error) {
            console.error('Failed to retry download:', error);
            this.showNotification('Failed to restart download', 'error');
        }
    }

    /**
     * Remove download from tracking
     */
    removeDownload(downloadId) {
        delete this.activeDownloads[downloadId];
        this.saveDownloadIds();
        this.updateSidebar();
    }

    /**
     * Setup sidebar HTML and event listeners
     */
    setupSidebar() {
        // Check if sidebar already exists
        let sidebar = document.getElementById('downloads-sidebar');
        if (sidebar) {
            console.log('Sidebar already exists, updating existing one');
            // Update existing sidebar
            this.updateSidebar();
            return;
        }
        
        // Create new sidebar
        sidebar = document.createElement('div');
        sidebar.id = 'downloads-sidebar';
        sidebar.className = 'downloads-sidebar';
        sidebar.innerHTML = `
            <div class="sidebar-header">
                <h3>Downloads</h3>
                <div class="sidebar-controls">
                    <span class="download-count" id="download-count">0</span>
                    <button class="toggle-btn" id="toggle-sidebar">×</button>
                </div>
            </div>
            <div class="sidebar-content" id="downloads-list">
                <p class="no-downloads">No active downloads</p>
            </div>
        `;
        
        document.body.appendChild(sidebar);
        
        // Add event listeners
        const toggleBtn = document.getElementById('toggle-sidebar');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                sidebar.classList.toggle('collapsed');
            });
        }
        
        console.log('Sidebar created successfully');
    }

    /**
     * Update sidebar content
     */
    updateSidebar() {
        const downloadsList = document.getElementById('downloads-list');
        const downloadCount = document.getElementById('download-count');
        
        if (!downloadsList || !downloadCount) {
            console.warn('Sidebar elements not found, skipping update');
            return;
        }
        
        const activeCount = Object.keys(this.activeDownloads).length;
        downloadCount.textContent = activeCount;
        
        console.log('Updating sidebar, active downloads:', activeCount);
        console.log('Active downloads data:', this.activeDownloads);
        
        if (activeCount === 0) {
            downloadsList.innerHTML = '<p class="no-downloads">No active downloads</p>';
            return;
        }
        
        downloadsList.innerHTML = '';
        
        Object.entries(this.activeDownloads).forEach(([id, download]) => {
            const item = this.createDownloadItem(id, download);
            downloadsList.appendChild(item);
        });
    }

    /**
     * Create download item element
     */
    createDownloadItem(id, download) {
        const item = document.createElement('div');
        item.className = `download-item ${download.status}`;
        
        const progressBar = download.progress ? 
            `<div class="progress-bar">
                <div class="progress-fill" style="width: ${download.progress}%"></div>
            </div>` : '';
        
        const actionButtons = this.createActionButtons(id, download);
        
        item.innerHTML = `
            <div class="download-info">
                <h4>${this.escapeHtml(download.title || 'Unknown')}</h4>
                <p class="status">Status: ${download.status || 'starting'}</p>
                ${download.progress ? `<p class="progress">Progress: ${download.progress}%</p>` : ''}
                ${download.current_track && download.total_tracks ? 
                    `<p class="track-info">Track ${download.current_track} of ${download.total_tracks}</p>` : ''}
                ${download.current_album && download.total_albums ? 
                    `<p class="album-info">Album ${download.current_album} of ${download.total_albums}</p>` : ''}
                ${download.message ? `<p class="message">${this.escapeHtml(download.message)}</p>` : ''}
                ${progressBar}
            </div>
            <div class="download-actions">
                ${actionButtons}
            </div>
        `;
        
        return item;
    }

    /**
     * Create action buttons for download item
     */
    createActionButtons(id, download) {
        let buttons = '';
        
        if (download.status === 'downloading' || download.status === 'fetching_info') {
            buttons += `<button class="cancel-btn" onclick="downloadManager.cancelDownload('${id}')">Cancel</button>`;
        }
        
        if (download.status === 'error') {
            buttons += `<button class="retry-btn" onclick="downloadManager.retryDownload('${id}')">Retry</button>`;
        }
        
        return buttons;
    }

    /**
     * Show notification message
     */
    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        // Add to page
        document.body.appendChild(notification);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.remove();
        }, 3000);
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
     * Download track (for retry functionality)
     */
    async downloadTrack(trackId, trackTitle) {
        try {
            const response = await fetch(`/api/download/track/${trackId}`);
            const data = await response.json();
            
            if (response.ok) {
                this.addDownload(data.download_id, {
                    type: 'track',
                    title: trackTitle,
                    trackId: trackId
                });
            } else {
                throw new Error(data.error || 'Download failed');
            }
        } catch (error) {
            this.showNotification('Download failed: ' + error.message, 'error');
        }
    }

    /**
     * Download album (for retry functionality)
     */
    async downloadAlbum(albumId, albumTitle) {
        try {
            const response = await fetch(`/api/download/album/${albumId}`);
            const data = await response.json();
            
            if (response.ok) {
                this.addDownload(data.download_id, {
                    type: 'album',
                    title: albumTitle,
                    albumId: albumId
                });
            } else {
                throw new Error(data.error || 'Download failed');
            }
        } catch (error) {
            this.showNotification('Download failed: ' + error.message, 'error');
        }
    }

    /**
     * Download discography (for retry functionality)
     */
    async downloadDiscography(artistId, artistName) {
        try {
            const response = await fetch(`/api/download/artist/${artistId}`);
            const data = await response.json();
            
            if (response.ok) {
                this.addDownload(data.download_id, {
                    type: 'discography',
                    title: `${artistName} - Discography`,
                    artistId: artistId
                });
            } else {
                throw new Error(data.error || 'Download failed');
            }
        } catch (error) {
            this.showNotification('Download failed: ' + error.message, 'error');
        }
    }
}

// Global instance
let downloadManager;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('Initializing DownloadManager...');
    downloadManager = new DownloadManager();
    
    // Make globally accessible for inline onclick handlers
    window.downloadManager = downloadManager;
    
    // Ensure sidebar is visible and working
    setTimeout(() => {
        console.log('DownloadManager initialized, active downloads:', Object.keys(downloadManager.activeDownloads));
    }, 100);
});
