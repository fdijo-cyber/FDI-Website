import { editorialConfig } from './editorial-config.js';

async function showMedia() {
  if (!editorialConfig.url || !editorialConfig.publishableKey) return;
  const endpoint = new URL('/rest/v1/editorial_media', editorialConfig.url);
  endpoint.search = new URLSearchParams({ select: 'title,kind,url', order: 'published_at.desc' });
  const response = await fetch(endpoint, { headers: { apikey: editorialConfig.publishableKey } });
  if (!response.ok) return;
  const list = document.getElementById('media-items');
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
    if (youtubeId && /^[\w-]{11}$/.test(youtubeId)) {
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
  if (list.childElementCount) document.getElementById('public-media').hidden = false;
}

showMedia().catch(error => console.error('Could not load public media', error));
