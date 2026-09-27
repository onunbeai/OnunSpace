import test from 'node:test';
import assert from 'node:assert/strict';
import { Credentials } from './credentials.js';
import { HttpError } from './errors.js';
import { Providers } from './providers.js';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('Higgsfield accepts one complete dashboard key, combined credentials and optional Key prefix without exposing them', () => {
  const credentials = new Credentials({});
  for (const [input, expected] of [
    ['fake-dashboard-token-123', 'fake-dashboard-token-123'],
    ['fake-key-id:fake-key-secret', 'fake-key-id:fake-key-secret'],
    ['  Key fake-dashboard-token-123  ', 'fake-dashboard-token-123'],
    ['Key fake-key-id:fake-key-secret', 'fake-key-id:fake-key-secret'],
  ]) {
    const status = credentials.set({ provider: 'higgsfield', apiKey: input });
    assert.equal(credentials.header('higgsfield'), `Key ${expected}`);
    assert.deepEqual(status.providers.higgsfield, { configured: true, source: 'session' });
    assert.equal(JSON.stringify(status).includes(expected), false);
    assert.equal(JSON.stringify(credentials.status()).includes(expected), false);
  }
});

test('legacy separate key and secret remain supported without appending twice to complete credentials', () => {
  const credentials = new Credentials({});
  credentials.set({ provider: 'higgsfield', apiKey: 'fake-id', apiSecret: 'fake-secret' });
  assert.equal(credentials.header('higgsfield'), 'Key fake-id:fake-secret');
  credentials.set({ provider: 'higgsfield', apiKey: 'fake-id:fake-secret', apiSecret: 'fake-secret' });
  assert.equal(credentials.header('higgsfield'), 'Key fake-id:fake-secret');
  credentials.set({ provider: 'higgsfield', apiKey: 'Key fake-opaque-token', apiSecret: 'unused-legacy-secret' });
  assert.equal(credentials.header('higgsfield'), 'Key fake-opaque-token');
});

test('Higgsfield environment aliases preserve precedence, legacy input and session fallback', () => {
  const cases: [NodeJS.ProcessEnv, string][] = [
    [{ HF_CREDENTIALS: 'fake-credentials-token', HF_KEY: 'fake-alias-token', HF_API_KEY: 'fake-id', HF_API_SECRET: 'fake-secret' }, 'fake-credentials-token'],
    [{ HF_KEY: 'Key fake-alias-token', HF_API_KEY: 'fake-id', HF_API_SECRET: 'fake-secret' }, 'fake-alias-token'],
    [{ HF_API_KEY: 'fake-complete-token' }, 'fake-complete-token'],
    [{ HF_API_KEY: 'fake-id', HF_API_SECRET: 'fake-secret' }, 'fake-id:fake-secret'],
    [{ HF_API_KEY: 'fake-id:fake-secret', HF_API_SECRET: 'fake-secret' }, 'fake-id:fake-secret'],
  ];
  for (const [environment, expected] of cases) {
    const credentials = new Credentials(environment);
    assert.equal(credentials.header('higgsfield'), `Key ${expected}`);
    assert.deepEqual(credentials.status().providers.higgsfield, { configured: true, source: 'environment' });
    credentials.set({ provider: 'higgsfield', apiKey: 'fake-session-override' });
    assert.equal(credentials.header('higgsfield'), 'Key fake-session-override');
    credentials.set({ provider: 'higgsfield', clear: true });
    assert.equal(credentials.header('higgsfield'), `Key ${expected}`);
  }
});

test('malformed credential text is rejected without replacing the configured key', () => {
  const credentials = new Credentials({});
  credentials.set({ provider: 'higgsfield', apiKey: 'fake-valid-token' });
  for (const apiKey of ['', ' ', 'short', 'Key ', 'Key Key fake-token', 'Bearer fake-token', 'fake token', 'fake-token\n', '\rfake-token', 'fake\ttoken', 'fake\0token', 'fake-token\u007f', 'fake-token\u0080', 'chave-inválida']) {
    assert.throws(() => credentials.set({ provider: 'higgsfield', apiKey }), error => error instanceof HttpError && error.code === 'invalid_credentials');
    assert.equal(credentials.header('higgsfield'), 'Key fake-valid-token');
  }
  assert.throws(() => credentials.set({ provider: 'higgsfield', apiKey: 'fake-id', apiSecret: 'bad\rsecret' }), error => error instanceof HttpError && error.code === 'invalid_credentials');
  assert.equal(new Credentials({ HF_KEY: 'invalid\nkey' }).status().providers.higgsfield.configured, false);
});

test('the provider adapter sends one documented Key header for an opaque credential', async () => {
  const credentials = new Credentials({});
  credentials.set({ provider: 'higgsfield', apiKey: 'Key fake-dashboard-token' });
  const providers = new Providers(credentials, async (_url, init) => {
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Key fake-dashboard-token');
    return new Response(JSON.stringify({status:'queued'}));
  });
  assert.deepEqual(await providers.json('higgsfield','/requests/fake-request/status'), {status:'queued'});
});

