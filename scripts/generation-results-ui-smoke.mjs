import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { placeCanvasNode } from '../shared/canvasLayout.ts';

const baseURL = process.env.ONUN_TEST_URL || 'http://127.0.0.1:5178';
const output = '.figma-app/evidence/generation-results-ui';
const report = { checkedAt: new Date().toISOString(), baseURL, checks: [], errors: [], isolation: 'All API requests intercepted; simulated jobs/projects in memory, no requests reach a provider or the real project API.' };
const videoData = 'data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAABYwEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsghYa7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAyV0GNTGF2ZjYyLjEyLjEwMkSJiECPQAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYhYT8vG7PBrh5yBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhAX14QDgkLCBWrqBoJqBAlWwhFW5gQESVMNnQIBzc6BjwIBnyJpFo4dFTkNPREVSRIeNTGF2ZjYyLjEyLjEwMnNz2mPAi2PFiFhPy8bs8GuHZ8ilRaOHRU5DT0RFUkSHmExhdmM2Mi4yOC4xMDIgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnVUaeeBAKNIGoEAAICCSYNCAAWQCfYIOCQcGKQABCB+ncYPz/eB+T4lj29/XdKXgu7vSw2+vde1RNfcXz+073011f2lFNQdU90bH13Ubrv09eh1EdZ0lg/Hbq3T6j1wAAB/vlaXvZvyHNyrPdZvZPmHyOBR3hPCKffJ2ZvfdoTVLSVM0diPqSKOQ2Poa5FU/hj4DR/rAkwP1S7696L1xCCtGr+NGjUfPO9qQtAkiraiGfYnlbo12XCZy0I9fNA1M86lzsEx6FCKiRBUKAzH2bxmZ2R065fAGQlH2DsElfOD6pncc+i8SXCSVnapfxjUs64H2l1C9kVgx2WmCi8OuIzoP+fQbNDnSbHpYwb75T7oPFb0WN0QY6t/NfjyjFeLnyj/OfL43GxqKtzmngFGeSE1vwgdOEC2dBgwACMEGmq1NROcWPcjx9d1sgnNk2KzGXbr7Bza23rGlgLeqUcEIZWPCd0WRoR2Az1YTAjOS5z4X+NZS/ekSM/6CleT5nZPqY3EgnRooGhhVOJgsVJO433rhhF6H3DUrdwsRy4LyqkXwAPGZm0RA8yVDG0dk39kdNylftqIV+eQFyqIrWtjDbhyHx7I4T5D0f8Z45p0I18oAq2ky2ZcM9kcKAOoU6zEuqHEupn6d7H09SIC3cRhqEWxVJTJFNVjzoxTUigsVDmxrtFZ6yVK/O631Xdr41SY4P8j+AYHpFLm4HXzjOiGUnmglTAC2w1lIzGQYYfypkb1YH7QWddjLmfZxHyXy9NkCClP9mkea8/MB/p9i4SFESd4/+ldJDH0d18hGPJNr4DtD+6/3jkhtPRE2JdGydp7b0VGOLQ6fxUzsLg2CJM/skXpCvn/YdqAqdu0ACWY6vJ1PMov9vqlQq9/lywdT/rXfsjdwOJYEOk4YpTDsOets7Zt8qqAuCZX8W9jfgccdln1fcBylBesKHBUxMB+gH57Ye5jjyu1Ik+2FU6NAuvr8oe1Hu5nut7A0ksB1yIvo3C+I8tORbwV5UegREKY8Al/+9awXzNfehvrO+gA6Yp6kQteA09on10zFVgvWdHG58wFfGY3mt9bnM4sXrxtxcr0mS/d1EMlO9h4EvLoVBxOeOyJ9/Qn49eYiMegNZbdQZaVop7CLb5GWzjt/4+x5F5AXFcre7KAr9LRB/NGFnBh0mEDJC+ju4SVk5J419/SQYAQc2m35HmZsOaD08nqIqxEIpkQ1xZpuPq+SfA1l9EN38SZ/W7nJMM0ZvHDHBYAnSYeqHpiRB8YKHOG7WWV2aMryE1asupudCTUNk2LmLBTxEcDamDykG0FHb+A7x7rRuZ33wM7FcujjpKQuRYognddKQ/KppTH8Za3fVSz2Vy2cm9J8RSMnWxovx32cOaAhv+VoKnZK4iuFYWwr/XAM8oGJpoqMj1f9je3iM3jHD6O/ldrJeKuVYuais0tb/yA3ugesjHrBgkLvDHriLROyFYMry3mIVDoinabXLGkRdmrDtFZ4Ef/caJdKz+0gy5YMOEPcnMCmn8yeBxV1piWWR+GpIjhMK14r+8uClgsy7qchhi5MJsJ/+2TpgXaSE2BOmygW1N+m9EyLlKTbSawIxocZer6vqjzJhA3zphm0Ys4CuKdMcqV7ub5B9jW5p9x/uK7kjPXNNLG8Hkaw4Fq1nHADJJUWSGKIo3NiwcIKQlf9eSkV14oVOC9uN2i6oJ3la4CW0FpNkW65LhixFZbzDwWGWl53X26CoR7jwlsw9A2sSX2tmAXZpqD5qtYGrcap5gMFHWGUgiPTs2fl45R/k174eU03wdMlqy9WfK4Td/9fi7UnHIWSkadcSNGCUtBoRVOH9GXXpfOapbc7+EYcSKPJ/EwXIgI/RuCkjU7+9VekvVmKTuqs7q+FtvAYpR1erPbFr+uT9Uk839Tv/cyt3Edp8LzUNQliYXFnV5Whs7jtqVv1I/cWrdPEK1ctvUxypUA6qzz1ajdkHae7CRAWbf5D5wSYO1TOR8/5c/o5iKQhmdCaPQ+U/z5nWHBO0ohByT2yzio/587KqeObn7PHZOJVPmYbPp15JaxjVwViftla08ERH5g+a9Qc4vB06UGDuAbjgFjotq4wu/YUBicR/3LbpYE8GYb4p2spg/GCrvlYV4x5xit3zQwulewKLM/063RKIJ5+kqLrGnsZDV88Om2hCj/DvVJs0NSourXI0zwSr2OulpBFs3P2Edv6QmCko+YA3jO5H8w7vL2pg8nQWhxKWT9+joxdqsJDRcozUlvdLgI+ZXmCPag6pFgW07rokZmHcMHJjXo415TttnEooJ5BLvV4Y+jZN+cx3XsCp5Fsbv6drQIFuu22rXnAu6X4Msx3HveD1GKSbUialMD6IY401zkHImdFS0nO2nsCNUMKd8cLHedkbgrGPDGlfZIagToEx/5nHIP3+ahB/tJwLh2CVNW//+AxvYQ0ukT0umJdB2qwmDw092TNWQiBmq5h6GG2jhwHU02pF1Y9SERTGqn4phRZJi+APvI3Iz7IXJrn9SyezNbIeWTFiqf0fvgb5dd/m//97N5DBEzYgRUsir1gfEWpzFMVHMo9pXSoWDMtqo5uDVqWq/yt/gvUeTpl3lfs0CFQzSDecxyoJt4lm3P12fkS3ZJd8jAr0LuwYkpw0mDaOPGA//zKObwtOearzc8KZFaqPHOpubqRIXhKQOiYKZ1yK6h5mayq96MV54wHnIacgOMEiz7zsU/d/RzVP4mz9HGLerH/Gy9UNq4DQem2uSv6AwHdReHTnTXwtzkC26VqACjQV+BAGQAhgBAkvChVAAAKHao5PMfGAmTAAB/usP7+UwQIsE77h+0vrtPMptMx6Ht1Qp4PPO+TZFlCxjYiw1rAEuWST4hq72mCJ21X7SAu0MTDJodwJI8urFnxNv4I+roT0sXuYmLTZegt2x3Zv4D82PytB89AmYgz67IsIqCFFJIzu8DkNq9HRSd/SKk8nMis2niJrweL87CnCsja2Yv54Bd18e82XfetuMXyTeEhhVpQjAIwqnveKEA02X2316+MB+wG6vceB4+z9EQNchjra8d5am2Y7G3k/AXBoxiGrhVhIG00KBA8WqSX0yH/aG5MgX6h2MkouauqRKmfGJmH0e+GgHEwBdYN9ppq943yNU9lJPryb5oBNCti+HAmLMa044i94EZFhNCzZAOJ+AeWM4pjW+pN+CTNn1ZxxFHgAKfl8bO2eEEuJqKC2piUgJgSSeZ7IjeTQ0B1s6KpGiywACjQTuBAMgAhgBAkvCxUAAAGHBamkg4AH3OyXjm0XwqzU40ewKYywH8PhfF2XtqVEcgyhHnvMaXV8+wFTZ/oWaz9gatje+Ouiv+V/dwsmuKj9WcrRaU4UhNI7oZXUE1ZSbVhP1nV/iAT+RsTE+f6j+QV5pvUy9AvfHmFXN07YEXj2b/Z3JvlXR23He2/0oS5DWqcKRqGjvyhkeXUTx5AoWOK58HrV4tPcZmxeOymHVWLa+r9YI0x42+mblHb+W8oFS6cMLHSP66lil6CniVhoNll5pwhYI36Ja6bQNyHDEz8WI8/RWF4uiDOe4Mi+U+VaMrCMkZOAAZ+HEv/IzbaGu65OLEFqOPIenXo0XDL/xNGUzmLVhfmUjT/IDmA+l2SLjMl4/zLZhuwNHBiZqchukBpPeH2SKjizvzGUSnogCjQO6BASwAhgBAkvCBVAAADHAAAH/dHwh6Duvz843T0fsmuTJS+h/ld4Q9LmAvYATK/ZZ7bw1eZdNgO1RrkdcC3cFAKJVW2hLmryJzvEayJC27F9eJhhyVVMyt2YM9CxRMMLqUZlAoeGEquZL/fV1FBl083hN0VUVe+p/RV9Gdd7nczRFWmwLqCg0puJPJ51EU7f+NZ+jBRwnSWB+shMq49/YSPI2hIzAPkj8P0ZKmsULwQd9mombq+MSUAymKjQHSQCNMiDu7MmUIJxFlQbgI3x9zYUQDGOI9BF6w81joiqDCJMwiOg+VWe5wvGsu4PdAo0HAgQGQAIYAQJLwsUqAABhwLKVH+AB+42kEiMnhiyWGp0FLlNgLzu5aQxZx90WVaNgmEllApyVvNq89OTFLnldXEdBLvnx+U9zh/f2m6l7R3mXnJ1zzG33Mw1PoS+yaHJcEVBAPrC88jqNpph3URf/c7449nIXLTLtfnqhXYJ89Eh4bn4u06G/fLYPTeOIVhy8sPDMnjrGwV1e0C7wok3tjT6Iz1qkV8lHjGcHHXmJJ4Z3a32rUk5R/eDaf94W1sLEtzYwanD6XONFp2ocotDen8DrfG2/w3iIjU1bA0UfQbpSUPZ5zDKTO3KDOSeBQ6Lscf675FhyiXXyT/2mrPoY7zdGO+S08WTj69H90ajDHE4AEkY6zpNT0swlN4ACZ7bfqSMYYFvnCXpYg5FThuL0QrHHYOnsp6TKC1Osxfk2QnDHzlhYMEQ/ywYPifX1YymUfDLSLEXsCCmowFMU9VLfKfGPHA8C9WRjEf7rLXb8f2RlP2sAGjfDxENq52bB8/njkd2xiDyNqAHKjK7TDYy+cJvtcWSpaKFYVUVpWXl948y8H0/IcUZedJ4Q/DPtE4ZilbkIwhQLhyCHl4U16DVduAKNBJoEB9ACGAECS8LFUAAAMcAAAfuOOu3OPUUw+aXITpMDoOkiFcyZuje6WnI+v6O9SoS4uj4Izwl2WjW6NSKRVelG7Kj6ehe3Ezcve7XhCqpY07tcvyDTi9tN+LLvnwHW+VsSPL2Z7Sc9arxbHJyGDzzSQ/zeiZ/3YCiK3cDKOQb+AS3ikbKlLWT397byjN99r9tt6XYxJ6htYJyXAQQga6vuSOLo4WuEZo5lXyFM1N7YS1F8JCu0ew/HatQm47Z4XoH4ilbx7nidLgfvUvWv+ly1EhfIA0syYxm7ysbx1GdH/0WW1nYegzrFWzt8AABaOJN024VAaSEPRKuYRRNots2GsLEL5gd4OYs5XZ9BSi1xybM5G5Gd0iyZDppCp7eShgS88hkaJYKNBR4ECWACGAECS8LFQAAAUcA3gAAB+5CU2hjRX3xOagv8AoisMT4mtti6pirBPurTjKQ5tnMv+6DQhZb+Up7gFF8jnkCvYE3w6cRG+FjjIe+ESoR/fUtRc00okFib7GhDhbXnbmeD1hC8qAwpBigUVZglfpfWuYdbEbe3uHNsDlBwRnh5ef8rw5v3n39eIUm2wDSBBc3/UsfWj6FkSzHwXgSzbCvXCaGfw+m37Kc8uiZS8Dt17oC0HIHCeBlUXVfs9TN/K8Pl+BQHAUOBfLiZVvYVupNox2e6Zu4dovGBmeAsc2YgWe+Cjg1d7lhP4dXkg6deL2TAlbFRwWAVknRMRL595sEc16WV9cfkBXLPkXtPrb6iAUDXs5OvFcPP+vkHWC+gHzEMfAXW0Ag0z+w21dls+xExRb+B4A8Les0/WKYAwPIcuBRBxAKNBHoECvACGAECS8LFUAAAMcAAAehz5r4pnYfnZneuieVkY5//5tqlff/5ZDGTi8RrezK9kX1QAP7oCUHCErXNvk321xNrK74aTt36w2WnBARYOxoNpCmWKTRSEsQF9EEotBwOMvWeFTdZ89fkq8CZ2ip2Nls1/vvFi4BF1cQTGV5H1FllO2dOvWGVUYE1cntlJptbbZ4lHL3wDmfUfFs4gSEbLihnBXt6T0ZM1/y8zCFe8sL4WQrLWc3MjnPmyG3QY80BnKWeW9oawzWp5EF0nZ1lo4hQ1WvpDRxVl0we82Rht8p8o8JWk3XdtYPEHYEtLpwkHQ9aZIphz0lUSMGFge/RjimSJIl5NmIgtKWdeCj2z2MokzbsII5UB6Y6afgCjQj+BAyAAhgBAkvBxQIAAFHCrwAAAf0zNqz2ycYYrx8RIzwe6jJlNTCChZwReVnRaG2783vWMEvLQH4nkh6mhnbFnQaaTXJ+XS3pxqco02NF7qG+TCfu84oHb5xJL5JBD21hZW3Q749fR46kAPngbUvbqpn7s5qFdR1Xu03sR36rM/WiGo2/hALzeOZm031ah+di/InbGI/QEVWM8bwMU7jqFz3Ksia2Nr92ahRD1jFJb5qpjEebNIuwY/C/A5v68xSN+4A7xFNe9OP2B/e9V0RCXCwTTh9A2rBOaxPs8WaBEDoXczBTyndKLsctVsUAQAfbe+aNpYXQxD5zVJffWtZtvo4fyNYfMcipfo2LfKiAZIx6rcmJsncoCl7bmbHjW9wAN6INpqxpA5kqjOygfMZuoyO4ttg8xifr4ZkmGXXD90QiUrpJGlXvYusVr/gnkvqAHv8nRyYEA8J7M+1yxkQWRSo+FcFdOx+FtMxzUeOsn0vNfte7DJnU41k1lCySIwyByfi4OeB0Lmoh1K09wiPzdd13k7BF6qTVLkHExSv9ILu9EVCz1I9/Nnh9TT+x/KnS/03sYoCZqz1+u8Xa7bOkRlSvJaWPxlgU8XrZBQFOtTLuNq2UEb3YwPhke84WE4XMIbRqSJQJFJApepWrz5Zb2hKU54CPG6eoDcTdpRRcxJgKbBTw+VXb3bcrTFgjruX4E68HqBQ+b9SYqZWr51wFSyHF1Wbjd11+/4eELwUghh4WWkfqE/QcYsqXBfUHWQKNBHIEDhACGAECS8KFUAAAget0gADDgAAB6NtnqOuGIsVwxOqLV+b7Il8lntsexesqiybd/qCt5aEJMtnWa4CuUUWDHpMp3zmVJD76wg0VcyF+2Muo6jSQNbwfA2Lv7WADxgLO6xFpukgWVJ9wj5E2+oO3xyxJxrRuXg8gX446dDJvR69/Ytiaz+69LFe8WzPm5qekRxpE3K55miNaB5f8lGrklhA/6vs95obXQLvfmZl2zahQGl2vRtn0cr6/G36PET2aYHeeiUtSXH1dpyUPfqbgyinuN9hX2QBwKkuAAGhIU2YRbkKydrUA1BavZUE1UfXG4hLHV6ofFCbzR3yGWYanNmLrRwDf6JaXB5LHOSnKZ1/iT/Lgs3FX+9dAAHFO7a5G7j7OBALeK94EB8YIBq/CBAw==';
const browser = await chromium.launch({ headless: true });
let failure;
await mkdir(output, { recursive: true });

