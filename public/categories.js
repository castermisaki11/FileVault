/* =====================================================
   FileVault — categories.js  v3
   Features: folders, search-all, move/copy, rename,
             drag-drop to folder, persist folder state,
             folder badges, collapse sidebar
   ===================================================== */

// ── Category definitions ──
const CATS = {
  image: { label:'รูปภาพ', icon:'🖼️', color:'#FF6B6B', ext:['png','jpg','jpeg','gif','webp','svg','bmp','tiff','ico','heic','avif'] },
  code:  { label:'โค้ด',   icon:'💻', color:'#6C5CE7', ext:['js','ts','jsx','tsx','html','htm','css','scss','sass','json','py','sh','bash','php','c','cpp','h','hpp','java','go','rs','xml','yaml','yml','toml','ini','env','rb','swift','kt','dart','vue','svelte','astro','mdx','graphql','sql','r','lua'] },
  doc:   { label:'เอกสาร', icon:'📄', color:'#00B894', ext:['txt','md','pdf','doc','docx','csv','xls','xlsx','ppt','pptx','odt','rtf','pages','numbers','keynote','epub','mobi'] },
  zip:   { label:'ZIP',    icon:'🗜️', color:'#E17055', ext:['zip','rar','7z','tar','gz','bz2','xz','tgz'] },
};
const IMAGE_EXTS  = ['png','jpg','jpeg','gif','webp'];
const VIDEO_EXTS  = ['mp4','webm','ogg','mov','mkv','avi'];
const AUDIO_EXTS  = ['mp3','wav','ogg','flac','aac','m4a','opus'];
const PDF_EXTS    = ['pdf'];
const TEXT_EXTS   = ['txt','md','json','js','ts','jsx','tsx','html','htm','css','scss','sass','py','sh','bash','php','c','cpp','h','java','go','rs','xml','yaml','yml','toml','ini','env','rb','swift','kt','dart','vue','svelte','csv','sql','r','lua','log','gitignore'];

function getPreviewType(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (IMAGE_EXTS.includes(ext))  return 'image';
  if (VIDEO_EXTS.includes(ext))  return 'video';
  if (AUDIO_EXTS.includes(ext))  return 'audio';
  if (PDF_EXTS.includes(ext))    return 'pdf';
  if (TEXT_EXTS.includes(ext))   return 'text';
  return 'none';
}

let previewMode = true; // global toggle: show preview by default

// ── State ──
let currentCat    = 'all';
let currentSort   = 'name';
let sortDir       = 1;   // 1 = asc, -1 = desc
let filterSize    = '';
let filterDate    = '';
let viewMode      = 'grid';
let allFiles      = [];
let zipStore      = {};
let currentFile   = null;
let modalZipName  = null;
const API         = '';

// Folder state
let currentFolder  = '';
let allFolders     = [];
let sidebarCollapsed = false;
let searchGlobal   = false;

// Lightbox
let lbFiles = [], lbIndex = 0;

// Move modal state
let moveTarget = null; // { name, folder }

// Lock state
const unlockedFolders = {}; // { folderPath: pin }
let lockedFoldersList = [];
let lockModalCallback = null;
let lockSettingsTarget = null;

// ── Init ──
window.addEventListener('load', () => {
  if (localStorage.getItem('fv-dark')==='1') { document.body.classList.add('dark'); const b=document.getElementById('dark-btn'); if(b) b.textContent='☀️'; }
  if (localStorage.getItem('fv-view')) { viewMode=localStorage.getItem('fv-view'); updateViewBtn(); }
  // restore preview mode
  if (localStorage.getItem('fv-preview')==='0') { previewMode=false; updatePreviewBtn(); }
  // restore last folder
  const saved = localStorage.getItem('fv-folder');
  if (saved !== null) currentFolder = saved;
  loadFolders();
  loadFiles();
  loadLocks();
  setupDragDrop();
  setupKeyboard();
  updateBreadcrumb();
});

function updatePreviewBtn() {
  const btn = document.getElementById('preview-global-btn');
  if (!btn) return;
  if (previewMode) {
    btn.textContent = '👁';
    btn.classList.remove('preview-off');
    btn.title = 'Preview เปิดอยู่ — คลิกเพื่อปิด';
  } else {
    btn.textContent = '👁';
    btn.classList.add('preview-off');
    btn.title = 'Preview ปิดอยู่ — คลิกเพื่อเปิด';
  }
}

function toggleGlobalPreview() {
  previewMode = !previewMode;
  localStorage.setItem('fv-preview', previewMode ? '1' : '0');
  updatePreviewBtn();
  const msg = previewMode ? '👁 เปิด Preview แล้ว' : '🚫 ปิด Preview แล้ว';
  toast(msg);
  renderFiles(); // re-render cards to show/hide image thumbnails
}

