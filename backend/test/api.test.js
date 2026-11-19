process.env.DB_PATH = require('path').join(require('os').tmpdir(), `elib-test-${Date.now()}.db`);
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../src/server');

let server, base;
before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}/api`; r(); }); }));
after(() => server.close());

const call = async (path, { method = 'GET', body, token } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
};

test('health + seeded catalog', async () => {
  const r = await call('/health');
  assert.equal(r.status, 200);
  assert.ok(r.data.books >= 20);
});

test('register, duplicate, login, me, logout', async () => {
  const body = { fullName: 'Test User', email: 'test@example.com', password: 'Passw0rd1' };
  const reg = await call('/auth/register', { method: 'POST', body });
  assert.equal(reg.status, 201);
  assert.equal((await call('/auth/register', { method: 'POST', body })).status, 409);
  assert.equal((await call('/auth/register', { method: 'POST', body: { ...body, email: 'x@y.com', password: 'short' } })).status, 400);
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: body.email, password: 'wrong' } })).status, 401);
  const login = await call('/auth/login', { method: 'POST', body: { email: body.email, password: body.password } });
  assert.equal(login.status, 200);
  const me = await call('/auth/me', { token: login.data.token });
  assert.equal(me.data.downloads.limit, 10);
  assert.equal((await call('/auth/logout', { method: 'POST', token: login.data.token })).status, 200);
});

test('search and filter', async () => {
  assert.ok((await call('/books?q=austen')).data.total >= 2);
  assert.ok((await call('/books?category=Science%20Fiction')).data.total >= 3);
});

test('book covers redirect to the stored public-domain cover image', async () => {
  const response = await fetch(base + '/books/1/cover', { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location'), /^https:\/\/www\.gutenberg\.org\/cache\/epub\/\d+\/pg\d+\.cover\.medium\.jpg$/);
});

test('guest limited to 5 downloads (backend enforced)', async () => {
  const g = await call('/auth/guest', { method: 'POST' });
  const t = g.data.token;
  for (let id = 1; id <= 5; id++) assert.equal((await call(`/books/${id}/download`, { method: 'POST', token: t })).status, 200);
  const sixth = await call('/books/6/download', { method: 'POST', token: t });
  assert.equal(sixth.status, 403);
  assert.equal(sixth.data.downloads.used, 5);
  assert.equal((await call('/favorites', { token: t })).status, 403);   // guests have no My Library
});

test('registered user limited to 10 downloads', async () => {
  const reg = await call('/auth/register', { method: 'POST', body: { fullName: 'Ten Limit', email: 'ten@example.com', password: 'Passw0rd1' } });
  const t = reg.data.token;
  for (let id = 1; id <= 10; id++) assert.equal((await call(`/books/${id}/download`, { method: 'POST', token: t })).status, 200);
  assert.equal((await call('/books/11/download', { method: 'POST', token: t })).status, 403);
  assert.equal((await call('/books/1/download', { method: 'POST', token: t })).status, 200); // repeat is free
});

test('favorites and library sync', async () => {
  const reg = await call('/auth/register', { method: 'POST', body: { fullName: 'Fav User', email: 'fav@example.com', password: 'Passw0rd1' } });
  const t = reg.data.token;
  await call('/favorites/3', { method: 'PUT', token: t });
  await call('/library/4', { method: 'PUT', token: t });
  assert.equal((await call('/favorites', { token: t })).data.books.length, 1);
  assert.equal((await call('/library', { token: t })).data.books[0].id, 4);
});

test('admin-only stats', async () => {
  const user = await call('/auth/register', { method: 'POST', body: { fullName: 'Plain User', email: 'plain@example.com', password: 'Passw0rd1' } });
  assert.equal((await call('/admin/stats', { token: user.data.token })).status, 403);
  const admin = await call('/auth/login', { method: 'POST', body: { email: 'admin@elibrary.local', password: 'Admin@12345' } });
  assert.equal((await call('/admin/stats', { token: admin.data.token })).status, 200);
});
