import { editorialConfig } from './editorial-config.js';

const field = id => document.getElementById(id);
const notice = message => { field('notice').textContent = message; };
const credentials = field('credentials');
const articleForm = field('article-form');
const inviteForm = field('invite-form');
const dashboardUrl = new URL(location.pathname, location.origin);
const inviteParams = new URLSearchParams(location.hash.slice(1));
const roles = { super_admin: 'Super admin', editor: 'Editor', writer: 'Writer' };
let client;
let member;
let editingId;
let registration = false;
let articleRows = [];
let sessionVersion = 0;

const statusLabels = { draft: 'Draft', submitted: 'In review', approved: 'Approved' };
const statusButtons = [...document.querySelectorAll('[data-status]')];
const dateFormat = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' });
let statusFilter = '';

function openComposer(article) {
  editArticle(article);
  showPanel('writer-panel');
  articleForm.elements.title.focus();
}

for (const id of ['compose', 'overview-compose']) {
  field(id).addEventListener('click', () => openComposer());
}
field('view-articles').addEventListener('click', () => showPanel('editorial-panel'));
field('article-search').addEventListener('input', renderArticles);
for (const button of statusButtons) {
  button.addEventListener('click', () => {
    statusFilter = button.dataset.status;
    renderArticles();
  });
}
field('preview-article').addEventListener('click', () => {
  field('preview-title').textContent = articleForm.elements.title.value.trim() || 'Untitled article';
  field('preview-body').textContent = articleForm.elements.body.value;
  field('article-preview').showModal();
});

const panels = [...document.querySelectorAll('[data-panel]')];
function showPanel(id) {
  for (const button of panels) {
    field(button.dataset.panel).hidden = button.dataset.panel !== id || button.hidden;
    button.setAttribute('aria-pressed', String(button.dataset.panel === id));
  }
}

for (const button of panels) {
  button.addEventListener('click', () => run(button, async () => {
    showPanel(button.dataset.panel);
    if (button.dataset.panel === 'media-panel') await loadMedia();
    if (button.dataset.panel === 'homepage-panel') await loadHomepage();
    if (button.dataset.panel === 'invitations') await loadTeam();
  }));
}

async function loadTeam() {
  const { data, error } = await client.from('editorial_members').select('email,role').order('email');
  if (error) throw error;
  field('team-access').replaceChildren(...data.map(person => {
    const item = document.createElement('li');
    item.textContent = `${person.email} · ${roles[person.role]}`;
    return item;
  }));
}

