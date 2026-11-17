export function safeSource(value) {
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch {
    return null;
  }
  return null;
}

export function sourceLines(text) {
  return (text ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

export function articleText(container, text, sourceCount = 0) {
  const fragment = document.createDocumentFragment();
  let end = 0;
  for (const match of (text ?? '').matchAll(/\[([^\]\n]+)\]\(([^\s)]+)\)|\[(\d+)\]/g)) {
    const index = Number(match[3]);
    const href = match[3] ? (index > 0 && index <= sourceCount ? `#article-source-${index}` : null) : safeSource(match[2]);
    if (!href) continue;
    fragment.append(text.slice(end, match.index));
    const link = document.createElement('a');
    link.href = href;
    link.textContent = match[3] ? match[0] : match[1];
    if (match[3]) link.setAttribute('aria-label', `Source ${index}`);
    fragment.append(link);
    end = match.index + match[0].length;
  }
  fragment.append((text ?? '').slice(end));
  container.replaceChildren(fragment);
}

export function renderBibliography(section, sources) {
  section.replaceChildren();
  section.hidden = sources.length === 0;
  if (!sources.length) return;
  const heading = document.createElement('h2');
  const list = document.createElement('ol');
  heading.textContent = 'Bibliography';
  sources.forEach((source, index) => {
    const item = document.createElement('li');
    item.id = `article-source-${index + 1}`;
    const [label, url] = source.includes(' | ') ? source.split(/ \| (.*)/s) : [source, source];
    const href = safeSource(url?.trim());
    if (href) {
      const link = document.createElement('a');
      link.href = href;
      link.textContent = label;
      item.append(link);
    } else {
      item.textContent = source;
    }
    list.append(item);
  });
  section.append(heading, list);
}

export function renderCredits(container, article) {
  const credits = [];
  for (const [label, value] of [['By', article.byline_name], ['Edited by', article.editor_names]]) {
    if (!value) continue;
    const name = document.createElement('strong');
    name.textContent = value;
    if (credits.length) credits.push(' · ');
    credits.push(label + ' ', name);
  }
  container.replaceChildren(...credits);
  container.hidden = !credits.length;
}
