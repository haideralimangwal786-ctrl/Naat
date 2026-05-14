/* ============================================================
   Naat Player — Auth + IndexedDB Persistence + Player Logic
   ============================================================ */

/* ── IndexedDB Setup ── */
var DB_NAME    = 'NaatPlayerDB';
var DB_VERSION = 1;
var STORE_NAME = 'tracks';
var db = null;

function openDB() {
    return new Promise(function(resolve, reject) {
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function(e) {
            var database = e.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                var store = database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                store.createIndex('userId', 'userId', { unique: false });
            }
        };
        req.onsuccess = function(e) { db = e.target.result; resolve(db); };
        req.onerror   = function(e) { reject(e.target.error); };
    });
}

function dbAddTrack(userId, name, size, blob) {
    return new Promise(function(resolve, reject) {
        var tx    = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        var req   = store.add({ userId: userId, name: name, size: size, blob: blob });
        req.onsuccess = function() { resolve(req.result); }; // returns auto-id
        req.onerror   = function() { reject(req.error); };
    });
}

function dbGetUserTracks(userId) {
    return new Promise(function(resolve, reject) {
        var tx    = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var idx   = store.index('userId');
        var req   = idx.getAll(userId);
        req.onsuccess = function() { resolve(req.result); };
        req.onerror   = function() { reject(req.error); };
    });
}

function dbDeleteTrack(id) {
    return new Promise(function(resolve, reject) {
        var tx    = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        var req   = store.delete(id);
        req.onsuccess = function() { resolve(); };
        req.onerror   = function() { reject(req.error); };
    });
}

/* ── Auth Helpers ── */
function getUsers() {
    return JSON.parse(localStorage.getItem('naatUsers') || '{}');
}
function saveUsers(users) {
    localStorage.setItem('naatUsers', JSON.stringify(users));
}
function getSession() {
    return localStorage.getItem('naatSession');
}
function setSession(username) {
    localStorage.setItem('naatSession', username);
}
function clearSession() {
    localStorage.removeItem('naatSession');
}
function hashPass(p) {
    // Simple hash for local-only app
    var h = 0;
    for (var i = 0; i < p.length; i++) { h = (Math.imul(31, h) + p.charCodeAt(i)) | 0; }
    return h.toString(36);
}

/* ── Auth UI ── */
function switchTab(tab) {
    document.getElementById('formLogin').classList.toggle('hidden',    tab !== 'login');
    document.getElementById('formRegister').classList.toggle('hidden', tab !== 'register');
    document.getElementById('tabLogin').classList.toggle('active',    tab === 'login');
    document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
    hideAuthError();
}

function showAuthError(msg) {
    var el = document.getElementById('authError');
    document.getElementById('authErrorMsg').textContent = msg;
    el.classList.remove('hidden');
}
function hideAuthError() {
    document.getElementById('authError').classList.add('hidden');
}

function togglePass(inputId, btn) {
    var input = document.getElementById(inputId);
    var ico   = btn.querySelector('i');
    // Save current value before type change (Firefox bug)
    var val = input.value;
    if (input.type === 'password') {
        input.type = 'text';
        ico.className = 'ri-eye-off-line';
    } else {
        input.type = 'password';
        ico.className = 'ri-eye-line';
    }
    input.value = val; // Restore value after type change
    input.focus();
}

function doLogin() {
    var username = document.getElementById('loginUser').value.trim();
    var password = document.getElementById('loginPass').value;
    if (!username || !password) { showAuthError('Please fill in all fields.'); return; }
    var users = getUsers();
    // Case-insensitive username lookup
    var matchKey = Object.keys(users).find(function(k){ return k.toLowerCase() === username.toLowerCase(); });
    if (!matchKey) { showAuthError('Account not found. Please register first.'); return; }
    if (users[matchKey].hash !== hashPass(password)) { showAuthError('Incorrect password. Try again.'); return; }
    setSession(matchKey);
    startApp(matchKey);
}

function doRegister() {
    var username = document.getElementById('regUser').value.trim();
    var password = document.getElementById('regPass').value.trim();
    var password2= document.getElementById('regPass2').value.trim();
    hideAuthError();
    if (!username || !password || !password2) { showAuthError('Please fill in all fields.'); return; }
    if (username.length < 3)  { showAuthError('Username must be at least 3 characters.'); return; }
    if (password.length < 4)  { showAuthError('Password must be at least 4 characters.'); return; }
    if (password !== password2) { showAuthError('Passwords do not match. Check both fields.'); return; }
    var users = getUsers();
    // Case-insensitive duplicate check
    var exists = Object.keys(users).some(function(k){ return k.toLowerCase() === username.toLowerCase(); });
    if (exists) { showAuthError('Username already taken. Please choose another.'); return; }
    users[username] = { hash: hashPass(password), created: Date.now() };
    saveUsers(users);
    setSession(username);
    startApp(username);
}