const mediaForm = field('media-form');
const reviewForm = field('review-form');
const reviewDialog = field('review-dialog');
let reviewingArticle;
const coverTypes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const mediaTypes = {
  video: { 'video/mp4': 'mp4', 'video/webm': 'webm' },
  podcast: { 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg' },
};

async function uploadFile(bucket, file, types, maxSize) {
  const extension = types[file.type];
  if (!extension || file.size > maxSize) throw new Error('Choose a supported file within the size limit.');
  const path = `${member.id}/${crypto.randomUUID()}.${extension}`;
  const { error } = await client.storage.from(bucket).upload(path, file, { contentType: file.type });
  if (error) throw error;
  return path;
}

function syncMediaSource() {
  const upload = mediaForm.elements.source.value === 'file';
  field('media-link-label').hidden = upload;
  field('media-file-label').hidden = !upload;
  mediaForm.elements.url.disabled = upload;
  mediaForm.elements.file.disabled = !upload;
  mediaForm.elements.file.required = upload;
  mediaForm.elements.file.accept = Object.keys(mediaTypes[mediaForm.elements.kind.value]).join(',');
}

mediaForm.elements.source.addEventListener('change', syncMediaSource);
mediaForm.elements.kind.addEventListener('change', syncMediaSource);
syncMediaSource();

async function renderReviewComments(articleId) {
  const { data, error } = await client.from('editorial_comments').select('author_role,body,created_at')
    .eq('article_id', articleId).order('created_at');
  if (error) throw error;
  const list = field('review-comments');
  list.replaceChildren(...data.map(comment => {
    const row = document.createElement('article');
    const detail = document.createElement('strong');
    const body = document.createElement('p');
    row.className = 'desk-article';
    detail.textContent = `${roles[comment.author_role]} · ${dateFormat.format(new Date(comment.created_at))}`;
    body.textContent = comment.body;
    row.append(detail, body);
    return row;
  }));
  if (!data.length) list.textContent = 'No feedback yet.';
}

async function openReview(article) {
  reviewingArticle = article;
  field('review-title').textContent = article.title;
  field('review-body').textContent = article.body;
  field('review-comments').replaceChildren();
  field('review-notice').textContent = '';
  const cover = field('review-cover');
  cover.hidden = true;
  cover.removeAttribute('src');
  reviewForm.reset();
  reviewForm.hidden = member.role === 'writer';
  for (const button of reviewForm.querySelectorAll('button')) {
    button.hidden = button.value !== 'comment' && article.status !== 'submitted';
  }
  reviewDialog.showModal();
  try {
    await renderReviewComments(article.id);
    if (article.cover_path) {
      const { data, error } = await client.storage.from('editorial-covers').createSignedUrl(article.cover_path, 120);
      if (error) throw error;
      cover.src = data.signedUrl;
      cover.hidden = false;
    }
  } catch (error) {
    field('review-notice').textContent = error.message;
  }
}

reviewForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  const article = reviewingArticle;
  const decision = button.value;
  const message = field('review-notice');
  const body = reviewForm.elements.body.value.trim();
  if (!body && decision !== 'approved') {
    message.textContent = 'Enter feedback before continuing.';
    return;
  }
  const buttons = [...reviewForm.querySelectorAll('button')];
  buttons.forEach(control => { control.disabled = true; });
  try {
    if (body) {
      const { error } = await client.from('editorial_comments').insert({
        article_id: article.id, author_role: member.role, body,
      });
      if (error) throw error;
      reviewForm.reset();
      await renderReviewComments(article.id);
    }
    if (decision !== 'comment') {
      await updateStatus(article, decision);
      reviewDialog.close();
      notice(decision === 'approved' ? 'Article approved for the public newsletter.' : 'Returned to the writer with feedback.');
    } else {
      message.textContent = 'Comment posted.';
    }
  } catch (error) {
    message.textContent = error.message;
  } finally {
    buttons.forEach(control => { control.disabled = false; });
  }
});

async function loadHomepage() {
  const results = await Promise.all([
    client.from('editorial_articles').select('id,title,home_position').eq('status', 'approved').order('created_at', { ascending: false }),
    client.from('editorial_media').select('id,title,home_position').order('published_at', { ascending: false }),
  ]);
  for (const [index, table] of ['editorial_articles', 'editorial_media'].entries()) {
    const container = field(index === 0 ? 'home-articles' : 'home-media');
    const { data, error } = results[index];
    container.replaceChildren();
    if (error) {
      container.textContent = 'Homepage settings require publication.sql in Supabase.';
      continue;
    }
    if (!data.length) container.textContent = 'Nothing published yet.';
    for (const item of data) {
      const form = document.createElement('form');
      const label = document.createElement('label');
      const input = document.createElement('input');
      const button = document.createElement('button');
      form.className = 'desk-article';
      input.type = 'number';
      input.min = '0';
      input.max = '99';
      input.value = item.home_position ?? '';
      input.placeholder = 'Automatic';
      label.textContent = item.title;
      label.append(input);
      button.textContent = 'Save position';
      form.append(label, button);
      form.addEventListener('submit', event => {
        event.preventDefault();
        void run(button, async () => {
          const home_position = input.value === '' ? null : input.valueAsNumber;
          const { data: saved, error } = await client.from(table).update({ home_position }).eq('id', item.id).select('id');
          if (error) throw error;
          if (!saved.length) throw new Error('The item is no longer available.');
          notice('Homepage position saved.');
        });
      });
      container.append(form);
    }
  }
}

