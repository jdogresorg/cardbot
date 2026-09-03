/**
 * Persistent map of card name -> Telegram file_id.
 *
 * Telegram lets a bot re-send a file it has already uploaded by id, so after
 * the first request for a card the image never leaves the server again. The
 * cache is a small JSON file; losing it only costs one re-upload per card.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class FileIdCache {
  constructor(file) {
    this.file = file;
    this.entries = {};
    this.dirty = false;
  }

  async load() {
    if (!this.file) return this;
    try {
      this.entries = JSON.parse(await readFile(this.file, 'utf8'));
    } catch {
      this.entries = {};
    }
    return this;
  }

  /** Key includes the send method so a photo id is never reused as a document. */
  get(name, kind) {
    return this.entries[`${kind}:${name}`] || null;
  }

  set(name, kind, fileId) {
    this.entries[`${kind}:${name}`] = fileId;
    this.dirty = true;
  }

  delete(name, kind) {
    delete this.entries[`${kind}:${name}`];
    this.dirty = true;
  }

  async save() {
    if (!this.file || !this.dirty) return;
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.entries, null, 1));
    this.dirty = false;
  }
}
