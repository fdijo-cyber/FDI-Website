import { editorialConfig } from './editorial-config.js';

async function showMedia() {
  if (!editorialConfig.url || !editorialConfig.publishableKey) return;
  const endpoint = new URL('/rest/v1/editorial_media', editorialConfig.url);
  endpoint.search = new URLSearchParams({ select: 'title,kind,url', order: 'published_at.desc' });
  const list = document.getElementById('media-items');
  if (!list) return;
  if (list.hasAttribute('data-homepage')) {
    endpoint.searchParams.set('or', '(home_position.is.null,home_position.gt.0)');
    endpoint.searchParams.set('order', 'home_position.asc.nullslast,published_at.desc,id');
    endpoint.searchParams.set('limit', '3');
  }
  const response = await fetch(endpoint, { headers: { apikey: editorialConfig.publishableKey } });
  if (!response.ok) throw new Error('The media feed could not load.');
  list.replaceChildren();
  for (const entry of await response.json()) {
    let url;
    try { url = new URL(entry.url); } catch { continue; }
    if (url.protocol !== 'https:' || url.username || url.password) continue;
    const card = document.createElement('article');
    const title = document.createElement('h3');
    const link = document.createElement('a');
    card.className = 'story';
    title.textContent = entry.title;
    link.href = url.href;
    link.textContent = entry.kind === 'video' ? 'Watch video' : 'Listen to podcast';
    const youtubeId = url.hostname === 'youtu.be' ? url.pathname.slice(1)
      : ['www.youtube.com', 'youtube.com'].includes(url.hostname) ? url.searchParams.get('v') : null;
    const uploaded = url.origin === new URL(editorialConfig.url).origin
      && url.pathname.startsWith('/storage/v1/object/public/editorial-media/');
    if (uploaded) {
      const player = document.createElement(entry.kind === 'video' ? 'video' : 'audio');
      player.controls = true;
      player.preload = 'metadata';
      player.src = url.href;
      player.setAttribute('aria-label', entry.title);
      player.style.width = '100%';
      if (entry.kind === 'video') player.className = 'video-player';
      card.append(player);
    } else if (youtubeId && /^[\w-]{11}$/.test(youtubeId)) {
      const video = document.createElement('iframe');
      video.className = 'video-player';
      video.title = entry.title;
      video.loading = 'lazy';
      video.allowFullscreen = true;
      video.src = `https://www.youtube-nocookie.com/embed/${youtubeId}`;
      card.append(video);
    }
    card.append(title, link);
    list.append(card);
  }
  if (!list.childElementCount) list.textContent = 'No media has been published yet.';
}

showMedia().catch(error => { document.getElementById('media-items').textContent = error.message; });
