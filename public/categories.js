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
const IMAGE_EXTS = ['png','jpg','jpeg','gif','webp'];

// ── State ──
let currentCat    = 'all';
let currentSort   = 'name';
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

// ── Init ──
window.addEventListener('load', () => {
  if (localStorage.getItem('fv-dark')==='1') { document.body.classList.add('dark'); const b=document.getElementById('dark-btn'); if(b) b.textContent='☀️'; }
  if (localStorage.getItem('fv-view')) { viewMode=localStorage.getItem('fv-view'); updateViewBtn(); }
  // restore last folder
  const saved = localStorage.getItem('fv-folder');
  if (saved !== null) currentFolder = saved;
  loadFolders();
  loadFiles();
  setupDragDrop();
  setupKeyboard();
  updateBreadcrumb();
});

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

  const folderIcons = { photos:'🖼️',images:'🖼️',photo:'🖼️',files:'📁',docs:'📄',documents:'📄',videos:'🎥',music:'🎵',backup:'💾',code:'💻',downloads:'📥',archive:'📦' };

  const mkItem = (label, icon, folder, active, badge) => {
    const div = document.createElement('div');
    div.className = 'folder-item' + (active?' active':'');
    div.setAttribute('data-folder', folder);
    div.innerHTML = `<span class="folder-ico">${icon}</span><span class="folder-lbl">${esc(label)}</span>${badge?`<span class="folder-badge">${badge}</span>`:''}`;
    div.onclick = () => navigateFolder(folder);
    // drag-over highlight
    div.addEventListener('dragover', e => { e.preventDefault(); div.classList.add('drag-over'); });
    div.addEventListener('dragleave', () => div.classList.remove('drag-over'));
    div.addEventListener('drop', e => { e.preventDefault(); div.classList.remove('drag-over'); handleDropToFolder(e, folder); });
    return div;
  };

  // Root
  sb.appendChild(mkItem('ทั้งหมด','🏠','', currentFolder==='', null));

  // Folders tree
  allFolders.forEach(f => {
    const depth = f.path.split('/').length - 1;
    const icon  = folderIcons[f.name.toLowerCase()]||'📂';
    const item  = mkItem(f.name, icon, f.path, currentFolder===f.path, f.fileCount||null);
    item.style.paddingLeft = (12 + depth*14) + 'px';

    // Rename button
    const renBtn = document.createElement('button');
    renBtn.className = 'folder-action-btn'; renBtn.title = 'เปลี่ยนชื่อ'; renBtn.textContent = '✏️';
    renBtn.onclick = e => { e.stopPropagation(); promptRenameFolder(f.path, f.name); };
    item.appendChild(renBtn);

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'folder-action-btn del'; delBtn.title = 'ลบ folder'; delBtn.textContent = '🗑';
    delBtn.onclick = e => { e.stopPropagation(); deleteFolder(f.path, f.fileCount); };
    item.appendChild(delBtn);

    sb.appendChild(item);
  });

  // Add folder input row
  const addDiv = document.createElement('div');
  addDiv.className = 'folder-add-row';
  addDiv.innerHTML = `<input class="folder-add-inp" id="new-folder-inp" placeholder="folder ใหม่..." onkeydown="if(event.key==='Enter')createFolder()"/><button class="folder-add-btn" onclick="createFolder()" title="สร้าง folder">+</button>`;
  sb.appendChild(addDiv);
}

async function navigateFolder(folder) {
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
function getFilteredFiles() {
  const q=(document.getElementById('search-inp')?.value||'').toLowerCase();
  let files = currentCat==='all' ? allFiles : allFiles.filter(f=>getFileCat(f.name)===currentCat);
  if (q) files = files.filter(f=>f.name.toLowerCase().includes(q));
  return [...files].sort((a,b)=>{
    if (currentSort==='name') return a.name.localeCompare(b.name,'th');
    if (currentSort==='date') return new Date(b.modified)-new Date(a.modified);
    if (currentSort==='size') return b.size-a.size;
    return 0;
  });
}
function setSort(key, btn) {
  document.querySelectorAll('.sort-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); currentSort=key; renderFiles();
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
    if (isRealImage(f.name)) {
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
  const thumb = isRealImage(f.name)
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
  if(isRealImage(name)){
    document.getElementById('editor').classList.add('hidden');
    document.getElementById('modal-preview').classList.remove('hidden');
    document.getElementById('preview-img').src=`${API}/api/download/${encodeURIComponent(name)}${folderQs(f)}`;
  } else {
    document.getElementById('modal-preview').classList.add('hidden');
    document.getElementById('editor').classList.remove('hidden');
    try{const d=await apiFetch(`/api/files/${encodeURIComponent(name)}${folderQs(f)}`);document.getElementById('editor').value=d.content||'';}
    catch{document.getElementById('editor').value='';}
  }
  document.getElementById('editor-modal').classList.remove('hidden');
}

function closeEditor() { document.getElementById('editor-modal').classList.add('hidden'); currentFile=null; }

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
  const options={method:opts.method||'GET',headers:{...(opts.body?{'Content-Type':'application/json'}:{})}};
  if(opts.body) options.body=JSON.stringify(opts.body);
  const r=await fetch(API+url,options); return r.json();
}
