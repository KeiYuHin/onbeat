import { expect, it } from 'vitest';
import { parseClientMsg } from './protocol';

const parse = (m: object) => parseClientMsg(JSON.stringify(m));

it('passes a library key through on create and join, and leaves it out when absent', () => {
  expect(parse({ type: 'create', part: 'bass', key: 'k1' })).toEqual({ type: 'create', part: 'bass', key: 'k1' });
  expect(parse({ type: 'join', room: '123456', part: 'drums', key: 'k1' })).toEqual({
    type: 'join',
    room: '123456',
    part: 'drums',
    key: 'k1',
  });
  expect(parse({ type: 'create', part: 'bass' })).toEqual({ type: 'create', part: 'bass' });
});

it('rejects a key that is not a short non-empty string', () => {
  expect(parse({ type: 'create', part: 'bass', key: 42 })).toBeNull();
  expect(parse({ type: 'create', part: 'bass', key: '' })).toBeNull();
  expect(parse({ type: 'join', room: '123456', part: 'bass', key: 'x'.repeat(129) })).toBeNull();
});

it('passes a trimmed device name through on save, and rejects a blank or long one', () => {
  expect(parse({ type: 'cmd', action: 'saveSong', device: ' iPhone 鼓手 ' })).toEqual({ type: 'cmd', action: 'saveSong', device: 'iPhone 鼓手' });
  expect(parse({ type: 'cmd', action: 'saveSong' })).toEqual({ type: 'cmd', action: 'saveSong' });
  expect(parse({ type: 'cmd', action: 'saveSong', device: '  ' })).toBeNull();
  expect(parse({ type: 'cmd', action: 'saveSong', device: 'x'.repeat(41) })).toBeNull();
});
