const STREAM_KEY_STORAGE = "savatar-stream-key";
const STREAM_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getOrCreateStreamRoomId() {
  const existing = window.localStorage.getItem(STREAM_KEY_STORAGE);
  if (existing && STREAM_KEY_PATTERN.test(existing)) return `stream-${existing}`;

  const key = window.crypto.randomUUID();
  window.localStorage.setItem(STREAM_KEY_STORAGE, key);
  return `stream-${key}`;
}