function doLogout() {
    // Revoke all blob URLs
    playlist.forEach(function(t) { if (t.url) URL.revokeObjectURL(t.url); });
    playlist = []; curIdx = -1;
    clearSession();
    currentUser = null;
    stopAudio(); resetPlayer();
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('authOverlay').classList.remove('hidden');
    // Clear login fields
    document.getElementById('loginUser').value = '';
    document.getElementById('loginPass').value = '';
    hideAuthError();
    toast('👋 Logged out successfully');
}

/* ── App Startup ── */
var currentUser = null;

function startApp(username) {
    currentUser = username;
    document.getElementById('authOverlay').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    document.getElementById('userChipName').textContent  = username;
    // Load this user's tracks from IndexedDB
    loadUserTracks(username);
}

function loadUserTracks(userId) {
    dbGetUserTracks(userId).then(function(rows) {
        playlist = [];
        rows.forEach(function(row) {
            var url = URL.createObjectURL(row.blob);
            playlist.push({ id: row.id, name: row.name, size: row.size, url: url });
        });
        renderList();
        updateBadge();
        if (playlist.length) toast('🎵 ' + playlist.length + ' naat' + (playlist.length > 1 ? 's' : '') + ' loaded');
    }).catch(function(e) {
        console.error('Error loading tracks:', e);
        renderList(); updateBadge();
    });
}

/* ── Player State ── */
var playlist   = [];
var curIdx     = -1;
var isPlay     = false;
var isShuffle  = false;
var isLoop     = false;
var isMuted    = false;
var vol        = 0.8;
var isDrag     = false;

var audioCtx  = null;
var gainNode  = null;
var analyser  = null;
var audio     = new Audio();
audio.preload = 'auto';
audio.volume  = vol;

/* ── DOM ── */
var fileInput   = document.getElementById('fileInput');
var artDisc     = document.getElementById('artDisc');
var stDot       = document.getElementById('stDot');
var stTxt       = document.getElementById('stTxt');
var infoTitle   = document.getElementById('infoTitle');
var infoSub     = document.getElementById('infoSub');
var tCur        = document.getElementById('tCur');
var tEnd        = document.getElementById('tEnd');
var seekEl      = document.getElementById('seekEl');
var seekFill    = document.getElementById('seekFill');
var seekDot     = document.getElementById('seekDot');
var volFill     = document.getElementById('volFill');
var volSlider   = document.getElementById('volSlider');
var vPct        = document.getElementById('vPct');
var volIco      = document.getElementById('volIco');
var muteBtn     = document.getElementById('muteBtn');
var playBtn     = document.getElementById('playBtn');
var playIco     = document.getElementById('playIco');
var prevBtn     = document.getElementById('prevBtn');
var nextBtn     = document.getElementById('nextBtn');
var shuffleBtn  = document.getElementById('shuffleBtn');
var loopBtn     = document.getElementById('loopBtn');
var loopIco     = document.getElementById('loopIco');
var plList      = document.getElementById('plList');
var plBadge     = document.getElementById('plBadge');
var searchInput = document.getElementById('searchInput');
var clearBtn    = document.getElementById('clearBtn');
var vizEl       = document.getElementById('vizEl');
var vbars       = vizEl.querySelectorAll('span');
var toastEl     = document.getElementById('toast');
var toastTimer  = null;

/* ── Helpers ── */
function toast(m) {
    toastEl.textContent = m;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function() { toastEl.classList.remove('show'); }, 2600);
}
function fmt(s) {
    if (!s || isNaN(s) || !isFinite(s)) return '0:00';
    return Math.floor(s/60) + ':' + String(Math.floor(s%60)).padStart(2,'0');
}
function mb(b) { return (b/1048576).toFixed(2) + ' MB'; }
function noExt(n) { return n.replace(/\.[^/.]+$/, ''); }
function randOther() {
    if (playlist.length === 1) return 0;
    var r; do { r = Math.floor(Math.random()*playlist.length); } while (r === curIdx);
    return r;
}

