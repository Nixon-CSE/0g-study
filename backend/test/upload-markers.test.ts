import { describe, it, expect } from 'vitest';
import { uploadIdsIn, MAX_UPLOAD_IDS } from '../src/agents/upload-markers.js';

const A = '0f8fad5b-d9cb-469f-a165-70867728950e';
const B = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('uploadIdsIn', () => {
  it('extracts the ids of [[upload:…]] markers, in order, without duplicates', () => {
    expect(uploadIdsIn(`@study-note-reader [[upload:${A}]] and [[upload:${B}]] [[upload:${A}]]`)).toEqual([A, B]);
  });
  it("drops ids the agent's UPLOAD_ID rule would reject", () => {
    expect(uploadIdsIn('[[upload:SHOUTING-ID-1234]] [[upload:abc]] [[upload:../../etc]] [[upload:zzzzzzzzzz]]')).toEqual([]);
  });
  it('no markers, empty or missing content → []', () => {
    expect(uploadIdsIn('how does the Calvin cycle connect to what I studied earlier?')).toEqual([]);
    expect(uploadIdsIn('')).toEqual([]);
    expect(uploadIdsIn(undefined)).toEqual([]);
  });
  it('is capped', () => {
    const many = Array.from({ length: 40 }, (_, i) => `[[upload:${i.toString(16).padStart(8, '0')}]]`).join(' ');
    expect(uploadIdsIn(many)).toHaveLength(MAX_UPLOAD_IDS);
  });
});