// ── Helpers ──
function getFileCat(name) {
  const ext=name.split('.').pop().toLowerCase(), parts=name.toLowerCase().split('.');
  if (parts.length>=3&&['tar.gz','tar.bz2'].includes(parts.slice(-2).join('.'))) return 'zip';
  for (const [cat,def] of Object.entries(CATS)) if (def.ext.includes(ext)) return cat;
  return 'other';
}
function getCatInfo(cat) { return CATS[cat]||{label:'อื่นๆ',icon:'📦',color:'#74B9FF'}; }
function isRealImage(name) { return IMAGE_EXTS.includes(name.split('.').pop().toLowerCase()); }
function fIcon(name) {
  const e=name.split('.').pop().toLowerCase();
  const m={png:'🖼️',jpg:'🖼️',jpeg:'🖼️',gif:'🎞️',webp:'🖼️',svg:'🎨',bmp:'🖼️',js:'📜',ts:'📘',jsx:'⚛️',tsx:'⚛️',html:'🌐',css:'🎨',scss:'🎨',json:'📋',py:'🐍',sh:'⚙️',bash:'⚙️',php:'🐘',c:'🔧',cpp:'🔧',java:'☕',go:'🔵',rs:'🦀',xml:'📋',yaml:'⚙️',yml:'⚙️',sql:'🗄️',rb:'💎',swift:'🍎',kt:'🤖',dart:'🎯',vue:'💚',svelte:'🔸',txt:'📄',md:'📝',pdf:'📑',doc:'📝',docx:'📝',csv:'📊',xls:'📊',xlsx:'📊',ppt:'📊',pptx:'📊',epub:'📚',zip:'🗜️',rar:'🗜️','7z':'🗜️',tar:'📦',gz:'📦',mp4:'🎥',mov:'🎥',mp3:'🎵',wav:'🎵',ttf:'🔤',db:'🗄️',sqlite:'🗄️'};
  return m[e]||'📄';
}
function getLang(name) {
  const e=name.split('.').pop().toLowerCase();
  const m={js:'JS',ts:'TS',jsx:'JSX',tsx:'TSX',html:'HTML',css:'CSS',scss:'SCSS',json:'JSON',py:'PY',sh:'SH',bash:'BASH',php:'PHP',c:'C',cpp:'C++',java:'JAVA',go:'GO',rs:'RUST',xml:'XML',yaml:'YAML',yml:'YAML',sql:'SQL',rb:'RUBY',swift:'SWIFT',kt:'KT',dart:'DART',vue:'VUE',svelte:'SVELTE',md:'MD',txt:'TXT',csv:'CSV',r:'R',lua:'LUA',toml:'TOML',ini:'INI'};
  return m[e]||e.toUpperCase().slice(0,6);
}
function hSize(b) { if(!b) return '0 B'; return b<1024?b+' B':b<1048576?(b/1024).toFixed(1)+' KB':(b/1048576).toFixed(2)+' MB'; }
function esc(s)  { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escA(s) { return esc(s).replace(/'/g,'&#39;'); }
function folderQs(f) { const folder=f!==undefined?f:currentFolder; return folder?`?folder=${encodeURIComponent(folder)}`:''; }

// ══════════════════════════════════════════════
// FOLDERS
// ══════════════════════════════════════════════
async function loadFolders() {
  try {
    const d = await apiFetch('/api/folders');
    if (d.ok) { allFolders = d.folders||[]; renderFolderSidebar(); }
  } catch(e) { console.error('loadFolders:', e); }
}

function confirmDownload() {
  const ok = confirm("คุณต้องการดาวน์โหลดไฟล์ทั้งหมดใช่ไหม?");
  if (!ok) return;

  downloadAll();
}

function renderFolderSidebar() {
  const sb = document.getElementById('folder-sidebar');
  if (!sb) return;
  sb.innerHTML = '';

  const folderIcons = { photos:'🖼',images:'🖼',photo:'🖼',files:'📁',docs:'📄',documents:'📄',videos:'🎬',music:'🎵',backup:'💾',code:'💻',downloads:'📥',archive:'📦','discord-images':'💬' };

  // Root item
  const rootItem = document.createElement('div');
  rootItem.className = 'sb-item' + (currentFolder==='' ? ' active' : '');
  rootItem.innerHTML = '<span class="sb-ico">🏠</span><span class="sb-lbl">ทั้งหมด</span>';
  rootItem.onclick = () => navigateFolder('');
  rootItem.addEventListener('dragover', e => { e.preventDefault(); rootItem.classList.add('drag-over'); });
  rootItem.addEventListener('dragleave', () => rootItem.classList.remove('drag-over'));
  rootItem.addEventListener('drop', e => { e.preventDefault(); rootItem.classList.remove('drag-over'); handleDropToFolder(e, ''); });
  sb.appendChild(rootItem);

  allFolders.forEach(f => {
    const depth = f.path.split('/').length - 1;
    const icon  = folderIcons[f.name.toLowerCase()] || '📂';
    const locked = isFolderLocked(f.path);
    const unlocked = isFolderUnlocked(f.path);
    const isActive = currentFolder === f.path;

    const wrap = document.createElement('div');
    wrap.className = 'sb-folder-wrap';

    const item = document.createElement('div');
    item.className = 'sb-item' + (isActive ? ' active' : '');
    item.setAttribute('data-folder', f.path);
    item.style.paddingLeft = (10 + depth * 12) + 'px';

    const lockPill = locked
      ? '<span class="sb-lock-pill ' + (unlocked ? 'unlocked' : '') + '">' + (unlocked ? '🔓' : '🔒') + '</span>'
      : '';
    const badge = f.fileCount ? '<span class="sb-badge">' + f.fileCount + '</span>' : '';

    item.innerHTML = '<span class="sb-ico">' + icon + '</span><span class="sb-lbl">' + esc(f.name) + '</span>' + lockPill + badge + '<span class="sb-spacer"></span>';

    const actions = document.createElement('div');
    actions.className = 'sb-actions';

    const lockActBtn = document.createElement('button');
    lockActBtn.className = 'sb-act-btn sb-act-lock';
    lockActBtn.title = locked ? 'จัดการรหัส' : 'ตั้งรหัส';
    lockActBtn.textContent = locked ? '🔐' : '🔒';
    lockActBtn.onclick = e => { e.stopPropagation(); openLockSettings(f.path); };

    const renActBtn = document.createElement('button');
    renActBtn.className = 'sb-act-btn sb-act-ren';
    renActBtn.title = 'เปลี่ยนชื่อ';
    renActBtn.textContent = '✏️';
    renActBtn.onclick = e => { e.stopPropagation(); openRenameFolderModal(f.path, f.name); };

    const delActBtn = document.createElement('button');
    delActBtn.className = 'sb-act-btn sb-act-del';
    delActBtn.title = 'ลบ folder';
    delActBtn.textContent = '🗑';
    delActBtn.onclick = e => { e.stopPropagation(); deleteFolder(f.path, f.fileCount); };

    actions.appendChild(lockActBtn);
    actions.appendChild(renActBtn);
    actions.appendChild(delActBtn);
    item.appendChild(actions);

    item.onclick = e => {
      if (locked && !unlocked) requireUnlock(f.path, () => navigateFolder(f.path));
      else navigateFolder(f.path);
    };
    item.addEventListener('dragover', e => { e.preventDefault(); item.classList.add('drag-over'); });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', e => { e.preventDefault(); item.classList.remove('drag-over'); handleDropToFolder(e, f.path); });

    wrap.appendChild(item);

    // Thumbnail strip — fetch images for this folder asynchronously
    const strip = document.createElement('div');
    strip.className = 'sb-thumb-strip sb-thumb-loading';
    strip.innerHTML = '<span style="color:var(--t4);font-size:0.7rem;padding:4px">...</span>';
    wrap.appendChild(strip);

    // Async: load images for this folder and render strip
    (async () => {
      try {
        const qs = f.path ? '?folder=' + encodeURIComponent(f.path) : '';
        const d = await apiFetch('/api/files' + qs);
        if (!d.ok) { strip.remove(); return; }
        const imgs = (d.files || []).filter(x => !x.isDir && isRealImage(x.name));
        strip.innerHTML = '';
        strip.classList.remove('sb-thumb-loading');
        if (!imgs.length) { strip.remove(); return; }
        const visible = imgs.slice(0, 5);
        visible.forEach(img => {
          const t = document.createElement('div');
          t.className = 'sb-thumb';
          t.title = img.name;
          t.style.backgroundImage = 'url(' + API + '/api/download/' + encodeURIComponent(img.name) + '?folder=' + encodeURIComponent(f.path) + ')';
          t.onclick = e => { e.stopPropagation(); openLightbox(img.name, imgs); };
          strip.appendChild(t);
        });
        if (imgs.length > 5) {
          const more = document.createElement('div');
          more.className = 'sb-thumb sb-thumb-more';
          more.textContent = '+' + (imgs.length - 5);
          more.onclick = e => { e.stopPropagation(); navigateFolder(f.path); };
          strip.appendChild(more);
        }
      } catch { strip.remove(); }
    })();

    sb.appendChild(wrap);
  });

  const addDiv = document.createElement('div');
  addDiv.className = 'sb-add-row';
  addDiv.innerHTML = '<input class="sb-add-inp" id="new-folder-inp" placeholder="\uD83D\uDCC1 folder \u0E43\u0E2B\u0E21\u0E48..." onkeydown="if(event.key===\'Enter\')createFolder()"/><button class="sb-add-btn" onclick="createFolder()" title="\u0E2A\u0E23\u0E49\u0E32\u0E07">\uff0b</button>';
  sb.appendChild(addDiv);
}

async function navigateFolder(folder) {
  if (folder && isFolderLocked(folder) && !isFolderUnlocked(folder)) {
    requireUnlock(folder, () => navigateFolder(folder));
    return;
  }
  currentFolder = folder;
  localStorage.setItem('fv-folder', folder);
  currentCat = 'all';
  searchGlobal = false;
  document.querySelectorAll('.cat-tab').forEach(t=>t.classList.remove('active'));
  const allTab = document.querySelector('.cat-tab[data-cat="all"]');
  if (allTab) allTab.classList.add('active');
  updateBreadcrumb();
  renderFolderSidebar();
  await loadFiles();
}

function updateBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  if (!bc) return;
  if (!currentFolder) { bc.innerHTML = '<span class="bc-root">🏠 ทั้งหมด</span>'; return; }
  const parts = currentFolder.split('/');
  let html = '<span class="bc-item bc-clickable" onclick="navigateFolder(\'\')">🏠</span>';
  parts.forEach((p,i) => {
    const pth = parts.slice(0,i+1).join('/');
    html += ' <span class="bc-sep">›</span> ';
    if (i===parts.length-1) html += `<span class="bc-item bc-active">${esc(p)}</span>`;
    else html += `<span class="bc-item bc-clickable" onclick="navigateFolder('${escA(pth)}')">${esc(p)}</span>`;
  });
  bc.innerHTML = html;
}

async function createFolder() {
  const inp = document.getElementById('new-folder-inp');
  if (!inp) return;
  const name = inp.value.trim(); if (!name) return;
  const fullName = currentFolder ? currentFolder+'/'+name : name;
  const d = await apiFetch('/api/folders', {method:'POST', body:{name:fullName}});
  if (d.ok) { inp.value=''; toast('📂 สร้าง: '+name); await loadFolders(); }
  else toast('⚠ '+d.error, true);
}

function openRenameFolderModal(folderPath, oldName) {
  const modal = document.getElementById('rename-folder-modal');
  const inp = document.getElementById('rename-folder-inp');
  document.getElementById('rename-folder-target').textContent = oldName;
  inp.value = oldName;
  modal.dataset.folderPath = folderPath;
  modal.dataset.oldName = oldName;
  modal.classList.remove('hidden');
  setTimeout(() => { inp.focus(); inp.select(); }, 80);
}

function closeRenameFolderModal() {
  document.getElementById('rename-folder-modal').classList.add('hidden');
}

async function confirmRenameFolder() {
  const modal = document.getElementById('rename-folder-modal');
  const folderPath = modal.dataset.folderPath;
  const oldName = modal.dataset.oldName;
  const newName = document.getElementById('rename-folder-inp').value.trim();
  const errEl = document.getElementById('rename-folder-error');
  errEl.classList.add('hidden');
  if (!newName || newName === oldName) { closeRenameFolderModal(); return; }
  const d = await apiFetch('/api/folders', {method:'PATCH', body:{from:folderPath, to:newName}});
  if (d.ok) {
    if (currentFolder===folderPath || currentFolder.startsWith(folderPath+'/')) {
      currentFolder = d.folder;
      localStorage.setItem('fv-folder', currentFolder);
      updateBreadcrumb();
    }
    closeRenameFolderModal();
    toast('✏️ เปลี่ยนชื่อแล้ว');
    await loadFolders(); await loadFiles();
  } else {
    errEl.textContent = d.error || 'เกิดข้อผิดพลาด';
    errEl.classList.remove('hidden');
  }
}

async function promptRenameFolder(folderPath, oldName) {
  const newName = prompt(`เปลี่ยนชื่อ folder "${oldName}" เป็น:`, oldName);
  if (!newName || newName===oldName) return;
  const d = await apiFetch('/api/folders', {method:'PATCH', body:{from:folderPath, to:newName}});
  if (d.ok) {
    if (currentFolder===folderPath || currentFolder.startsWith(folderPath+'/')) {
      currentFolder = d.folder;
      localStorage.setItem('fv-folder', currentFolder);
      updateBreadcrumb();
    }
    toast('✏️ เปลี่ยนชื่อแล้ว');
    await loadFolders(); await loadFiles();
  } else toast('⚠ '+d.error, true);
}

async function deleteFolder(folder, fileCount) {
  const msg = fileCount>0
    ? `ลบ folder "${folder}" และไฟล์ทั้งหมด ${fileCount} ไฟล์ในนั้น?\n⚠ ไม่สามารถกู้คืนได้!`
    : `ลบ folder "${folder}" ?`;
  if (!confirm(msg)) return;
  const d = await apiFetch('/api/folders?name='+encodeURIComponent(folder), {method:'DELETE'});
  if (d.ok) {
    if (currentFolder===folder||currentFolder.startsWith(folder+'/')) { currentFolder=''; localStorage.setItem('fv-folder',''); updateBreadcrumb(); }
    toast('🗑 ลบ folder แล้ว'); await loadFolders(); await loadFiles();
  } else toast('⚠ '+d.error, true);
}

// ── Drag file to folder ──
async function handleDropToFolder(e, targetFolder) {
  const data = e.dataTransfer.getData('text/fv-file');
  if (!data) return;
  try {
    const { name, folder } = JSON.parse(data);
    if (folder === targetFolder) return;
    const d = await apiFetch('/api/move', {method:'POST', body:{name, fromFolder:folder, toFolder:targetFolder}});
    if (d.ok) { toast(`↔ ย้าย "${name}" → ${targetFolder||'root'}`); await loadFiles(); await loadFolders(); }
    else toast('⚠ '+d.error, true);
  } catch {}
}

// ══════════════════════════════════════════════
// LOAD FILES
// ══════════════════════════════════════════════
async function loadFiles() {
  try {
    const qs = currentFolder ? '?folder='+encodeURIComponent(currentFolder) : '';
    const d  = await apiFetch('/api/files'+qs);
    if (d.locked) {
      // folder locked and pin not provided — show lock prompt
      allFiles = [];
      updateCounts();
      renderFiles([]);
      requireUnlock(currentFolder, () => loadFiles());
      return;
    }
    if (d.ok) {
      allFiles = (d.files||[]).filter(f=>!f.isDir);
      const subDirs = (d.files||[]).filter(f=>f.isDir);
      allFiles.filter(f=>getFileCat(f.name)==='zip').forEach(f=>{
        if (!zipStore[f.name]) zipStore[f.name]={name:f.name,size:f.size,fileCount:'?',files:[],created:f.modified};
      });
      updateCounts();
      renderFiles(subDirs);
    }
  } catch(e) { console.error('loadFiles:', e); }
}

// ── Global search ──
async function doGlobalSearch(q) {
  if (!q) { searchGlobal=false; await loadFiles(); return; }
  try {
    const d = await apiFetch('/api/search?q='+encodeURIComponent(q));
    if (d.ok) {
      searchGlobal = true;
      allFiles = d.files||[];
      updateCounts();
      renderFiles([]);
    }
  } catch(e) { console.error('search:', e); }
}

function updateCounts() {
  const c={all:0,image:0,code:0,doc:0,zip:0,other:0};
  allFiles.forEach(f=>{ const cat=getFileCat(f.name); c[cat]=(c[cat]||0)+1; c.all++; });
  Object.keys(c).forEach(cat=>{ const el=document.getElementById('cnt-'+cat); if(el) el.textContent=c[cat]; });
}

// ══════════════════════════════════════════════
// FILTER / SORT
// ══════════════════════════════════════════════
function setCategory(btn, cat) {
  document.querySelectorAll('.cat-tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active'); currentCat=cat; renderFiles();
}

function applyFilters() { renderFiles(); }

function toggleFilterPanel() {
  const panel = document.getElementById('filter-panel');
  const btn = document.getElementById('filter-btn');
  const isHidden = panel.classList.toggle('hidden');
  btn.classList.toggle('active', !isHidden);
}

function clearFilters() {
  document.getElementById('filter-size').value = '';
  document.getElementById('filter-date').value = '';
  document.getElementById('search-inp').value = '';
  filterSize = ''; filterDate = '';
  document.getElementById('filter-btn').classList.remove('active');
  renderFiles();
}

function getFilteredFiles() {
  const q = (document.getElementById('search-inp')?.value||'').toLowerCase();
  const fSize = document.getElementById('filter-size')?.value || '';
  const fDate = document.getElementById('filter-date')?.value || '';

  let files = currentCat==='all' ? allFiles : allFiles.filter(f=>getFileCat(f.name)===currentCat);
  if (q) files = files.filter(f=>f.name.toLowerCase().includes(q));

  // Size filter
  if (fSize) {
    files = files.filter(f => {
      const s = f.size || 0;
      if (fSize==='tiny')   return s < 102400;
      if (fSize==='small')  return s >= 102400 && s < 1048576;
      if (fSize==='medium') return s >= 1048576 && s < 52428800;
      if (fSize==='large')  return s >= 52428800;
      return true;
    });
  }

  // Date filter
  if (fDate) {
    const now = Date.now();
    files = files.filter(f => {
      const mod = f.modified || 0;
      if (fDate==='today') return now - mod < 86400000;
      if (fDate==='week')  return now - mod < 604800000;
      if (fDate==='month') return now - mod < 2592000000;
      if (fDate==='year')  return now - mod < 31536000000;
      return true;
    });
  }

  return [...files].sort((a,b)=>{
    let cmp = 0;
    if (currentSort==='name') cmp = a.name.localeCompare(b.name,'th');
    else if (currentSort==='date') cmp = (b.modified||0) - (a.modified||0);
    else if (currentSort==='size') cmp = (b.size||0) - (a.size||0);
    return cmp * sortDir;
  });
}

function updateSortDirIndicators() {
  ['name','date','size'].forEach(k => {
    const el = document.getElementById('sort-dir-'+k);
    if (!el) return;
    if (k === currentSort) el.textContent = sortDir === 1 ? '↑' : '↓';
    else el.textContent = '';
  });
}

function setSort(key, btn) {
  if (currentSort === key) {
    sortDir = sortDir * -1; // toggle direction
  } else {
    currentSort = key;
    // default direction: name=asc, date=desc (newest first), size=desc (biggest first)
    sortDir = (key === 'name') ? 1 : -1;
  }
  document.querySelectorAll('.sort-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  updateSortDirIndicators();
  renderFiles();
}

// ══════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════
function renderFiles(subDirs = []) {
  const grid = document.getElementById('file-grid');
  if (!grid) return;
  const files = getFilteredFiles();
  const label = document.getElementById('file-count-label');
  if (label) {
    let txt = `${files.length} ไฟล์`;
    if (subDirs.length) txt += ` · ${subDirs.length} folder`;
    if (searchGlobal) txt += ' (ค้นทุก folder)';
    label.textContent = txt;
  }

  grid.innerHTML = '';
  grid.className = 'file-grid'+(viewMode==='list'?' list-view':'');

  // Sub-folder cards
  if (subDirs.length && currentCat==='all' && !searchGlobal) {
    const hdr = document.createElement('div');
    hdr.className='cat-section-header'; hdr.style.gridColumn='1/-1';
    hdr.innerHTML=`<span>📂</span><span style="color:var(--t2)">Folders</span><span style="color:var(--t4);font-weight:400">(${subDirs.length})</span><div class="cat-section-header-line"></div>`;
    grid.appendChild(hdr);
    subDirs.forEach(d=>grid.appendChild(makeFolderCard(d)));
  }

  if (!files.length && !subDirs.length) {
    grid.innerHTML=`<div class="empty-state"><div class="empty-icon">${currentCat==='all'?'☁':getCatInfo(currentCat).icon}</div><div class="empty-text">${searchGlobal?'ไม่พบไฟล์จากการค้นหา':'ไม่พบไฟล์'}</div><div class="empty-sub">${searchGlobal?'ลองคำค้นอื่น':'ลากไฟล์มาวางหรือกด อัปโหลด'}</div></div>`;
    return;
  }
  if (!files.length) return;

  if (currentCat==='all'&&viewMode==='grid') renderGrouped(grid, files);
  else if (currentCat==='image'&&viewMode==='grid') renderGallery(grid, files);
  else if (currentCat==='code'&&viewMode==='grid') renderCodeList(grid, files);
  else if (currentCat==='zip'&&viewMode==='grid') renderZipList(grid, files);
  else files.forEach(f=>grid.appendChild(makeCard(f)));
}

function makeFolderCard(dir) {
  const card = document.createElement('div');
  card.className='file-card folder-card';
  const folderPath = currentFolder ? currentFolder+'/'+dir.name : dir.name;
  const icons={photos:'🖼️',images:'🖼️',photo:'🖼️',files:'📁',docs:'📄',documents:'📄',videos:'🎥',music:'🎵',backup:'💾',code:'💻'};
  const icon = icons[dir.name.toLowerCase()]||'📂';
  const badge = dir.fileCount>0 ? `<span class="folder-card-badge">${dir.fileCount} ไฟล์</span>` : '';
  card.innerHTML=`<div class="file-card-ico folder-ico">${icon}</div><div class="file-card-name">${esc(dir.name)}</div>${badge}<div class="file-card-meta">${dir.dirSize?hSize(dir.dirSize):''}</div><button class="card-del-btn" onclick="event.stopPropagation();deleteFolder('${escA(folderPath)}',${dir.fileCount||0})" title="ลบ folder">🗑</button>`;
  card.onclick = () => navigateFolder(folderPath);
  // drag-over
  card.addEventListener('dragover', e=>{e.preventDefault();card.classList.add('drag-over');});
  card.addEventListener('dragleave', ()=>card.classList.remove('drag-over'));
  card.addEventListener('drop', e=>{e.preventDefault();card.classList.remove('drag-over');handleDropToFolder(e,folderPath);});
  return card;
}

function renderGrouped(grid, files) {
  const groups={}, order=['image','code','doc','zip','other'];
  files.forEach(f=>{ const cat=getFileCat(f.name); if(!groups[cat]) groups[cat]=[]; groups[cat].push(f); });
  order.forEach(cat=>{
    if(!groups[cat]?.length) return;
    const info=getCatInfo(cat);
    const hdr=document.createElement('div');
    hdr.className='cat-section-header'; hdr.style.gridColumn='1/-1';
    hdr.innerHTML=`<span>${info.icon}</span><span style="color:${info.color}">${info.label}</span><span style="color:var(--t4);font-weight:400">(${groups[cat].length})</span><div class="cat-section-header-line"></div>`;
    grid.appendChild(hdr);
    groups[cat].forEach(f=>grid.appendChild(makeCard(f)));
  });
}

function renderGallery(grid, files) {
  grid.className='gallery-view';
  lbFiles = files.filter(f=>isRealImage(f.name));
  files.forEach(f=>{
    const item=document.createElement('div');
    item.className='gallery-item';
    if (isRealImage(f.name) && previewMode) {
      item.innerHTML=`<img src="${API}/api/download/${encodeURIComponent(f.name)}${folderQs(f.folder)}" alt="${esc(f.name)}" loading="lazy"/><div class="gallery-item-overlay"><span class="gallery-item-name">${esc(f.name)}</span></div>`;
      item.onclick=()=>openLightbox(f.name, files.filter(x=>isRealImage(x.name)));
    } else {
      item.innerHTML=`<div class="gallery-item-icon">${fIcon(f.name)}</div><div class="gallery-item-overlay"><span class="gallery-item-name">${esc(f.name)}</span></div>`;
      item.onclick=()=>openFileByName(f.name, f.folder);
    }
    makeDraggable(item, f);
    grid.appendChild(item);
  });
}

function renderCodeList(grid, files) {
  files.forEach(f=>{
    const item=document.createElement('div');
    item.className='code-card';
    item.innerHTML=`<div class="code-card-head"><span class="code-lang-badge">${getLang(f.name)}</span><span class="code-card-name">${esc(f.name)}</span><span class="code-card-meta">${hSize(f.size)}</span></div><div class="code-card-actions"><button class="fc-btn dl" onclick="event.stopPropagation();dlFile(null,'${escA(f.name)}',${JSON.stringify(f.folder||currentFolder)})">⬇</button><button class="fc-btn del" onclick="event.stopPropagation();delFile(null,'${escA(f.name)}',${JSON.stringify(f.folder||currentFolder)})">🗑</button></div>`;
    item.onclick=()=>openFileByName(f.name, f.folder);
    makeDraggable(item, f);
    grid.appendChild(item);
  });
}

function renderZipList(grid, files) {
  files.forEach(f=>{
    const z=zipStore[f.name]||{};
    const item=document.createElement('div');
    item.className='zip-card';
    item.innerHTML=`<div class="zc-head"><span class="zc-ico">🗜️</span><div class="zc-info"><div class="zc-name">${esc(f.name)}</div><div class="zc-meta">${z.fileCount||'?'} ไฟล์ · ${hSize(f.size)}</div></div></div><div class="zc-actions"><button class="fc-btn dl" onclick="event.stopPropagation();dlFile(null,'${escA(f.name)}',${JSON.stringify(f.folder||currentFolder)})">⬇</button><button class="fc-btn del" onclick="event.stopPropagation();delFile(null,'${escA(f.name)}',${JSON.stringify(f.folder||currentFolder)})">🗑</button></div>`;
    item.onclick=()=>openZipModal(f.name);
    makeDraggable(item, f);
    grid.appendChild(item);
  });
}

function makeCard(f) {
  const card=document.createElement('div');
  card.className='file-card';
  const cat=getFileCat(f.name), info=getCatInfo(cat);
  const thumb = (isRealImage(f.name) && previewMode)
    ? `<img class="fc-img-thumb" src="${API}/api/download/${encodeURIComponent(f.name)}${folderQs(f.folder||currentFolder)}" loading="lazy" alt="${esc(f.name)}"/>`
    : `<div class="fc-ico" style="color:${info.color}">${fIcon(f.name)}</div>`;
  const folderTag = searchGlobal && f.folder ? `<div class="fc-folder-tag">📂 ${esc(f.folder)}</div>` : '';
  card.innerHTML=`${thumb}<div class="fc-name">${esc(f.name)}</div>${folderTag}<div class="fc-meta">${hSize(f.size)}</div><div class="fc-actions"><button class="fc-btn" onclick="event.stopPropagation();openMoveModal('${escA(f.name)}','${escA(f.folder||currentFolder)}')">↔</button><button class="fc-btn" onclick="event.stopPropagation();dlFile(null,'${escA(f.name)}',${JSON.stringify(f.folder||currentFolder)})">⬇</button><button class="fc-btn del" onclick="event.stopPropagation();delFile(null,'${escA(f.name)}',${JSON.stringify(f.folder||currentFolder)})">🗑</button></div>`;
  card.onclick=()=>openFileByName(f.name, f.folder||currentFolder);
  makeDraggable(card, f);
  return card;
}

// Make a card draggable (for moving to folder)
function makeDraggable(el, f) {
  el.draggable = true;
  el.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/fv-file', JSON.stringify({name:f.name, folder:f.folder!==undefined?f.folder:currentFolder}));
    e.dataTransfer.effectAllowed = 'move';
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
}

// ══════════════════════════════════════════════
// MOVE MODAL
// ══════════════════════════════════════════════
function openMoveModal(name, folder) {
  moveTarget = { name, folder };
  const modal  = document.getElementById('move-modal');
  const title  = document.getElementById('move-fname');
  const select = document.getElementById('move-folder-select');
  if (!modal||!title||!select) return;
  title.textContent = name;
  select.innerHTML = `<option value="">📁 root</option>`;
  allFolders.forEach(f => {
    const opt=document.createElement('option');
    opt.value=f.path; opt.textContent='📂 '+f.path;
    if (f.path===folder) opt.disabled=true;
    select.appendChild(opt);
  });
  modal.classList.remove('hidden');
}
function closeMoveModal() {
  document.getElementById('move-modal')?.classList.add('hidden');
  moveTarget=null;
}
async function confirmMove(copy=false) {
  if (!moveTarget) return;
  const select = document.getElementById('move-folder-select');
  const toFolder = select?.value||'';
  if (toFolder === moveTarget.folder) { toast('อยู่ใน folder เดิมอยู่แล้ว',true); return; }
  const d = await apiFetch('/api/move', {method:'POST', body:{name:moveTarget.name, fromFolder:moveTarget.folder, toFolder, copy}});
  if (d.ok) {
    toast(copy?`📋 copy "${moveTarget.name}"`:`↔ ย้าย "${moveTarget.name}"`);
    closeMoveModal(); await loadFiles(); await loadFolders();
  } else toast('⚠ '+d.error, true);
}

// ══════════════════════════════════════════════
// RENAME FILE (inline in editor modal)
// ══════════════════════════════════════════════
async function renameCurrentFile() {
  if (!currentFile) return;
  const newName = prompt(`เปลี่ยนชื่อ "${currentFile}" เป็น:`, currentFile);
  if (!newName||newName===currentFile) return;
  const d = await apiFetch('/api/rename', {method:'PATCH', body:{name:currentFile, newName, folder:currentFolder}});
  if (d.ok) {
    toast('✏️ เปลี่ยนชื่อเป็น: '+d.name);
    currentFile=d.name;
    document.getElementById('modal-fname').textContent=d.name;
    await loadFiles();
  } else toast('⚠ '+d.error, true);
}

// ══════════════════════════════════════════════
// VIEW / DARK
// ══════════════════════════════════════════════
function toggleView() { viewMode=viewMode==='grid'?'list':'grid'; localStorage.setItem('fv-view',viewMode); updateViewBtn(); renderFiles(); }
function updateViewBtn() { const b=document.getElementById('view-toggle-btn'); if(b) b.textContent=viewMode==='grid'?'☰':'⊞'; }
function toggleDark() {
  document.body.classList.toggle('dark');
  const isDark=document.body.classList.contains('dark');
  localStorage.setItem('fv-dark',isDark?'1':'0');
  const b=document.getElementById('dark-btn'); if(b) b.textContent=isDark?'☀️':'🌙';
}
function toggleSidebar() {
  sidebarCollapsed=!sidebarCollapsed;
  const wrap=document.querySelector('.folder-sidebar-wrap');
  if(wrap) wrap.classList.toggle('collapsed',sidebarCollapsed);
}

// ══════════════════════════════════════════════
// SEARCH
// ══════════════════════════════════════════════
let _searchTimer = null;
function onSearch() {
  const val=document.getElementById('search-inp')?.value||'';
  const clear=document.getElementById('search-clear');
  if(clear) clear.classList.toggle('hidden',!val);
  // debounce global search
  clearTimeout(_searchTimer);
  if (val.length>=2) {
    _searchTimer = setTimeout(()=>doGlobalSearch(val), 350);
  } else if (!val) {
    searchGlobal=false;
    renderFiles();
  } else {
    searchGlobal=false;
    renderFiles();
  }
}
function clearSearch() {
  const inp=document.getElementById('search-inp'); if(inp) inp.value='';
  document.getElementById('search-clear')?.classList.add('hidden');
  searchGlobal=false; loadFiles();
}

// ══════════════════════════════════════════════
// FILE OPERATIONS
// ══════════════════════════════════════════════
function triggerUpload() { document.getElementById('upload-input').click(); }

async function handleUpload(e) {
  const arr=Array.from(e.target?.files||e.files||[]);
  if(!arr.length) return;
  const qs=folderQs();
  const zips=arr.filter(f=>getFileCat(f.name)==='zip');
  const others=arr.filter(f=>getFileCat(f.name)!=='zip');
  if(zips.length) await handleZipUploadFiles(zips, qs);
  if(!others.length){if(e.target)e.target.value='';return;}
  startProg('upload',others.map(f=>f.name).join(', '),0);
  const fd=new FormData(); others.forEach(f=>fd.append('files',f));
  await new Promise(resolve=>{
    const xhr=new XMLHttpRequest(); xhr.open('POST',`${API}/api/upload${qs}`);
    xhr.upload.onprogress=ev=>{if(ev.lengthComputable)setProg(Math.round(ev.loaded/ev.total*100));};
    xhr.onload=async()=>{ setProg(100); try{const d=JSON.parse(xhr.responseText); if(d.ok){toast(`↑ อัปโหลด ${d.saved.length} ไฟล์`);await loadFiles();await loadFolders();}else toast('⚠ '+d.error,true);}catch{toast('⚠ อัปโหลดล้มเหลว',true);} setTimeout(hideProg,700);resolve(); };
    xhr.onerror=()=>{toast('⚠ อัปโหลดล้มเหลว',true);hideProg();resolve();};
    xhr.send(fd);
  });
  if(e.target)e.target.value='';
}

async function handleZipUploadFiles(zips, qs='') {
  startProg('upload',zips.map(f=>f.name).join(', '),0);
  const fd=new FormData(); zips.forEach(f=>fd.append('files',f));
  await new Promise(resolve=>{
    const xhr=new XMLHttpRequest(); xhr.open('POST',`${API}/api/upload${qs}`);
    xhr.upload.onprogress=ev=>{if(ev.lengthComputable)setProg(Math.round(ev.loaded/ev.total*70));};
    xhr.onload=async()=>{
      try{const d=JSON.parse(xhr.responseText); if(d.ok){
        for(const saved of d.saved){const file=zips.find(f=>f.name===saved.name)||zips[0];setProg(80,'กำลังอ่าน ZIP...');try{const ab=await file.arrayBuffer(),zip=await JSZip.loadAsync(ab),entries=[];zip.forEach((p,entry)=>entries.push(entry.dir?{name:p,folder:true}:{name:p,size:entry._data?.uncompressedSize||0}));zipStore[saved.name]={name:saved.name,size:saved.size,fileCount:entries.filter(x=>!x.folder).length,files:entries,created:Date.now()};}catch{zipStore[saved.name]={name:saved.name,size:saved.size,fileCount:'?',files:[],created:Date.now()};}}
        setProg(100);toast(`🗜 อัปโหลด ${d.saved.length} ZIP`);await loadFiles();
      }else toast('⚠ '+d.error,true);}catch{toast('⚠ ผิดพลาด',true);}
      setTimeout(hideProg,500);resolve();
    };
    xhr.onerror=()=>{hideProg();resolve();};
    xhr.send(fd);
  });
}

async function newFile() {
  const name=document.getElementById('new-filename').value.trim();
  if(!name){toast('กรุณากรอกชื่อไฟล์',true);return;}
  const qs=folderQs();
  const d=await apiFetch(`/api/files/${encodeURIComponent(name)}${qs}`,{method:'PUT',body:{content:''}});
  if(d.ok){document.getElementById('new-filename').value='';toast('✓ สร้างไฟล์: '+name);await loadFiles();openFileByName(name, currentFolder);}
  else toast('⚠ '+d.error,true);
}

// ── Preview helpers ──
function hideAllPreviews() {
  ['modal-preview','modal-preview-pdf','modal-preview-video','modal-preview-audio','modal-preview-none'].forEach(id=>{
    document.getElementById(id)?.classList.add('hidden');
  });
  document.getElementById('editor')?.classList.add('hidden');
  // stop media
  const vid=document.getElementById('preview-video'); if(vid){vid.pause();vid.src='';}
  const aud=document.getElementById('preview-audio'); if(aud){aud.pause();aud.src='';}
}

function switchModalTab(tab) {
  document.getElementById('btn-show-preview').classList.toggle('active', tab==='preview');
  document.getElementById('btn-show-editor').classList.toggle('active', tab==='editor');
  const savedType = document.getElementById('editor-modal').dataset.previewType;
  if (tab === 'preview') {
    document.getElementById('editor')?.classList.add('hidden');
    document.getElementById('modal-btn-save').classList.add('hidden');
    showPreviewPane(savedType, document.getElementById('editor-modal').dataset.fileUrl);
  } else {
    hideAllPreviews();
    document.getElementById('editor')?.classList.remove('hidden');
    document.getElementById('modal-btn-save').classList.remove('hidden');
  }
}

function showPreviewPane(type, url) {
  hideAllPreviews();
  if (type === 'image') {
    document.getElementById('preview-img').src = url;
    document.getElementById('modal-preview').classList.remove('hidden');
  } else if (type === 'pdf') {
    document.getElementById('preview-pdf').src = url;
    document.getElementById('modal-preview-pdf').classList.remove('hidden');
  } else if (type === 'video') {
    document.getElementById('preview-video').src = url;
    document.getElementById('modal-preview-video').classList.remove('hidden');
  } else if (type === 'audio') {
    document.getElementById('preview-audio').src = url;
    document.getElementById('modal-preview-audio').classList.remove('hidden');
  } else {
    document.getElementById('pnone-ico').textContent = fIcon(document.getElementById('editor-modal').dataset.fileName||'file');
    document.getElementById('modal-preview-none').classList.remove('hidden');
  }
}

async function openFileByName(name, folder) {
  const f = folder !== undefined ? folder : currentFolder;
  const cat=getFileCat(name), fileObj=allFiles.find(x=>x.name===name)||{};
  currentFile=name;
  document.getElementById('modal-ficon').textContent=fIcon(name);
  document.getElementById('modal-fname').textContent=name;
  document.getElementById('modal-fsize').textContent=fileObj.size?hSize(fileObj.size):'';
  document.getElementById('modal-fdate').textContent=fileObj.modified?new Date(fileObj.modified).toLocaleString('th-TH'):'';
  const catBadge=document.getElementById('modal-fcat'), info=getCatInfo(cat);
  catBadge.textContent=info.icon+' '+info.label; catBadge.className='modal-cat-badge '+cat;
  catBadge.style.background=info.color+'22'; catBadge.style.color=info.color;

  const ptype = getPreviewType(name);
  const fileUrl = `${API}/api/download/${encodeURIComponent(name)}${folderQs(f)}`;
  const modal = document.getElementById('editor-modal');
  modal.dataset.previewType = ptype;
  modal.dataset.fileUrl = fileUrl;
  modal.dataset.fileName = name;

  const canPreview = ptype !== 'none';
  const canEdit = ptype === 'text';
  const toggleBar = document.getElementById('preview-toggle-bar');
  const saveBtn = document.getElementById('modal-btn-save');

  hideAllPreviews();

  // ถ้า global preview ปิดอยู่ → editor โหมดเสมอ (ถ้าเปิดได้)
  if (!previewMode) {
    toggleBar.classList.add('hidden');
    saveBtn.classList.remove('hidden');
    document.getElementById('editor').classList.remove('hidden');
    try { const d=await apiFetch(`/api/files/${encodeURIComponent(name)}${folderQs(f)}`); document.getElementById('editor').value=d.content||''; }
    catch { document.getElementById('editor').value='ไม่สามารถโหลดไฟล์ได้'; }
  } else if (canPreview && !canEdit) {
    // รูป / pdf / video / audio — preview อย่างเดียว ไม่มี toggle
    toggleBar.classList.add('hidden');
    saveBtn.classList.add('hidden');
    document.getElementById('editor').classList.add('hidden');
    showPreviewPane(ptype, fileUrl);
  } else if (canPreview && canEdit) {
    // text files — มี toggle tabs
    toggleBar.classList.remove('hidden');
    document.getElementById('btn-show-preview').classList.add('active');
    document.getElementById('btn-show-editor').classList.remove('active');
    saveBtn.classList.add('hidden');
    showPreviewPane(ptype, fileUrl);
    // โหลด content ไว้รอในพื้นหลัง
    try { const d=await apiFetch(`/api/files/${encodeURIComponent(name)}${folderQs(f)}`); document.getElementById('editor').value=d.content||''; }
    catch { document.getElementById('editor').value=''; }
  } else {
    // ไม่รองรับ preview
    toggleBar.classList.add('hidden');
    saveBtn.classList.add('hidden');
    document.getElementById('modal-preview-none').classList.remove('hidden');
    document.getElementById('pnone-ico').textContent=fIcon(name);
  }

  document.getElementById('editor-modal').classList.remove('hidden');
}

function closeEditor() {
  document.getElementById('editor-modal').classList.add('hidden');
  hideAllPreviews();
  document.getElementById('preview-toggle-bar').classList.add('hidden');
  document.getElementById('modal-btn-save').classList.remove('hidden');
  currentFile=null;
}

async function saveFile() {
  if(!currentFile) return;
  const content=document.getElementById('editor').value, qs=folderQs();
  const d=await apiFetch(`/api/files/${encodeURIComponent(currentFile)}${qs}`,{method:'PUT',body:{content}});
  if(d.ok){toast('💾 บันทึกแล้ว');await loadFiles();}else toast('⚠ '+d.error,true);
}

function downloadCurrent(){if(currentFile)dlFile(null,currentFile,currentFolder);}

function dlFile(e,name,folder){
  if(e)e.stopPropagation();
  startProg('download',name,0);
  const f=folder!==undefined?folder:currentFolder, qs=folderQs(f);
  const a=document.createElement('a'); a.href=`${API}/api/download/${encodeURIComponent(name)}${qs}`; a.download=name; a.click();
  let p=0; const iv=setInterval(()=>{p=Math.min(p+10,95);setProg(p);if(p>=95){clearInterval(iv);setTimeout(()=>{setProg(100);hideProg();},400);}},150);
  toast('⬇ '+name);
}

async function deleteFile(){
  if(!currentFile) return;
  if(!confirm(`ลบ "${currentFile}" ?`)) return;
  const qs=folderQs();
  const d=await apiFetch(`/api/delete/${encodeURIComponent(currentFile)}${qs}`,{method:'DELETE'});
  if(d.ok){toast('🗑 ลบ: '+currentFile);closeEditor();await loadFiles();await loadFolders();}
  else toast('⚠ '+d.error,true);
}

async function delFile(e,name,folder){
  if(e)e.stopPropagation();
  if(!confirm(`ลบ "${name}" ?`)) return;
  const f=folder!==undefined?folder:currentFolder, qs=folderQs(f);
  const d=await apiFetch(`/api/delete/${encodeURIComponent(name)}${qs}`,{method:'DELETE'});
  if(d.ok){toast('🗑 ลบ: '+name);await loadFiles();await loadFolders();}
  else toast('⚠ '+d.error,true);
}

async function downloadAll(){
  if(!allFiles.length){toast('ยังไม่มีไฟล์',true);return;}
  startProg('download','กำลังเตรียม...',5);
  const zip=new JSZip(), qs=folderQs(); let done=0;
  for(const f of allFiles){
    const r=await fetch(`${API}/api/download/${encodeURIComponent(f.name)}${folderQs(f.folder||currentFolder)}`);
    const prefix = f.folder ? f.folder+'/' : '';
    zip.file(prefix+f.name,await r.blob()); done++;
    setProg(Math.round((done/allFiles.length)*80),f.name);
  }
  setProg(90,'กำลัง compress...');
  const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=`files_${new Date().toISOString().slice(0,10)}.zip`; a.click();
  setProg(100); setTimeout(hideProg,500); toast('⬇ ดาวน์โหลดทั้งหมดแล้ว');
}

// ══════════════════════════════════════════════
// ZIP MODAL
// ══════════════════════════════════════════════
function openZipModal(name){
  modalZipName=name;
  const z=zipStore[name]||{};
  document.getElementById('zm-name').textContent=name;
  const body=document.getElementById('zm-body'); body.innerHTML='';
  if(!z.files?.length){body.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3);font-size:0.8rem">ไม่พบรายการ</div>';}
  else{
    const entries=z.files.filter(f=>!f.folder), grouped={};
    entries.forEach(f=>{const cat=getFileCat(f.name.split('/').pop()); if(!grouped[cat]) grouped[cat]=[]; grouped[cat].push(f);});
    ['image','code','doc','zip','other'].forEach(cat=>{
      if(!grouped[cat]?.length) return;
      const info=getCatInfo(cat), hdr=document.createElement('div'); hdr.className='zm-cat-row';
      hdr.innerHTML=`<span>${info.icon}</span><span style="color:${info.color}">${info.label}</span><span style="color:var(--t4)">(${grouped[cat].length})</span>`;body.appendChild(hdr);
      grouped[cat].forEach(f=>{const row=document.createElement('div');row.className='zm-file-row';row.innerHTML=`<span class="zm-file-ico">${fIcon(f.name.split('/').pop())}</span><span class="zm-file-name">${esc(f.name)}</span>${f.size?`<span class="zm-file-size">${hSize(f.size)}</span>`:''}`; body.appendChild(row);});
    });
  }
  const fc=z.files?z.files.filter(f=>!f.folder).length:'?';
  document.getElementById('zm-stats').textContent=`${fc} ไฟล์ · ${hSize(z.size||0)}`;
  document.getElementById('zip-modal').classList.remove('hidden');
}
function closeZipModal(){document.getElementById('zip-modal').classList.add('hidden');modalZipName=null;}
function dlModalZip(){if(modalZipName)dlFile(null,modalZipName,currentFolder);}

// ══════════════════════════════════════════════
// LIGHTBOX
// ══════════════════════════════════════════════
function openLightbox(name,imgList){lbFiles=imgList||[];lbIndex=lbFiles.findIndex(f=>f.name===name);if(lbIndex<0)lbIndex=0;lbShow();}
function lbShow(){
  const f=lbFiles[lbIndex]; if(!f) return;
  const lb=document.getElementById('lightbox'), img=document.getElementById('lightbox-img');
  img.style.opacity='0'; img.onload=()=>{img.style.opacity='1';};
  img.src=`${API}/api/download/${encodeURIComponent(f.name)}${folderQs(f.folder||currentFolder)}`;
  document.getElementById('lb-name').textContent=f.name;
  document.getElementById('lb-size').textContent=hSize(f.size);
  document.getElementById('lb-counter').textContent=lbFiles.length>1?`${lbIndex+1} / ${lbFiles.length}`:'';
  document.getElementById('lb-prev').style.display=lbFiles.length>1?'flex':'none';
  document.getElementById('lb-next').style.display=lbFiles.length>1?'flex':'none';
  lb.classList.add('open'); document.body.style.overflow='hidden';
}
function lbNav(dir){lbIndex=(lbIndex+dir+lbFiles.length)%lbFiles.length;lbShow();}
function closeLightbox(){document.getElementById('lightbox').classList.remove('open');document.body.style.overflow='';}
function lbDownload(){const f=lbFiles[lbIndex];if(f)dlFile(null,f.name,f.folder||currentFolder);}
async function lbDelete(){
  const f=lbFiles[lbIndex]; if(!f||!confirm(`ลบ "${f.name}" ?`)) return;
  const qs=folderQs(f.folder||currentFolder);
  const d=await apiFetch(`/api/delete/${encodeURIComponent(f.name)}${qs}`,{method:'DELETE'});
  if(d.ok){toast('🗑 ลบ: '+f.name);lbFiles.splice(lbIndex,1);if(!lbFiles.length){closeLightbox();await loadFiles();return;}lbIndex=Math.min(lbIndex,lbFiles.length-1);lbShow();await loadFiles();}
  else toast('⚠ '+d.error,true);
}

// ══════════════════════════════════════════════
// DRAG & DROP (to upload area)
// ══════════════════════════════════════════════
function setupDragDrop(){
  document.addEventListener('dragover',e=>{
    // Update drop label
    const lbl=document.getElementById('drop-folder-label');
    if(lbl) lbl.textContent=currentFolder||'root';
    if(!e.dataTransfer.types.includes('text/fv-file')) { e.preventDefault(); document.getElementById('drop-ov').classList.remove('hidden'); }
  });
  document.addEventListener('dragleave',e=>{if(!e.relatedTarget)document.getElementById('drop-ov').classList.add('hidden');});
  document.addEventListener('drop',e=>{
    e.preventDefault(); document.getElementById('drop-ov').classList.add('hidden');
    if(e.dataTransfer.types.includes('text/fv-file')) return; // handled by folder target
    handleUpload({files:Array.from(e.dataTransfer.files)});
  });
}

// ══════════════════════════════════════════════
// KEYBOARD
// ══════════════════════════════════════════════
function setupKeyboard(){
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();if(currentFile)saveFile();}
    if(e.key==='Escape'){closeEditor();closeZipModal();closeLightbox();closeMoveModal();}
    if(e.key==='ArrowLeft'&&document.getElementById('lightbox').classList.contains('open'))lbNav(-1);
    if(e.key==='ArrowRight'&&document.getElementById('lightbox').classList.contains('open'))lbNav(1);
  });
  let tsX=0;
  document.getElementById('lightbox').addEventListener('touchstart',e=>{tsX=e.touches[0].clientX;},{passive:true});
  document.getElementById('lightbox').addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-tsX;if(Math.abs(dx)>50)lbNav(dx<0?1:-1);});
}