/* ── Web Audio (Studio Quality Enhancement) ── */
function initCtx() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    var src  = audioCtx.createMediaElementSource(audio);
    
    // 1. Bass Boost (Deep sound)
    var bassNode = audioCtx.createBiquadFilter();
    bassNode.type = 'lowshelf';
    bassNode.frequency.value = 150;
    bassNode.gain.value = 4; // Subtle boost

    // 2. Treble / Clarity (Crisp vocals)
    var trebleNode = audioCtx.createBiquadFilter();
    trebleNode.type = 'highshelf';
    trebleNode.frequency.value = 3000;
    trebleNode.gain.value = 2; // Make voice clear

    // 3. Dynamics Compressor (Prevents distortion & evens out volume)
    var compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-24, audioCtx.currentTime);
    compressor.knee.setValueAtTime(40, audioCtx.currentTime);
    compressor.ratio.setValueAtTime(12, audioCtx.currentTime);
    compressor.attack.setValueAtTime(0, audioCtx.currentTime);
    compressor.release.setValueAtTime(0.25, audioCtx.currentTime);

    // 4. Master Gain & Analyser
    gainNode = audioCtx.createGain();
    gainNode.gain.value = vol;
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;

    // Chain: Source -> Bass -> Treble -> Compressor -> Gain -> Analyser -> Destination
    src.connect(bassNode);
    bassNode.connect(trebleNode);
    trebleNode.connect(compressor);
    compressor.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(audioCtx.destination);

    runViz();
}
function resumeCtx() {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

/* ── File Input ── */
fileInput.addEventListener('change', function() {
    if (!currentUser) return;
    var files = Array.from(this.files);
    if (!files.length) return;
    var added = 0;
    var total = files.length;
    files.forEach(function(f) {
        dbAddTrack(currentUser, noExt(f.name), f.size, f).then(function(newId) {
            var url = URL.createObjectURL(f);
            playlist.push({ id: newId, name: noExt(f.name), size: f.size, url: url });
            added++;
            if (added === total) {
                renderList();
                updateBadge();
                if (curIdx === -1) loadTrack(0);
                toast('✅ ' + added + ' track' + (added > 1 ? 's' : '') + ' added & saved!');
            }
        }).catch(function(e) {
            console.error('DB add error:', e);
        });
    });
    fileInput.value = '';
});

/* ── Playlist Render ── */
function renderList(filter) {
    filter = (filter || '').toLowerCase().trim();
    plList.innerHTML = '';

    var items = playlist
        .map(function(t,i) { return {t:t, i:i}; })
        .filter(function(x) { return !filter || x.t.name.toLowerCase().includes(filter); });

    if (!items.length) {
        var li = document.createElement('li');
        li.className = 'pl-empty';
        li.innerHTML = filter
            ? '<strong style="color:var(--muted)">No results for "' + filter + '"</strong>'
            : '<div class="pl-empty-icon"><i class="ri-music-2-fill"></i></div>' +
              '<strong>Your playlist is empty</strong>' +
              '<span>Click \'Add Naats\' to get started</span>';
        plList.appendChild(li);
        return;
    }

    items.forEach(function(x) {
        var li = document.createElement('li');
        li.className = 'pl-item' + (x.i === curIdx ? ' active' : '');
        li.dataset.index = x.i;
        li.innerHTML =
            '<span class="pl-num">' + (x.i === curIdx
                ? '<i class="ri-music-fill" style="color:var(--gold)"></i>'
                : (x.i + 1)) + '</span>' +
            '<div class="pl-info">' +
                '<div class="pl-name" title="' + x.t.name + '">' + x.t.name + '</div>' +
                '<div class="pl-size">' + mb(x.t.size) + '</div>' +
            '</div>' +
            '<button class="pl-del" data-i="' + x.i + '" aria-label="Remove"><i class="ri-delete-bin-6-line"></i></button>';

        li.addEventListener('click', function(e) {
            var d = e.target.closest('.pl-del');
            if (d) { delTrack(parseInt(d.dataset.i)); return; }
            loadTrack(parseInt(li.dataset.index));
        });
        plList.appendChild(li);
    });
}

function updateBadge() {
    plBadge.textContent = playlist.length + ' track' + (playlist.length !== 1 ? 's' : '');
}

function delTrack(i) {
    var track = playlist[i];
    // Remove from IndexedDB
    dbDeleteTrack(track.id).catch(function(e) { console.error('DB delete error:', e); });
    // Revoke blob URL
    URL.revokeObjectURL(track.url);
    playlist.splice(i, 1);
    if (curIdx === i) {
        stopAudio(); curIdx = -1;
        if (playlist.length) loadTrack(Math.min(i, playlist.length-1));
        else resetPlayer();
    } else if (curIdx > i) { curIdx--; }
    renderList(searchInput.value);
    updateBadge();
    toast('🗑️ Track removed permanently');
}

function resetPlayer() {
    infoTitle.textContent = 'Select a Naat';
    infoSub.textContent   = 'No file loaded';
    tCur.textContent = '0:00'; tEnd.textContent = '0:00';
    seekFill.style.width = '0%'; seekDot.style.left = '0%';
    artDisc.classList.remove('playing');
    playIco.className = 'ri-play-fill';
    stDot.className = 'st-dot'; stTxt.textContent = 'Ready';
    isPlay = false;
}

/* ── Load Track ── */
function loadTrack(i) {
    if (i < 0 || i >= playlist.length) return;
    curIdx = i;
    var t  = playlist[i];
    audio.src    = t.url;
    audio.volume = isMuted ? 0 : vol;
    audio.loop   = isLoop;
    infoTitle.textContent = t.name;
    infoTitle.classList.toggle('scroll', t.name.length > 22);
    infoSub.textContent   = '♪  ' + mb(t.size);
    initCtx(); resumeCtx();
    audio.play().then(onStart).catch(function(e) { console.warn(e); });
    renderList(searchInput.value);
}

function onStart() {
    isPlay = true;
    playIco.className = 'ri-pause-fill';
    artDisc.classList.add('playing');
    stDot.className = 'st-dot on';
    stTxt.textContent = 'Playing';
}
function stopAudio() {
    audio.pause(); isPlay = false;
    playIco.className = 'ri-play-fill';
    artDisc.classList.remove('playing');
    stDot.className = 'st-dot'; stTxt.textContent = 'Paused';
}

/* ── Controls ── */
playBtn.addEventListener('click', function() {
    if (!playlist.length) { toast('⚠️ Add naats first!'); return; }
    if (curIdx === -1) { loadTrack(0); return; }
    resumeCtx();
    if (isPlay) { stopAudio(); }
    else { audio.play().then(onStart).catch(function(e) { console.warn(e); }); }
});

nextBtn.addEventListener('click', function() {
    if (!playlist.length) { toast('⚠️ Playlist is empty!'); return; }
    var next;
    if (isShuffle) {
        next = randOther();
    } else {
        // If nothing playing yet, start from 0; else go forward
        next = (curIdx < 0 ? 0 : (curIdx + 1)) % playlist.length;
    }
    loadTrack(next);
});

prevBtn.addEventListener('click', function() {
    if (!playlist.length) { toast('⚠️ Playlist is empty!'); return; }
    
    var prev;
    if (isShuffle) {
        prev = randOther();
    } else {
        if (curIdx <= 0) {
            // At first track (or none) → wrap to last
            prev = playlist.length - 1;
        } else {
            prev = curIdx - 1;
        }
    }
    loadTrack(prev);
});

audio.addEventListener('ended', function() {
    if (isLoop) return;
    if (isShuffle) { loadTrack(randOther()); return; }
    if (curIdx < playlist.length - 1) {
        loadTrack(curIdx + 1);
    } else {
        stopAudio();
        stTxt.textContent = 'Finished';
        toast('✅ Playlist finished');
    }
});

shuffleBtn.addEventListener('click', function() {
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle('active', isShuffle);
    toast(isShuffle ? '🔀 Shuffle On' : '🔀 Shuffle Off');
});
loopBtn.addEventListener('click', function() {
    isLoop = !isLoop;
    audio.loop = isLoop;
    loopBtn.classList.toggle('active', isLoop);
    loopIco.className = isLoop ? 'ri-repeat-one-fill' : 'ri-repeat-line';
    toast(isLoop ? '🔁 Loop On' : '🔁 Loop Off');
});

/* ── Volume ── */
volSlider.addEventListener('input', function() {
    vol = parseInt(this.value)/100;
    isMuted = (vol === 0);
    applyVol(); updateVolUI();
});
muteBtn.addEventListener('click', function() {
    isMuted = !isMuted;
    applyVol(); updateVolUI();
    toast(isMuted ? '🔇 Muted' : '🔊 Unmuted');
});
function applyVol() {
    var v = isMuted ? 0 : vol;
    audio.volume = v;
    if (gainNode) gainNode.gain.value = v;
}
function updateVolUI() {
    var p = isMuted ? 0 : Math.round(vol*100);
    volFill.style.width = p + '%';
    vPct.textContent    = p + '%';
    volIco.className    = isMuted ? 'ri-volume-mute-fill' : (vol > 0.5 ? 'ri-volume-up-fill' : 'ri-volume-down-fill');
    muteBtn.classList.toggle('muted', isMuted);
}

/* ── Seek ── */
audio.addEventListener('timeupdate', function() { if (!isDrag) updateSeek(); });
audio.addEventListener('loadedmetadata', function() { tEnd.textContent = fmt(audio.duration); });
function updateSeek() {
    var p = audio.duration ? (audio.currentTime/audio.duration)*100 : 0;
    seekFill.style.width = p + '%';
    seekDot.style.left   = p + '%';
    tCur.textContent     = fmt(audio.currentTime);
}

seekEl.addEventListener('mousedown', startDrag);
seekEl.addEventListener('touchstart', startDrag, {passive:true});
function startDrag(e) {
    isDrag = true; doSeek(e);
    document.addEventListener('mousemove', doSeek);
    document.addEventListener('touchmove', doSeek, {passive:true});
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag);
}
function doSeek(e) {
    var r = seekEl.getBoundingClientRect();
    var cx = e.touches ? e.touches[0].clientX : e.clientX;
    var p  = Math.max(0, Math.min(1, (cx - r.left)/r.width));
    seekFill.style.width = (p*100)+'%';
    seekDot.style.left   = (p*100)+'%';
    if (audio.duration) tCur.textContent = fmt(p*audio.duration);
}
function endDrag(e) {
    isDrag = false;
    var r = seekEl.getBoundingClientRect();
    var cx = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
    var p  = Math.max(0, Math.min(1, (cx - r.left)/r.width));
    if (audio.duration) audio.currentTime = p*audio.duration;
    document.removeEventListener('mousemove', doSeek);
    document.removeEventListener('touchmove', doSeek);
    document.removeEventListener('mouseup', endDrag);
    document.removeEventListener('touchend', endDrag);
}