async function fixture(kind, viewport) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => { if (window.top === window) localStorage.setItem('onun-space-locale', 'en'); });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  const images = await page.evaluate(() => [0, 1].map(index => {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 144;
    const drawing = canvas.getContext('2d'); drawing.fillStyle = index ? '#ff87f7' : '#7dc5e8'; drawing.fillRect(0, 0, 256, 144);
    drawing.fillStyle = '#161616'; drawing.fillRect(0, 0, 24, 24); drawing.fillRect(232, 120, 24, 24);
    return canvas.toDataURL('image/png');
  }));
  const id = `qa-results-${kind}-${viewport.width}`, aspectRatio = kind === 'image' ? '16:9' : '9:16';
  const model = { id: `qa/${kind}`, name: `QA ${kind}`, canonicalId: `QA ${kind}`, kind, provider: 'higgsfield', supported: true, capabilities: { aspectRatios: [aspectRatio], resolutions: ['720p'], counts: [1, 2], defaults: { aspectRatio, resolution: '720p', count: 1 } } };
  const generator = { id: 'generator', title: 'QA generator', kind, provider: 'higgsfield', model: model.id, x: 1300, y: 1020, width: 350, prompt: 'Synthetic composition for result display QA.', aspectRatio, resolution: '720p', count: 2, status: 'none', generationStatus: 'idle' };
  let project = { id, name: '[QA] Result nodes', revision: 1, nodes: [generator, { ...generator, id: 'blocker', title: 'Existing reference', kind: 'reference', x: 1746, width: 260, media: images[0], aspectRatio: '16:9' }], edges: [], motion: { id: 'qa-motion', name: 'QA motion', width: 1920, height: 1080, fps: 30, duration: 6, background: '#111111', layers: [] } };
  const submissions = [], writes = [];
  let polls = 0;
  const urls = kind === 'image' ? images : [videoData, videoData];
  await context.route('**/api/**', route => {
    const request = route.request(), url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/health') return json({ ok: true });
    if (url.pathname === '/api/settings') return json({ providers: { higgsfield: { configured: true, source: 'session' }, openrouter: { configured: false, source: 'none' } } });
    if (url.pathname === '/api/models') return json({ source: 'fixture', models: url.searchParams.get('provider') === 'higgsfield' && url.searchParams.get('kind') === kind ? [model] : [] });
    if (url.pathname === `/api/projects/${id}` && request.method() === 'GET') return json(project);
    if (url.pathname === `/api/projects/${id}` && request.method() === 'PUT') { writes.push(request.postDataJSON()); return json({ error: 'Unexpected project write' }, 409); }
    if (url.pathname === '/api/generate' && request.method() === 'POST') {
      submissions.push(request.postDataJSON());
      project = { ...project, revision: 2, nodes: project.nodes.map(node => node.id === generator.id ? { ...node, generationStatus: 'running' } : node) };
      return json({ id: `qa-job-${kind}`, status: 'queued' });
    }
    if (url.pathname === `/api/jobs/qa-job-${kind}`) {
      polls++;
      if (polls === 1) {
        const nodes = project.nodes.map(node => node.id === generator.id ? { ...node, generationStatus: 'complete', outputs: urls } : node), edges = [];
        urls.forEach((media, index) => {
          const result = placeCanvasNode({ ...generator, id: `output-qa-${index}`, title: `QA ${kind} result ${index + 1}`, generatedFrom: generator.id, media, width: 285, count: 1, generationStatus: 'complete' }, nodes, generator.id);
          nodes.push(result); edges.push({ id: `edge-qa-${index}`, source: generator.id, target: result.id });
        });
        project = { ...project, revision: 3, nodes, edges };
      }
      return json({ id: `qa-job-${kind}`, status: 'complete', outputs: urls });
    }
    return json({ error: 'Blocked by isolated result fixture' }, 503);
  });
  try {
    await page.goto(`${baseURL}/?project=${id}`);
    const source = page.locator('[data-node-id="generator"]');
    await source.locator('.model-trigger').getByText(model.name, { exact: true }).waitFor();
    await source.locator('.generate-button').waitFor();
    const initialScale = await page.locator('.canvas-world').evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a);
    assert.ok(initialScale > 1, 'Initial fit must use actual content bounds, excluding the distant origin');
    report.checks.push({ name: `${kind} ${viewport.width}px: initial fit excludes the empty origin for a project positioned at 1300,1020`, scale: initialScale });
    const before = await page.locator('.canvas-world').getAttribute('style');
    await source.locator('.generate-button').click();
    const last = page.locator('[data-node-id="output-qa-1"]');
    await last.waitFor();
    await page.waitForFunction(previous => document.querySelector('.canvas-world').getAttribute('style') !== previous, before);
    await page.waitForTimeout(400);
    assert.equal(submissions.length, 1); assert.equal(submissions[0].count, 2); assert.ok(polls >= 1);
    assert.equal(await source.locator('.node-compose').count(), 1);
    assert.equal(project.nodes.find(node => node.id === generator.id).media, undefined);
    assert.equal(await page.locator('.canvas-edge').count(), 2);
    assert.deepEqual(project.edges.map(edge => edge.source), ['generator', 'generator']);
    const geometry = await page.locator('.canvas-node').evaluateAll(elements => elements.map(element => {
      const bounds = element.getBoundingClientRect();
      return { id: element.dataset.nodeId, x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height };
    }));
    for (let i = 0; i < geometry.length; i++) for (let j = i + 1; j < geometry.length; j++) {
      const a = geometry[i], b = geometry[j];
      assert.ok(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y, `${a.id} overlaps ${b.id}`);
    }
    for (const result of project.nodes.filter(node => node.generatedFrom)) assert.ok(result.x >= generator.x + generator.width + 48);
    const area = await page.locator('.canvas-area').boundingBox();
    for (const node of geometry.filter(node => node.id === 'generator' || node.id.startsWith('output-'))) {
      assert.ok(node.x >= area.x && node.y >= area.y && node.right <= area.x + area.width && node.bottom <= area.y + area.height, `${node.id} must be automatically revealed inside canvas with the whole result group`);
    }
    for (const index of [0, 1]) {
      const node = page.locator(`[data-node-id="output-qa-${index}"]`);
      assert.equal(await node.locator('.node-compose,.model-trigger,textarea').count(), 0);
      assert.equal(await node.locator('.status-badge').count(), 1);
      assert.equal(await node.locator('.port-in,.port-out').count(), 2);
      const media = node.locator('.node-media');
      const sizing = await media.evaluate(element => ({ width: parseFloat(getComputedStyle(element).width), height: parseFloat(getComputedStyle(element).height), fit: getComputedStyle(element).objectFit }));
      const [w, h] = aspectRatio.split(':').map(Number);
      assert.ok(Math.abs(sizing.width / sizing.height - w / h) < .01);
      assert.equal(sizing.fit, 'contain');
    }
    report.checks.push({ name: `${kind} ${viewport.width}px: completion creates two connected result nodes beside the source, avoids existing reference, auto-reveals both outputs and their generator together`, geometry, writes: writes.length, interceptedSubmissions: submissions.length });
    report.checks.push({ name: `${kind} ${viewport.width}px: results contain full media at ${aspectRatio}, with status/ports and no generator controls` });
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${output}/${kind}-${viewport.width}-results.png` });
    await last.locator('.node-preview-button').click();
    const preview = page.locator('.media-preview');
    await preview.waitFor();
    if (kind === 'image') {
      await preview.locator('img').evaluate(element => element.decode());
      assert.deepEqual(await preview.locator('img').evaluate(element => [element.naturalWidth, element.naturalHeight]), [256, 144]);
    } else {
      await page.waitForFunction(() => { const video = document.querySelector('.media-preview video'); return video && video.videoWidth > 0 && video.readyState >= 1; });
      assert.equal(await preview.locator('video').evaluate(element => element.controls), true);
      await preview.locator('video').evaluate(element => element.play());
      await page.waitForFunction(() => document.querySelector('.media-preview video')?.currentTime > .1);
      await preview.locator('video').evaluate(element => element.pause());
      assert.deepEqual(await preview.locator('video').evaluate(element => [element.videoWidth, element.videoHeight]), [90, 160]);
    }
    assert.equal(await preview.locator('.media-preview-error').count(), 0);
    await page.screenshot({ path: `${output}/${kind}-${viewport.width}-preview.png` });
    await preview.getByRole('button', { name: 'Close preview', exact: true }).click();
    assert.equal(writes.length, 0); assert.equal(submissions.length, 1);
    report.checks.push({ name: `${kind} ${viewport.width}px: result opens a decoded media preview without another generation or project write` });
  } finally { await context.close(); }
}

try {
  await fixture('image', { width: 1600, height: 1000 });
  await fixture('video', { width: 1600, height: 1000 });
  await fixture('image', { width: 1024, height: 900 });
  await fixture('video', { width: 1024, height: 900 });
  assert.deepEqual(report.errors, []);
} catch (error) { failure = error; report.failure = error.stack || String(error); }
finally {
  await browser.close();
  report.status = failure ? 'failed' : 'passed';
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
}
if (failure) { console.error(failure); process.exitCode = 1; }
else console.log(JSON.stringify(report));
