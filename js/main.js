'use strict';

const $ = (selector) => document.querySelector(selector);
const state = { notes: [], current: null, mode: null, query: '', expanded: new Map(), stopTracking: null };
const collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' });

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function readFile(path) {
  const response = await fetch(new URL(path, document.baseURI));
  if (!response.ok) throw new Error(`無法載入 ${path}（${response.status}）`);
  return response.text();
}

function renderCourses() {
  const nav = $('#courses');
  nav.replaceChildren();
  const courses = [...new Set(state.notes.map((note) => note.course))];
  const query = state.query.trim().toLocaleLowerCase();
  let matches = 0;
  for (const course of courses) {
    const notes = state.notes.filter((note) => note.course === course &&
      (!query || `${note.title}\n${note.markdown}`.toLocaleLowerCase().includes(query)))
      .sort((a, b) => collator.compare(a.title, b.title));
    if (!notes.length) continue;
    matches += notes.length;
    const group = element('div', 'course');
    const toggle = element('button', 'course-button');
    toggle.type = 'button';
    toggle.append(element('span', 'course-icon', '▱'), element('span', 'course-name', course),
      element('span', 'course-count', String(notes.length)), element('span', 'chevron', '⌄'));
    const list = element('ul', 'note-list');
    list.id = `course-${courses.indexOf(course)}`;
    const expanded = Boolean(query) || state.expanded.get(course) !== false;
    toggle.setAttribute('aria-controls', list.id);
    toggle.setAttribute('aria-expanded', String(expanded));
    list.hidden = !expanded;
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      state.expanded.set(course, open);
      list.hidden = !open;
    });
    for (const note of notes) {
      const item = element('li');
      const link = element('a', 'note-link', note.title);
      link.href = `#${note.id}`;
      if (state.current?.id === note.id) link.setAttribute('aria-current', 'page');
      link.addEventListener('click', () => {
        setMenu(false);
        if (state.current?.id === note.id) window.scrollTo({ top: 0 });
        if (matchMedia('(max-width: 700px)').matches) $('#reader').focus({ preventScroll: true });
      });
      item.append(link);
      list.append(item);
    }
    group.append(toggle, list);
    nav.append(group);
  }
  if (query && !matches) nav.append(element('p', 'empty-state', '沒有找到符合的筆記，試試其他關鍵字。'));
  $('#search-status').textContent = query ? `找到 ${matches} 篇筆記` : '';
}

function renderHome() {
  state.stopTracking?.();
  state.stopTracking = null;
  state.current = null;
  state.mode = 'home';
  document.title = '個人筆記整理網站';
  $('#home').hidden = false;
  $('#reading-column').hidden = true;
  $('.toc-panel').hidden = true;
  $('#toc').replaceChildren();
  $('#reader').classList.add('home-mode');
  $('#breadcrumb-separator').hidden = true;
  $('#breadcrumb-course').hidden = true;
  $('#home-link').setAttribute('aria-current', 'page');
  const courses = [...new Set(state.notes.map((note) => note.course))];
  $('#home-course-count').textContent = courses.length;
  $('#home-note-count').textContent = state.notes.length;
  renderCourses();
}

function returnHome(event) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (location.hash) history.pushState(null, '', `${location.pathname}${location.search}`);
  setMenu(false);
  navigate();
  $('#reader').focus({ preventScroll: true });
}

function safeURL(value, image = false) {
  try {
    const url = new URL(value, document.baseURI);
    return ['http:', 'https:'].includes(url.protocol) || (!image && url.protocol === 'mailto:');
  } catch { return false; }
}

