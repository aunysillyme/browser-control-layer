import { open, link, unlink, lstat } from 'node:fs/promises';
import { dirname, basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ReadError } from './errors.mjs';

export async function saveContent(destination, content) {
  const path = resolve(destination);
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let handle;
  let created = false;
  try {
    try {
      const existing = await lstat(path);
      if (existing) throw new ReadError('SAVE_EXISTS', 'Choose a fresh output file');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    handle = await open(temporary, 'wx', 0o600);
    created = true;
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    // A hard link publishes the complete inode without overwriting a racing file.
    await link(temporary, path);
    await unlink(temporary); created = false;
    return { path, bytes: Buffer.byteLength(content) };
  } catch (error) {
    if (error instanceof ReadError) throw error;
    throw new ReadError('SAVE_FAILED', 'Could not save the complete response', { cause: error });
  } finally {
    await handle?.close().catch(() => {});
    if (created) await unlink(temporary).catch(() => {});
  }
}

export function boundedOutput(content, { path, bytes, headBytes = 2048, screen = 'unscreened' }) {
  const buffer = Buffer.from(content);
  let head = buffer.subarray(0, headBytes).toString('utf8');
  if (buffer.length > headBytes) head = head.replace(/\ufffd$/u, '');
  return { screen, head, path, bytes, truncated: buffer.length > headBytes };
}
