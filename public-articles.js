import { editorialConfig } from './editorial-config.js';

const headers = { apikey: editorialConfig.publishableKey };
const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

async function fetchArticles(params) {
  const url = new URL('/rest/v1/rpc/editorial_public_articles', editorialConfig.url);
  url.search = new URLSearchParams(params);
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error('The article feed could not load.');
  return response.json();
}

async function loadCover(image, path) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(new URL('/storage/v1/object/sign/editorial-covers/' + encoded, editorialConfig.url), {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 3600 }),
  });
  if (!response.ok) return;
  const { signedURL } = await response.json();
  if (typeof signedURL === 'string' && signedURL.startsWith('/object/sign/editorial-covers/')) {
    image.src = new URL('/storage/v1' + signedURL, editorialConfig.url).href;
    image.hidden = false;
  }
}

function coverImage(path) {
  const image = document.createElement('img');
  image.alt = '';
  image.loading = 'lazy';
  image.hidden = true;
  if (path) void loadCover(image, path).catch(() => {});
  return image;
}

function renderCards(rows, container, emptyText) {
  const cards = rows.map(entry => {
    const card = document.createElement('article');
    const link = document.createElement('a');
    const frame = document.createElement('div');
    const image = coverImage(entry.cover_path);
    const title = document.createElement('h3');
    const byline = document.createElement('p');
    const excerpt = document.createElement('p');
    card.className = 'story publication-card';
    frame.className = 'publication-image';
    link.href = `article.html?id=${encodeURIComponent(entry.id)}`;
    byline.className = 'byline';
    byline.textContent = date.format(new Date(entry.created_at));
    title.textContent = entry.title;
    excerpt.textContent = entry.body;
    frame.append(image);
    link.append(frame, title);
    card.append(link, byline, excerpt);
    return card;
  });
  container.replaceChildren(...cards);
  if (!cards.length) container.textContent = emptyText;
}

async function start() {
  const detail = document.getElementById('published-article');
  if (detail) {
    const article_id = new URLSearchParams(location.search).get('id');
    if (!article_id || !/^[0-9a-f-]{36}$/i.test(article_id)) {
      detail.textContent = 'Article not found.';
      return;
    }
    const [entry] = await fetchArticles({ article_id });
    if (!entry) { detail.textContent = 'Article not found.'; return; }
    document.title = entry.title + ' | Future Doctor Initiative';
    const title = document.createElement('h1');
    const byline = document.createElement('p');
    const body = document.createElement('div');
    title.textContent = entry.title;
    byline.className = 'byline';
    byline.textContent = date.format(new Date(entry.created_at));
    body.className = 'publication-body';
    body.textContent = entry.body;
    detail.replaceChildren(title, byline, coverImage(entry.cover_path), body);
    return;
  }

  const container = document.getElementById('publication-feed');
  if (!container) return;
  const search = document.getElementById('publication-search');
  if (!search) {
    const rows = await fetchArticles({
      select: 'id,title,body,cover_path,created_at,home_position',
      or: '(home_position.is.null,home_position.gt.0)',
      order: 'home_position.asc.nullslast,created_at.desc,id', limit: 6,
    });
    renderCards(rows, container, 'No articles have been published yet.');
    return;
  }
  const rows = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchArticles({ limit: pageSize, offset, order: 'created_at.desc,id' });
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  function renderSearch() {
    const query = search.value.trim().toLowerCase();
    const visible = rows.filter(entry => `${entry.title} ${entry.body}`.toLowerCase().includes(query));
    renderCards(visible, container, query ? 'No articles match your search.' : 'No articles have been published yet.');
  }
  search.addEventListener('input', renderSearch);
  renderSearch();
}

start().catch(error => {
  const container = document.getElementById('published-article') || document.getElementById('publication-feed');
  if (container) container.textContent = error.message;
});
