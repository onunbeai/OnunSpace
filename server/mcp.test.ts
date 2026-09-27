import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from './mcp.js';

test('MCP handshake advertises tools with valid JSON schemas and a real motion contract', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'onun-contract-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.listTools();
    assert.ok(result.tools.length >= 20);
    for (const name of ['scene_code_set', 'timeline_update', 'project_update', 'generation_create', 'render_create', 'project_backup_info', 'project_backup_create']) assert.ok(result.tools.some(tool => tool.name === name));
    const schema = result.tools.find(tool => tool.name === 'project_update')?.inputSchema;
    assert.ok(schema?.properties?.project);
    const resource = await client.readResource({ uri: 'onun://motion-contract' });
    assert.equal(resource.contents.length, 1);
    assert.ok('text' in resource.contents[0]);
    assert.match(String(resource.contents[0].text), /HTML \+ CSS \+ GSAP/);
    for (const uri of ['onun://skills/motion','onun://skills/motion/authoring','onun://skills/motion-review']) {
      const skill = await client.readResource({uri});
      assert.equal(skill.contents[0].mimeType,'text/markdown');
      assert.ok('text' in skill.contents[0]);
      assert.ok(String(skill.contents[0].text).length>100);
    }
    assert.equal(JSON.stringify(result).includes('apiKey'), false);
  } finally { await client.close(); await server.close(); }
});