// ══════════════════════════════════════════════
// PROGRESS / TOAST / API
// ══════════════════════════════════════════════
let _phide=null;
function startProg(type,filename,pct){
  const bar=document.getElementById('prog-bar'); bar.className='prog-bar'+(type==='download'?' dl':'');
  document.getElementById('prog-ico').textContent=type==='download'?'↓':'↑';
  document.getElementById('prog-ttl').textContent=type==='download'?'กำลังดาวน์โหลด...':'กำลังอัปโหลด...';
  document.getElementById('prog-fname').textContent=filename; bar.style.width=pct+'%';
  document.getElementById('prog-pct').textContent=pct+'%';
  document.getElementById('prog-ov').classList.remove('hidden'); clearTimeout(_phide);
}
function setProg(pct,filename){
  document.getElementById('prog-bar').style.width=pct+'%';
  document.getElementById('prog-pct').textContent=pct+'%';
  if(filename)document.getElementById('prog-fname').textContent=filename;
}
function hideProg(){_phide=setTimeout(()=>document.getElementById('prog-ov').classList.add('hidden'),200);}

let _tt;
function toast(msg,err=false){
  document.getElementById('toast-txt').textContent=msg;
  document.getElementById('toast-ico').className='toast-ico '+(err?'err':'ok');
  const el=document.getElementById('toast'); el.classList.remove('hidden'); clearTimeout(_tt);
  _tt=setTimeout(()=>el.classList.add('hidden'),2800);
}

