const api = require('d-fi-core');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

// Get command line arguments
const method = process.argv[2];
const params = JSON.parse(process.argv[3] || '{}');
const arl = process.argv[4];

async function initApi() {
    if (!arl) {
        throw new Error('ARL cookie is required');
    }
    
    if (arl.length !== 192) {
        throw new Error(`Invalid ARL cookie. Expected 192 characters, got ${arl.length}. Please get a fresh ARL from your browser.`);
    }
    
    try {
        await api.initDeezerApi(arl);
        
        // Verify user
        const user = await api.getUser();
        // Don't log authentication success - it breaks JSON parsing
        return true;
    } catch (err) {
        throw new Error(`Authentication failed: ${err.message}`);
    }
}

async function searchMusic(params) {
    const { query, types = ['TRACK'], limit = 15 } = params;
    
    try {
        const results = await api.searchMusic(query, types, limit);
        return results;
    } catch (err) {
        throw new Error(`Search failed: ${err.message}`);
    }
}

async function getTrackInfo(params) {
    const { track_id } = params;
    
    try {
        const track = await api.getTrackInfo(track_id);
        return track;
    } catch (err) {
        throw new Error(`Failed to get track info: ${err.message}`);
    }
}

async function getAlbumInfo(params) {
    const { album_id } = params;
    
    try {
        const album = await api.getAlbumInfo(album_id);
        return album;
    } catch (err) {
        throw new Error(`Failed to get album info: ${err.message}`);
    }
}

async function getAlbumTracks(params) {
    const { album_id } = params;
    
    try {
        const tracks = await api.getAlbumTracks(album_id);
        return tracks;
    } catch (err) {
        throw new Error(`Failed to get album tracks: ${err.message}`);
    }
}

async function getPlaylistInfo(params) {
    const { playlist_id } = params;
    
    try {
        const playlist = await api.getPlaylistInfo(playlist_id);
        return playlist;
    } catch (err) {
        throw new Error(`Failed to get playlist info: ${err.message}`);
    }
}

async function getPlaylistTracks(params) {
    const { playlist_id } = params;
    
    try {
        const tracks = await api.getPlaylistTracks(playlist_id);
        return tracks;
    } catch (err) {
        throw new Error(`Failed to get playlist tracks: ${err.message}`);
    }
}

async function getLyrics(params) {
    const { track_id } = params;
    
    try {
        const lyrics = await api.getLyrics(track_id);
        return lyrics;
    } catch (err) {
        throw new Error(`Failed to get lyrics: ${err.message}`);
    }
}

async function downloadTrack(params) {
    const { track_id, quality = 3, download_path, organize_by_folder = true, filename, download_lyrics = false } = params;
    
    try {
        // Get track info
        const track = await api.getTrackInfo(track_id);
        
        // Get download URL
        const trackData = await api.getTrackDownloadUrl(track, quality);
        
        // Download the track
        const { data } = await axios.get(trackData.trackUrl, { responseType: 'arraybuffer' });
        
        // Decrypt if needed
        const decryptedData = trackData.isEncrypted ? api.decryptDownload(data, track.SNG_ID) : data;
        
        // Add metadata
        const trackWithMetadata = await api.addTrackTags(decryptedData, track, 500);
        
        // Create filename
        let finalFilename;
        if (filename) {
            // Use provided filename (without extension if not present)
            finalFilename = filename.endsWith('.mp3') ? filename : `${filename}.mp3`;
            finalFilename = path.join(download_path, finalFilename);
        } else if (organize_by_folder) {
            const artistFolder = path.join(download_path, sanitizeFilename(track.ART_NAME));
            fs.ensureDirSync(artistFolder);
            finalFilename = path.join(artistFolder, `${sanitizeFilename(track.SNG_TITLE)} - ${sanitizeFilename(track.ART_NAME)}.mp3`);
        } else {
            finalFilename = path.join(download_path, `${sanitizeFilename(track.SNG_TITLE)} - ${sanitizeFilename(track.ART_NAME)}.mp3`);
        }
        
        // Ensure directory exists
        fs.ensureDirSync(path.dirname(finalFilename));
        
        // Save file
        fs.writeFileSync(finalFilename, trackWithMetadata);
        
        // Download lyrics if requested
        let lyricsResult = null;
        if (download_lyrics) {
            try {
                lyricsResult = await saveLyricsFile(track, path.dirname(finalFilename), path.basename(finalFilename, '.mp3'));
            } catch (lyricsError) {
                // Lyrics download failure shouldn't break the main download
                console.warn(`Lyrics download failed: ${lyricsError.message}`);
            }
        }
        
        const result = {
            success: true,
            filename: path.basename(finalFilename),
            full_path: finalFilename,
            track_title: track.SNG_TITLE,
            artist: track.ART_NAME,
            album: track.ALB_TITLE
        };
        
        if (lyricsResult) {
            result.lyrics_file = lyricsResult.filename;
            result.lyrics_format = lyricsResult.format;
        }
        
        return result;
    } catch (err) {
        throw new Error(`Download failed: ${err.message}`);
    }
}