/* ── Keyboard ── */
document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === ' ')           { e.preventDefault(); playBtn.click(); }
    else if (e.key==='ArrowRight'){ e.preventDefault(); if(audio.duration) audio.currentTime=Math.min(audio.duration,audio.currentTime+10); toast('⏩ +10s'); }
    else if (e.key==='ArrowLeft') { e.preventDefault(); audio.currentTime=Math.max(0,audio.currentTime-10); toast('⏪ -10s'); }
    else if (e.key==='ArrowUp')   { e.preventDefault(); volSlider.value=Math.min(100,+volSlider.value+5); volSlider.dispatchEvent(new Event('input')); }
    else if (e.key==='ArrowDown') { e.preventDefault(); volSlider.value=Math.max(0,+volSlider.value-5);   volSlider.dispatchEvent(new Event('input')); }
    else if (e.key==='m'||e.key==='M') muteBtn.click();
    else if (e.key==='l'||e.key==='L') loopBtn.click();
    else if (e.key==='s'||e.key==='S') shuffleBtn.click();
});

/* ── Search ── */
searchInput.addEventListener('input', function() {
    clearBtn.classList.toggle('hidden', !this.value);
    renderList(this.value);
});
clearBtn.addEventListener('click', function() {
    searchInput.value = ''; clearBtn.classList.add('hidden'); renderList('');
});

/* ── Visualizer ── */
function runViz() {
    var buf  = new Uint8Array(analyser.frequencyBinCount);
    var step = Math.floor(buf.length/vbars.length);
    function draw() {
        requestAnimationFrame(draw);
        if (!isPlay) return;
        analyser.getByteFrequencyData(buf);
        vbars.forEach(function(b, i) {
            b.style.height = Math.max(3, (buf[i*step]/255)*32) + 'px';
        });
    }
    draw();
}

/* ── Enter key support for login forms ── */
document.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter') return;
    var overlay = document.getElementById('authOverlay');
    if (overlay && overlay.style.display !== 'none') {
        var loginForm = document.getElementById('formLogin');
        if (loginForm && loginForm.style.display !== 'none') doLogin();
        else doRegister();
    }
});

/* ── Init ── */
document.addEventListener('click', resumeCtx);
updateVolUI();

// Open IndexedDB then check session
openDB().then(function() {
    var session = getSession();
    if (session) {
        // Already logged in — restore session
        startApp(session);
    }
    // else: show login overlay (already visible by default)
}).catch(function(e) {
    console.error('IndexedDB failed:', e);
    toast('⚠️ Storage error. Please refresh.');
});