async function apiFetch(url,opts={}){
  const folderParam = new URLSearchParams(url.split('?')[1]||'').get('folder') || opts.body?.folder || '';
  const pin = folderParam ? (unlockedFolders[folderParam]||'') : '';
  const options={method:opts.method||'GET',headers:{
    ...(opts.body?{'Content-Type':'application/json'}:{}),
    ...(pin?{'X-Folder-Pin':pin}:{})
  }};
  if(opts.body) options.body=JSON.stringify(opts.body);
  const r=await fetch(API+url,options); return r.json();
}

// ── Folder Lock System ──

async function loadLocks() {
  try { const d=await fetch('/api/lock'); const j=await d.json(); if(j.ok) {
    lockedFoldersList=j.locks||[];
    // ข้อ 4: ถ้า folder ที่อยู่ปัจจุบันถูก lock และไม่มี pin → ไล่ออกทันที
    if (currentFolder && isFolderLocked(currentFolder) && !isFolderUnlocked(currentFolder)) {
      toast('🔒 folder นี้ถูกล็อคแล้ว', true);
      currentFolder = '';
      localStorage.setItem('fv-folder', '');
      updateBreadcrumb();
      renderFolderSidebar();
      await loadFiles();
    }
  }} catch{}
}

function isFolderLocked(folder) { return lockedFoldersList.some(l=>l.folder===folder); }
function isFolderUnlocked(folder) { return !!unlockedFolders[folder]; }