async function loadMedia() {
  const { data, error } = await client.from('editorial_media').select('id,title,kind')
    .order('published_at', { ascending: false });
  if (error) throw new Error('Media publishing needs the media-and-access.sql migration in Supabase.');
  field('published-media').replaceChildren(...data.map(item => {
    const row = document.createElement('article');
    const title = document.createElement('h3');
    row.className = 'desk-article';
    title.textContent = item.title;
    const kind = document.createElement('p');
    kind.textContent = item.kind === 'video' ? 'Video' : 'Podcast';
    row.append(title, kind, action('Unpublish', async () => {
      if (!window.confirm(`Remove “${item.title}” from the public Media page?`)) return;
      const { data, error } = await client.from('editorial_media').delete().eq('id', item.id).select('id,storage_path');
      if (error) throw error;
      if (!data.length) throw new Error('This item is no longer available.');
      if (data[0].storage_path) {
        const removal = await client.storage.from('editorial-media').remove([data[0].storage_path]);
        if (removal.error) notice('Removed from the page, but the uploaded file could not be deleted.');
      }
      await loadMedia();
    }));
    return row;
  }));
  if (!data.length) field('published-media').textContent = 'No media published yet.';
}

field('media-form').addEventListener('submit', event => {
  event.preventDefault();
  void run(event.submitter, async () => {
    const form = event.target;
    const values = new FormData(form);
    const kind = values.get('kind');
    const payload = { title: values.get('title').trim(), kind };
    if (!payload.title) throw new Error('Enter a title.');
    if (values.get('source') === 'file') {
      notice('Uploading media…');
      payload.storage_path = await uploadFile('editorial-media', values.get('file'), mediaTypes[kind], 50 * 1024 * 1024);
      payload.url = client.storage.from('editorial-media').getPublicUrl(payload.storage_path).data.publicUrl;
    } else {
      const url = new URL(values.get('url'));
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Enter a public HTTPS link.');
      payload.url = url.href;
    }
    const { error } = await client.from('editorial_media').insert(payload);
    if (error) {
      if (payload.storage_path && error.code) await client.storage.from('editorial-media').remove([payload.storage_path]);
      throw error;
    }
    form.reset();
    syncMediaSource();
    await loadMedia();
    notice('Published to the public Media page.');
  });
});

function showRegistration(enabled) {
  registration = enabled;
  field('code-label').hidden = !enabled;
  field('code').disabled = !enabled;
  field('code').required = enabled;
  credentials.elements.password.autocomplete = enabled ? 'new-password' : 'current-password';
  credentials.elements.password.minLength = enabled ? 12 : 0;
  field('account-heading').textContent = enabled ? 'Create your team account' : 'Team sign-in';
  field('auth-action').textContent = enabled ? 'Create account' : 'Sign in';
  field('switch-auth').textContent = enabled ? 'Back to sign-in' : 'I have an invitation';
}

function editArticle(article) {
  editingId = article?.id;
  articleForm.elements.cover.value = '';
  field('cover-status').textContent = article?.cover_path ? 'Cover photo attached' : 'JPG, PNG, or WebP, up to 5 MB.';
  field('save-submit').hidden = Boolean(article && (article.status !== 'draft' || article.author_id !== member?.id));
  articleForm.elements.title.value = article?.title ?? '';
  articleForm.elements.body.value = article?.body ?? '';
  field('draft-heading').textContent = article ? 'Edit article' : 'New article';
  field('new-article').hidden = !article;
}

function action(label, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.textContent = label;
  button.addEventListener('click', () => run(button, handler));
  return button;
}

async function run(button, handler) {
  button.disabled = true;
  notice('');
  try {
    await handler();
  } catch (error) {
    notice(error.message || 'Something went wrong. Try again.');
  } finally {
    button.disabled = false;
  }
}

async function updateStatus(article, status) {
  const { data, error } = await client.from('editorial_articles').update({ status })
    .eq('id', article.id).eq('status', article.status).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('This article changed. Refresh the dashboard and try again.');
  if (editingId === article.id) editArticle();
  await listArticles();
}

async function listArticles() {
  const version = sessionVersion;
  const { data, error } = await client.from('editorial_articles').select()
    .order('created_at', { ascending: false });
  if (version !== sessionVersion || !member) return;
  if (error) throw error;
  articleRows = data;
  renderArticles();
}

