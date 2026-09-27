import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { importedMediaName } from '../src/features/canvas/mediaImport';

test('browser file names remain valid project titles', () => {
  assert.equal(importedMediaName(''), 'Imagem colada');
  assert.equal(importedMediaName(' \r\n\u0000 '), 'Imagem colada');
  assert.equal(importedMediaName('x'.repeat(255) + '.png').length, 200);
  assert.equal(importedMediaName(' photo.png '), 'photo.png');
});