function requireUnlock(folder, onSuccess) {
  if (!isFolderLocked(folder) || isFolderUnlocked(folder)) { onSuccess(); return; }
  lockModalCallback = onSuccess;
  document.getElementById('lock-folder-name').textContent = '📂 '+folder;
  document.getElementById('lock-pin-input').value = '';
  document.getElementById('lock-error').classList.add('hidden');
  const lock = lockedFoldersList.find(l=>l.folder===folder);
  const hint = document.getElementById('lock-hint');
  if (lock?.hint) { hint.textContent = '💡 Hint: '+lock.hint; hint.classList.remove('hidden'); }
  else hint.classList.add('hidden');
  document.getElementById('lock-modal').classList.remove('hidden');
  setTimeout(()=>{ const inp=document.getElementById('lock-pin-input'); if(inp){inp.focus();inp.value='';} }, 100);
}

async function submitLockPin() {
  const folder = document.getElementById('lock-folder-name').textContent.replace('📂 ','');
  const pin = document.getElementById('lock-pin-input').value;
  const errEl = document.getElementById('lock-error');
  errEl.classList.add('hidden');
  const d = await fetch('/api/lock/verify', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({folder, pin})}).then(r=>r.json());
  if (d.ok && d.unlocked) {
    unlockedFolders[folder] = pin;
    closeLockModal();
    toast('🔓 ปลดล็อคแล้ว');
    if (lockModalCallback) { lockModalCallback(); lockModalCallback=null; }
  } else {
    errEl.classList.remove('hidden');
    document.getElementById('lock-pin-input').value='';
    document.getElementById('lock-pin-input').focus();
  }
}