function markdownFragment(markdown) {
  const template = document.createElement('template');
  template.innerHTML = marked.parse(markdown, { gfm: true, breaks: false });
  // Notes are content, never executable instructions or HTML. Keep only reading elements.
  const allowed = new Set('P H1 H2 H3 H4 H5 H6 UL OL LI BLOCKQUOTE PRE CODE STRONG EM DEL A IMG TABLE THEAD TBODY TR TH TD HR BR INPUT'.split(' '));
  for (const node of [...template.content.querySelectorAll('*')]) {
    if (!allowed.has(node.tagName)) { node.replaceWith(document.createTextNode(node.textContent)); continue; }
    for (const attribute of [...node.attributes]) {
      const name = attribute.name;
      const permitted = (node.tagName === 'A' && name === 'href' && safeURL(attribute.value)) ||
        (node.tagName === 'IMG' && name === 'src' && safeURL(attribute.value, true)) ||
        (['IMG', 'A'].includes(node.tagName) && ['alt', 'title'].includes(name)) ||
        (node.tagName === 'OL' && name === 'start' && /^\d+$/.test(attribute.value));
      if (!permitted) node.removeAttribute(name);
    }
    if (node.tagName === 'INPUT') { node.type = 'checkbox'; node.disabled = true; }
    if (node.tagName === 'IMG') { node.loading = 'lazy'; node.decoding = 'async'; }
    if (node.tagName === 'A') node.rel = 'noopener noreferrer';
  }
  template.content.querySelector('h1')?.remove();
  for (const table of template.content.querySelectorAll('table')) {
    const wrapper = element('div', 'table-scroll');
    table.replaceWith(wrapper);
    wrapper.append(table);
    wrapper.tabIndex = 0;
    wrapper.setAttribute('aria-label', '可水平捲動的表格');
  }
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const pending = [];
  while (walker.nextNode()) {
    if (walker.currentNode.textContent.includes('[待補充]')) pending.push(walker.currentNode);
  }
  for (const node of pending) {
    const fragment = document.createDocumentFragment();
    node.textContent.split('[待補充]').forEach((part, index) => {
      if (index) fragment.append(element('span', 'pending', '[待補充]'));
      fragment.append(document.createTextNode(part));
    });
    node.replaceWith(fragment);
  }
  return template.content;
}