function renderArticles() {
  if (!member) return;
  const search = field('article-search').value.trim().toLowerCase();
  const counts = { draft: 0, submitted: 0, approved: 0 };
  for (const article of articleRows) counts[article.status]++;
  for (const [status, count] of Object.entries(counts)) field(`count-${status}`).textContent = count;
  for (const button of statusButtons) {
    const { status } = button.dataset;
    button.setAttribute('aria-pressed', String(status === statusFilter));
    button.querySelector('span').textContent = status ? counts[status] : articleRows.length;
  }
  const recent = field('recent-articles');
  recent.replaceChildren(...articleRows.slice(0, 5).map(article => {
    const row = document.createElement('div');
    const title = document.createElement('strong');
    const meta = document.createElement('span');
    row.className = 'recent-row';
    title.textContent = article.title;
    meta.textContent = `${statusLabels[article.status]} · ${dateFormat.format(new Date(article.created_at))}`;
    row.append(title, meta);
    return row;
  }));
  if (!articleRows.length) recent.textContent = 'New articles will appear here.';
  const visible = articleRows.filter(article => (!statusFilter || article.status === statusFilter)
    && article.title.toLowerCase().includes(search));
  const list = field('articles');
  list.replaceChildren();
  if (!visible.length) list.textContent = articleRows.length ? 'No articles match your filters.' : 'No articles yet. Start with New article.';
  const canReview = member.role !== 'writer';
  for (const article of visible) {
    const card = document.createElement('article');
    const title = document.createElement('h3');
    const details = document.createElement('div');
    const excerpt = document.createElement('p');
    const meta = document.createElement('div');
    const date = document.createElement('time');
    const status = document.createElement('span');
    const actions = document.createElement('div');
    card.className = 'desk-article';
    actions.className = 'desk-actions';
    title.textContent = article.title;
    status.className = `status-pill ${article.status}`;
    status.textContent = statusLabels[article.status];
    meta.className = 'queue-meta';
    date.dateTime = article.created_at;
    date.textContent = dateFormat.format(new Date(article.created_at));
    excerpt.className = 'queue-excerpt';
    excerpt.textContent = article.body.trim().replace(/\s+/g, ' ').slice(0, 180);
    details.append(title, excerpt);
    meta.append(date, status);
    if (canReview || article.status === 'draft') {
      actions.append(action('Edit', () => openComposer(article)));
    }
    if (article.status === 'draft' && article.author_id === member.id) {
      actions.append(action('Submit for review', () => updateStatus(article, 'submitted')));
    }
    actions.append(action(canReview ? 'Open review' : 'View feedback', () => openReview(article)));
    card.append(details, meta, actions);
    list.append(card);
  }
}

async function showSession(session) {
  const version = ++sessionVersion;
  member = undefined;
  articleRows = [];
  field('article-search').value = '';
  statusFilter = '';
  field('recent-articles').replaceChildren();
  field('articles').replaceChildren();
  field('workspace').hidden = true;
  field('account').hidden = Boolean(session);
  field('invitations').hidden = true;
  field('invitation-result').hidden = true;
  field('invite-link').value = '';
  editArticle();
  if (!session) return;
  const { data, error } = await client.from('editorial_members').select('id,email,role')
    .eq('id', session.user.id).maybeSingle();
  if (version !== sessionVersion) return;
  if (error) throw error;
  if (!data) {
    await client.auth.signOut({ scope: 'local' });
    notice('This account does not have editorial access.');
    return;
  }
  member = data;
  field('identity').textContent = `${data.email} · ${roles[data.role]}`;
  panels.find(button => button.dataset.panel === 'invitations').hidden = data.role !== 'super_admin';
  panels.find(button => button.dataset.panel === 'media-panel').hidden = data.role === 'writer';
  panels.find(button => button.dataset.panel === 'homepage-panel').hidden = data.role === 'writer';
  showPanel('overview-panel');
  field('workspace').hidden = false;
  await listArticles();
}

