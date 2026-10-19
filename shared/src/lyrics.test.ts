import { describe, expect, it } from 'vitest';
import { lyricPieces, syllables } from './lyrics';

describe('syllables', () => {
  it('gives each Chinese character a note, ignoring phrase spaces and punctuation', () => {
    expect(syllables('我最爱去的唱片店 昨天')).toEqual(['我', '最', '爱', '去', '的', '唱', '片', '店', '昨', '天']);
    expect(syllables('你好，世界！')).toEqual(['你', '好，', '世', '界！']);
    expect(syllables('“他”')).toEqual(['“他”']);
  });

  it('splits English at spaces and hyphens', () => {
    expect(syllables("Some-one like you, don't")).toEqual(['Some', 'one', 'like', 'you,', "don't"]);
  });

  it('keeps melisma marks as notes of their own', () => {
    expect(syllables('伤_ 心__')).toEqual(['伤', '_', '心', '_', '_']);
    expect(syllables('some-one_')).toEqual(['some', 'one', '_']);
  });
});

describe('lyricPieces', () => {
  it('keeps one space per break and drops melisma marks', () => {
    expect(lyricPieces('伤_  心__ ')).toEqual(['伤', ' ', '心']);
    expect(lyricPieces('店 昨天')).toEqual(['店', ' ', '昨', '天']);
  });

  it('joins split words without a gap and keeps word breaks', () => {
    expect(lyricPieces('Some-one like_ you').join('')).toBe('Someone like you');
  });

  it('keeps a leading space: nothing is sung on the downbeat', () => {
    expect(lyricPieces(' 我不要')).toEqual([' ', '我', '不', '要']);
    expect(lyricPieces(' ')).toEqual([]);
    expect(lyricPieces('')).toEqual([]);
  });
});