test('private credentials survive restart for both providers with owner-only file modes and durable clearing',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'onun-credentials-'));
  const path=join(directory,'private','credentials.json');
  try{
    const first=new Credentials({},path);
    assert.deepEqual(first.status().credentialStorage,{persistent:true,available:true});
    first.set({provider:'higgsfield',apiKey:'Key fake-persistent-higgsfield'});
    first.set({provider:'openrouter',apiKey:'fake-persistent-openrouter'});
    assert.equal((await stat(join(directory,'private'))).mode&0o777,0o700);
    assert.equal((await stat(path)).mode&0o777,0o600);
    assert.deepEqual(await readdir(join(directory,'private')),['credentials.json']);
    const restart=new Credentials({},path);
    assert.equal(restart.header('higgsfield'),'Key fake-persistent-higgsfield');
    assert.equal(restart.header('openrouter'),'Bearer fake-persistent-openrouter');
    assert.deepEqual(restart.status().providers.higgsfield,{configured:true,source:'stored'});
    assert.equal(JSON.stringify(restart.status()).includes('fake-persistent'),false);
    restart.set({provider:'higgsfield',apiKey:'fake-updated-higgsfield'});
    const updated=new Credentials({},path);
    assert.equal(updated.header('higgsfield'),'Key fake-updated-higgsfield');
    assert.equal(updated.header('openrouter'),'Bearer fake-persistent-openrouter');
    updated.set({provider:'higgsfield',clear:true});
    const cleared=new Credentials({},path);
    assert.deepEqual(cleared.status().providers.higgsfield,{configured:false,source:'none'});
    assert.equal(cleared.header('openrouter'),'Bearer fake-persistent-openrouter');
    cleared.set({provider:'openrouter',clear:true});
    assert.equal(new Credentials({},path).status().providers.openrouter.configured,false);
    assert.equal((await readFile(path,'utf8')).includes('fake-'),false);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('clearing a stored override explicitly reports environment fallback after restart',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'onun-credential-env-'));const path=join(directory,'private','credentials.json');
  try{
    const environment={HF_KEY:'fake-environment-token'};
    const credentials=new Credentials(environment,path);
    credentials.set({provider:'higgsfield',apiKey:'fake-stored-token'});
    assert.equal(credentials.status().providers.higgsfield.source,'stored');
    assert.deepEqual(credentials.set({provider:'higgsfield',clear:true}).providers.higgsfield,{configured:true,source:'environment'});
    assert.equal(new Credentials(environment,path).header('higgsfield'),'Key fake-environment-token');
    assert.equal((await readFile(path,'utf8')).includes('fake-stored-token'),false);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('failed persistence preserves the last connected credential and exposes no submitted key',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'onun-credential-failure-'));const path=join(directory,'private','credentials.json');
  try{
    const credentials=new Credentials({},path);
    credentials.set({provider:'higgsfield',apiKey:'fake-original-token'});
    await rename(path,`${path}.original`);await mkdir(path);
    assert.throws(()=>credentials.set({provider:'higgsfield',apiKey:'fake-unsaved-secret'}),error=>error instanceof HttpError&&error.code==='credential_storage_unavailable'&&!error.message.includes('fake-unsaved-secret'));
    assert.equal(credentials.header('higgsfield'),'Key fake-original-token');
    assert.equal(credentials.status().credentialStorage.available,false);
    assert.equal(JSON.stringify(credentials.status()).includes('fake-'),false);
    await rm(path,{recursive:true});await rename(`${path}.original`,path);
    credentials.set({provider:'openrouter',apiKey:'fake-after-recovery'});
    assert.equal(credentials.status().credentialStorage.available,true);
    assert.equal(new Credentials({},path).header('higgsfield'),'Key fake-original-token');
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('malformed private storage and symlink destinations cannot be overwritten by saving',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'onun-credential-invalid-'));const privateDirectory=join(directory,'private');const path=join(privateDirectory,'credentials.json');
  try{
    await mkdir(privateDirectory);await writeFile(path,'{broken-json');
    const invalid=new Credentials({},path);
    assert.equal(invalid.status().credentialStorage.available,false);
    assert.throws(()=>invalid.set({provider:'higgsfield',apiKey:'fake-cannot-overwrite'}),error=>error instanceof HttpError&&error.code==='credential_storage_unavailable');
    assert.equal(await readFile(path,'utf8'),'{broken-json');
    await rm(path);const elsewhere=join(directory,'elsewhere');await writeFile(elsewhere,'untouched');await symlink(elsewhere,path);
    const linked=new Credentials({},path);
    assert.equal(linked.status().credentialStorage.available,false);
    assert.throws(()=>linked.set({provider:'higgsfield',apiKey:'fake-cannot-follow'}),error=>error instanceof HttpError&&error.code==='credential_storage_unavailable');
    assert.equal(await readFile(elsewhere,'utf8'),'untouched');
  }finally{await rm(directory,{recursive:true,force:true});}
});