async function start() {
  if (!editorialConfig.url || !editorialConfig.publishableKey) {
    notice('The editorial dashboard is awaiting account setup.');
    return;
  }
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.89.0');
  client = createClient(editorialConfig.url, editorialConfig.publishableKey, {
    auth: { storageKey: 'fdi-editorial-session' },
  });
  if (inviteParams.has('invite')) {
    field('code').value = inviteParams.get('invite');
    showRegistration(true);
    history.replaceState(null, '', dashboardUrl);
  }
  field('switch-auth').addEventListener('click', () => showRegistration(!registration));
  field('sign-out').addEventListener('click', () => run(field('sign-out'), async () => {
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) throw error;
    showRegistration(false);
    credentials.reset();
    await showSession(null);
  }));
  credentials.addEventListener('submit', event => {
    event.preventDefault();
    void run(event.submitter, async () => {
      const values = new FormData(credentials);
      const account = { email: values.get('email').trim().toLowerCase(), password: values.get('password') };
      if (registration) {
        const code = values.get('code').trim();
        if (!/^[a-f0-9]{48}$/.test(code)) throw new Error('Open the invitation link sent by your FDI administrator.');
        const check = await client.rpc('editorial_check_invite', { target_email: account.email, invitation_code: code });
        if (check.error && check.error.code !== 'PGRST202') throw check.error;
        if (!check.error && !check.data) throw new Error('This invite is expired, used, or belongs to a different email. Use the exact invited email or request a new link.');
        const { error } = await client.auth.signUp({
          ...account,
          options: { data: { editorial_code: code }, emailRedirectTo: dashboardUrl.href },
        });
        if (error?.code === 'unexpected_failure' && /database error saving new user/i.test(error.message)) {
          throw new Error('Supabase could not create this account. Ask your FDI administrator to check Auth and Postgres logs for this signup.');
        }
        if (error) throw error;
        credentials.reset();
        showRegistration(false);
        notice('Check your email for the confirmation link, then sign in.');
        return;
      }
      const { data, error } = await client.auth.signInWithPassword(account);
      if (error) throw error;
      credentials.elements.password.value = '';
      await showSession(data.session);
    });
  });
  inviteForm.addEventListener('submit', event => {
    event.preventDefault();
    void run(event.submitter, async () => {
      const data = new FormData(inviteForm);
      field('invitation-result').hidden = true;
      const { data: code, error } = await client.rpc('editorial_invite', {
        target_email: data.get('email'), target_role: data.get('role'),
      });
      if (error) throw error;
      const inviteUrl = new URL(dashboardUrl);
      inviteUrl.hash = new URLSearchParams({ invite: code }).toString();
      field('invite-link').value = inviteUrl.href;
      field('invitation-result').hidden = false;
      notice('Invitation ready. Send the link to the approved email.');
    });
  });
  field('copy-link').addEventListener('click', () => run(field('copy-link'), async () => {
    await navigator.clipboard.writeText(field('invite-link').value);
    notice('Invitation link copied.');
  }));
  field('new-article').addEventListener('click', () => editArticle());
  articleForm.addEventListener('submit', event => {
    event.preventDefault();
    void run(event.submitter, async () => {
      const data = new FormData(articleForm);
      const values = { title: data.get('title').trim(), body: data.get('body').trim() };
      if (!values.title || !values.body) throw new Error('Enter a title and article text.');
      const coverFile = data.get('cover');
      if (coverFile.size) values.cover_path = await uploadFile('editorial-covers', coverFile, coverTypes, 5 * 1024 * 1024);
      const articles = client.from('editorial_articles');
      const { data: saved, error } = editingId
        ? await articles.update(values).eq('id', editingId).select('id')
        : await articles.insert(values).select('id');
      if (error || !saved.length) {
        if (values.cover_path && (!error || error.code)) await client.storage.from('editorial-covers').remove([values.cover_path]);
        throw error || new Error('This article is no longer editable.');
      }
      if (event.submitter.value === 'submit') {
        try {
          await updateStatus({ id: saved[0].id, status: 'draft' }, 'submitted');
        } catch (error) {
          editingId = saved[0].id;
          articleForm.elements.cover.value = '';
          throw new Error(`Draft saved. Submission failed: ${error.message}`);
        }
      }
      editArticle();
      await listArticles();
      notice(event.submitter.value === 'submit' ? 'Article submitted for review.' : 'Article saved.');
    });
  });
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  await showSession(data.session);
}

start().catch(error => notice(error.message || 'Unable to start the editorial dashboard.'));