function closeLockModal() {
  document.getElementById('lock-modal').classList.add('hidden');
  lockModalCallback = null;
}

function togglePinEye() {
  const inp = document.getElementById('lock-pin-input');
  const btn = document.getElementById('pin-eye-btn');
  inp.type = inp.type==='password' ? 'text' : 'password';
  btn.textContent = inp.type==='password' ? '👁' : '🙈';
}

async function openLockSettings(folder) {
  lockSettingsTarget = folder;
  const isLocked = isFolderLocked(folder);
  const folderShort = folder.split('/').pop();

  document.getElementById('lset-icon').textContent = isLocked ? '🔐' : '🔒';
  document.getElementById('lset-title').textContent = isLocked ? 'จัดการรหัส' : 'ตั้งรหัส Folder';
  document.getElementById('lset-folder-name').textContent = '📂 ' + folder;

  // Reset to clean state
  document.getElementById('lset-set').classList.toggle('hidden', isLocked);
  document.getElementById('lset-remove').classList.toggle('hidden', !isLocked);
  document.getElementById('lset-confirm-btn').classList.toggle('hidden', isLocked);
  document.getElementById('lset-remove-btn').classList.toggle('hidden', !isLocked);
  document.getElementById('lset-remove-btn').textContent = 'ถอดล็อค';
  document.getElementById('lset-remove-btn').onclick = openRemoveLock;
  document.getElementById('lset-error').classList.add('hidden');
  document.getElementById('lset-pin').value = '';
  document.getElementById('lset-hint').value = '';
  document.getElementById('lset-old-pin').value = '';

  document.getElementById('lock-settings-modal').classList.remove('hidden');
  setTimeout(() => {
    const inp = isLocked
      ? document.getElementById('lset-old-pin')
      : document.getElementById('lset-pin');
    inp?.focus();
  }, 80);
}