function sanitizeFilename(filename) {
    // Remove invalid characters for filenames
    return filename.replace(/[<>:"/\\|?*]/g, '').trim();
}

async function saveLyricsFile(track, directoryPath, baseFilename) {
    try {
        // Get lyrics data
        const lyricsData = await api.getLyrics(track.SNG_ID);
        
        if (!lyricsData) {
            return null;
        }
        
        let lyricsContent = '';
        let fileExtension = 'txt';
        let filename = '';
        
        // Prioritize LRC format (synchronized lyrics)
        if (lyricsData.LYRICS_SYNC_JSON && lyricsData.LYRICS_SYNC_JSON.length > 0) {
            // Convert synced lyrics to LRC format
            lyricsContent = convertToLRC(lyricsData.LYRICS_SYNC_JSON);
            fileExtension = 'lrc';
        } else if (lyricsData.LYRICS_TEXT) {
            // Fallback to plain text lyrics
            lyricsContent = lyricsData.LYRICS_TEXT;
            fileExtension = 'txt';
        } else {
            // No lyrics available
            return null;
        }
        
        // Create lyrics filename
        const lyricsFilename = `${sanitizeFilename(baseFilename)}.${fileExtension}`;
        const lyricsPath = path.join(directoryPath, lyricsFilename);
        
        // Save lyrics file
        fs.writeFileSync(lyricsPath, lyricsContent, 'utf8');
        
        return {
            filename: lyricsFilename,
            format: fileExtension,
            path: lyricsPath
        };
        
    } catch (error) {
        console.warn(`Failed to save lyrics file: ${error.message}`);
        return null;
    }
}

function convertToLRC(syncedLyrics) {
    if (!Array.isArray(syncedLyrics)) {
        return '';
    }
    
    let lrcContent = '';
    
    // Convert synced lyrics to LRC format
    syncedLyrics.forEach(line => {
        if (line && line.milliseconds && line.line) {
            const minutes = Math.floor(line.milliseconds / 60000);
            const seconds = Math.floor((line.milliseconds % 60000) / 1000);
            const milliseconds = line.milliseconds % 1000;
            
            const timestamp = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
            lrcContent += `[${timestamp}]${line.line}\n`;
        }
    });
    
    return lrcContent;
}

// Main execution logic
async function main() {
    try {
        // Initialize API for most methods
        if (method !== 'init') {
            await initApi();
        }
        
        let result;
        
        switch (method) {
            case 'init':
                result = await initApi();
                break;
            case 'searchMusic':
                result = await searchMusic(params);
                break;
            case 'getTrackInfo':
                result = await getTrackInfo(params);
                break;
            case 'getAlbumInfo':
                result = await getAlbumInfo(params);
                break;
            case 'getAlbumTracks':
                result = await getAlbumTracks(params);
                break;
            case 'getPlaylistInfo':
                result = await getPlaylistInfo(params);
                break;
            case 'getPlaylistTracks':
                result = await getPlaylistTracks(params);
                break;
            case 'getLyrics':
                result = await getLyrics(params);
                break;
            case 'downloadTrack':
                result = await downloadTrack(params);
                break;
            default:
                throw new Error(`Unknown method: ${method}`);
        }
        
        console.log(JSON.stringify(result));
    } catch (error) {
        console.error(JSON.stringify({ error: error.message }));
        process.exit(1);
    }
}

main();