function renderNote(note) {
  state.stopTracking?.();
  state.stopTracking = null;
  state.current = note;
  state.mode = 'note';
  $('#home').hidden = true;
  $('#reading-column').hidden = false;
  $('.toc-panel').hidden = false;
  $('#reader').classList.remove('home-mode');
  $('#breadcrumb-separator').hidden = false;
  $('#breadcrumb-course').hidden = false;
  $('#home-link').removeAttribute('aria-current');
  document.title = `${note.title} · ${note.course}｜個人筆記整理網站`;
  $('#breadcrumb-course').textContent = note.course;
  const article = $('#note');
  article.replaceChildren();
  const meta = element('div', 'note-meta');
  meta.append(element('span', '', note.course));
  article.append(meta, element('h1', '', note.title), element('div', 'note-rule'));
  const body = element('div', 'note-body');
  if (note.error) {
    const error = element('p', 'empty-state', '這篇筆記暫時無法載入，請重新整理頁面再試。');
    error.setAttribute('role', 'alert');
    body.append(error);
  } else body.append(markdownFragment(note.markdown));
  article.append(body, element('div', 'note-end', '· · ·'));
  article.setAttribute('aria-busy', 'false');
  const toc = $('#toc');
  toc.replaceChildren();
  const headings = [...body.querySelectorAll('h2, h3')]
    .filter((heading) => !heading.closest('li, blockquote, pre'));
  headings.forEach((heading, index) => {
    heading.id = `${note.id}--section-${index + 1}`;
    const link = element('a', heading.tagName === 'H3' ? 'subsection' : '');
    link.href = `#${heading.id}`;
    link.title = heading.textContent;
    link.append(element('span', 'toc-label', heading.textContent));
    toc.append(link);
  });
  if (!headings.length) toc.append(element('p', 'empty-state', '本篇暫無章節目錄'));
  if (headings.length) {
    const links = [...toc.querySelectorAll('a')];
    const activate = (id) => links.forEach((link) => {
      if (link.hash === `#${id}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    activate(headings[0].id);
    let frame = null;
    const updateChapter = () => {
      frame = null;
      // Keep the preceding heading active while reading its paragraphs, including
      // when scrolling upward or jumping directly past several short sections.
      let current = headings[0];
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top > 80) break;
        current = heading;
      }
      activate(current.id);
    };
    const scheduleUpdate = () => {
      if (frame === null) frame = requestAnimationFrame(updateChapter);
    };
    addEventListener('scroll', scheduleUpdate, { passive: true });
    addEventListener('resize', scheduleUpdate);
    state.stopTracking = () => {
      removeEventListener('scroll', scheduleUpdate);
      removeEventListener('resize', scheduleUpdate);
      if (frame !== null) cancelAnimationFrame(frame);
    };
    scheduleUpdate();
  }
  renderCourses();
}

function navigate() {
  const hash = location.hash.slice(1);
  if (hash === 'reader') {
    if (state.mode === null) renderHome();
    return;
  }
  const id = hash.split('--')[0];
  const note = state.notes.find((item) => item.id === id);
  if (!note) {
    if (state.mode !== 'home') renderHome();
    window.scrollTo({ top: 0 });
    return;
  }
  const changed = state.current?.id !== note.id;
  if (changed) renderNote(note);
  requestAnimationFrame(() => {
    const target = hash.includes('--') ? document.getElementById(hash) : null;
    if (target) target.scrollIntoView({ behavior: 'instant', block: 'start' });
    else if (changed) window.scrollTo({ top: 0 });
  });
}

function setMenu(open) {
  $('#sidebar').classList.toggle('open', open);
  $('#menu-toggle').setAttribute('aria-expanded', String(open));
  $('#menu-toggle').setAttribute('aria-label', open ? '關閉課程側邊欄' : '開啟課程側邊欄');
  $('#backdrop').hidden = !open;
  document.body.classList.toggle('menu-open', open);
  // Keep the off-screen mobile navigation out of keyboard focus order.
  $('#sidebar').inert = matchMedia('(max-width: 700px)').matches && !open;
  if (open) $('#search').focus();
}

$('#search').addEventListener('input', (event) => { state.query = event.target.value; renderCourses(); });
$('.brand').addEventListener('click', returnHome);
$('#home-link').addEventListener('click', returnHome);
$('#menu-toggle').addEventListener('click', () => setMenu(!$('#sidebar').classList.contains('open')));
$('#backdrop').addEventListener('click', () => { setMenu(false); $('#menu-toggle').focus(); });
$('#toc-toggle').addEventListener('click', () => {
  const expanded = $('#toc-toggle').getAttribute('aria-expanded') !== 'true';
  $('#toc-toggle').setAttribute('aria-expanded', String(expanded));
  $('#toc').hidden = !expanded;
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && $('#sidebar').classList.contains('open')) { setMenu(false); $('#menu-toggle').focus(); }
  if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    if (matchMedia('(max-width: 700px)').matches) setMenu(true);
    $('#search').focus();
  }
  if (event.key === 'Tab' && $('#sidebar').classList.contains('open')) {
    const focusable = [...$('#sidebar').querySelectorAll('a,button,input')].filter((node) => node.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
addEventListener('hashchange', navigate);
addEventListener('popstate', navigate);
const compact = matchMedia('(max-width: 950px)');
function setCompactTOC() {
  $('#toc-toggle').setAttribute('aria-expanded', String(!compact.matches));
  $('#toc').hidden = compact.matches;
}
compact.addEventListener('change', setCompactTOC);
matchMedia('(max-width: 700px)').addEventListener('change', () => setMenu(false));
setCompactTOC();
setMenu(false);

(async function init() {
  try {
    const index = JSON.parse(await readFile('notes/index.json'));
    state.notes = await Promise.all(index.map(async (note) => {
      try { return { ...note, markdown: await readFile(note.path) }; }
      catch { return { ...note, markdown: '', error: true }; }
    }));
    $('#course-count').textContent = new Set(state.notes.map((note) => note.course)).size;
    $('#collection-count').textContent = `${new Set(state.notes.map((note) => note.course)).size} 門課程 · ${state.notes.length} 篇筆記`;
    // Refresh data if the user returned home while the initial files loaded.
    if (state.mode === 'home') state.mode = null;
    navigate();
  } catch (error) {
    $('#note').replaceChildren(element('h1', '', '暫時無法開啟筆記'), element('p', 'empty-state', '請確認網站已透過本機伺服器或 GitHub Pages 開啟，再重新整理頁面。'));
    $('#note').setAttribute('aria-busy', 'false');
    $('#collection-count').textContent = '筆記載入失敗';
    console.error(error);
  }
})();