async function confirmLockSettings() {
  const folder = lockSettingsTarget;
  const pin = document.getElementById('lset-pin').value;
  const hint = document.getElementById('lset-hint').value;
  const errEl = document.getElementById('lset-error');
  errEl.classList.add('hidden');
  if (!pin || pin.length < 4) { errEl.textContent='รหัสต้องมีอย่างน้อย 4 ตัว'; errEl.classList.remove('hidden'); return; }
  const d = await fetch('/api/lock', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({folder, pin, hint})}).then(r=>r.json());
  if (d.ok) {
    unlockedFolders[folder] = pin; // ยังให้ access อยู่เพราะเพิ่ง set pin เอง
    await loadLocks();
    renderFolderSidebar();
    closeLockSettings();
    toast('🔒 ล็อค folder "' + folder.split('/').pop() + '" แล้ว');
    if (currentFolder === folder) await loadFiles();
  } else { errEl.textContent=d.error||'เกิดข้อผิดพลาด'; errEl.classList.remove('hidden'); }
}

function openRemoveLock() {
  document.getElementById('lset-set').classList.add('hidden');
  document.getElementById('lset-remove').classList.remove('hidden');
  document.getElementById('lset-confirm-btn').classList.add('hidden');
  document.getElementById('lset-remove-btn').textContent='✅ ยืนยันถอดล็อค';
  document.getElementById('lset-remove-btn').onclick = confirmRemoveLock;
}

async function confirmRemoveLock() {
  const folder = lockSettingsTarget;
  const pin = document.getElementById('lset-old-pin').value;
  const errEl = document.getElementById('lset-error');
  errEl.classList.add('hidden');
  const d = await fetch('/api/lock', {method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({folder, pin})}).then(r=>r.json());
  if (d.ok) {
    // ลบ pin ออกจาก session cache
    delete unlockedFolders[folder];
    await loadLocks();
    renderFolderSidebar();
    closeLockSettings();
    toast('🔓 ถอดล็อค folder "' + folder.split('/').pop() + '" แล้ว');
    if (currentFolder === folder) await loadFiles();
  } else { errEl.textContent=d.error||'รหัสไม่ถูกต้อง'; errEl.classList.remove('hidden'); }
}

function closeLockSettings() {
  document.getElementById('lock-settings-modal').classList.add('hidden');
  // reset to set-lock view
  document.getElementById('lset-set').classList.remove('hidden');
  document.getElementById('lset-remove').classList.add('hidden');
  document.getElementById('lset-confirm-btn').classList.remove('hidden');
  document.getElementById('lset-remove-btn').classList.add('hidden');
  document.getElementById('lset-error').classList.add('hidden');
  lockSettingsTarget = null;
}
