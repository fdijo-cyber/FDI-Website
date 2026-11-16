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
let sessionVersion = 0;

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
  const list = field('articles');
  list.replaceChildren();
  if (!data.length) list.textContent = 'No drafts yet.';
  const canReview = member.role !== 'writer';
  for (const article of data) {
    const card = document.createElement('article');
    const title = document.createElement('h3');
    const status = document.createElement('p');
    const actions = document.createElement('div');
    card.className = 'desk-article';
    actions.className = 'desk-actions';
    title.textContent = article.title;
    status.textContent = { draft: 'Draft', submitted: 'In review', approved: 'Approved' }[article.status];
    if (canReview || article.status === 'draft') {
      actions.append(action('Edit', () => {
        editArticle(article);
        articleForm.elements.title.focus();
      }));
    }
    if (article.status === 'draft' && article.author_id === member.id) {
      actions.append(action('Submit for review', () => updateStatus(article, 'submitted')));
    }
    if (canReview && article.status === 'submitted') {
      actions.append(action('Approve', () => updateStatus(article, 'approved')));
    }
    if (canReview && article.status !== 'draft') {
      actions.append(action('Return to draft', () => updateStatus(article, 'draft')));
    }
    card.append(title, status, actions);
    list.append(card);
  }
}

async function showSession(session) {
  const version = ++sessionVersion;
  member = undefined;
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
  field('invitations').hidden = data.role !== 'super_admin';
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
        const { error } = await client.auth.signUp({
          ...account,
          options: { data: { editorial_code: values.get('code').trim() }, emailRedirectTo: dashboardUrl.href },
        });
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
      const articles = client.from('editorial_articles');
      const { data: saved, error } = editingId
        ? await articles.update(values).eq('id', editingId).select('id')
        : await articles.insert(values).select('id');
      if (error) throw error;
      if (!saved.length) throw new Error('This article is no longer editable.');
      editArticle();
      await listArticles();
      notice('Article saved.');
    });
  });
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  await showSession(data.session);
}

start().catch(error => notice(error.message || 'Unable to start the editorial dashboard.'));
