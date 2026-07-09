import { oauth1Sign, buildOAuthHeader } from "./x-oauth-fetch.js";

function randomNonce() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function buildMultipartBody(boundary, fields, fileBytes, fileName, mimeType) {
  const enc = new TextEncoder();
  const chunks = [];

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      enc.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
    );
  }

  chunks.push(
    enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    )
  );
  chunks.push(fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes));
  chunks.push(enc.encode(`\r\n--${boundary}--\r\n`));

  const total = chunks.reduce((sum, part) => sum + part.length, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) {
    body.set(part, offset);
    offset += part.length;
  }
  return body;
}

/** Upload PNG/JPEG to X v1.1 media endpoint; returns media_id_string. */
export async function uploadTwitterMedia(env, imageBytes, options = {}) {
  const url = "https://upload.twitter.com/1.1/media/upload.json";
  const boundary = `monex${randomNonce()}`;
  const mimeType = options.mimeType || "image/png";
  const fileName = options.fileName || "catch-card.png";
  const body = buildMultipartBody(
    boundary,
    { media_category: options.mediaCategory || "tweet_image" },
    imageBytes,
    fileName,
    mimeType
  );

  const oauth = await oauth1Sign("POST", url, {}, env);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: buildOAuthHeader(oauth),
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.error || data?.errors?.[0]?.message || JSON.stringify(data);
    throw new Error(`X media upload ${res.status}: ${detail}`);
  }

  const mediaId = data.media_id_string || (data.media_id != null ? String(data.media_id) : null);
  if (!mediaId) throw new Error("X media upload missing media_id");
  return mediaId;
}
