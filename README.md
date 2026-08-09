# Postcall

Postcall is a fast, local-first desktop API client built with Rust, Tauri 2, Svelte 5, and TypeScript.

## Current foundation

- Native HTTP execution through Rust and `reqwest`
- GET, POST, PUT, PATCH, DELETE, HEAD, and OPTIONS requests
- Query parameters, `:path` parameters, headers, and bulk key-value editing
- Raw Text/JavaScript/JSON/HTML/XML, URL-encoded, multipart file/text, binary, and GraphQL bodies
- Bearer, JWT bearer, OAuth access-token, Basic, API-key, and inherited authentication modes
- Pretty/raw response body, headers, metadata, copying, and downloads
- Collection action menus with add request/folder, rename, duplicate, sort, export, and delete
- Request tabs and draggable request/response panel resizing
- Environment variables with `{{variable}}` substitution
- Request history
- Dark and light themes
- SQLite-backed workspace persistence in the Tauri application data directory
- Browser fallback for frontend development
- Automatic HTTPS-first and HTTP fallback for URLs entered without a protocol

## Development

Prerequisites are Node.js, npm, Rust, and the platform dependencies required by Tauri 2.

```bash
npm install
npm run tauri:dev
```

Run the frontend independently:

```bash
npm run dev
```

## Verification

```bash
npm run check
npm run build
cd src-tauri && cargo test
```

Create a desktop debug build:

```bash
npm run tauri:build -- --debug
```

## Next implementation milestones

1. Postman collection/environment import and export, cURL import, and code snippets
2. Sandboxed pre-request scripts and post-response tests
3. Collection runner with CSV/JSON iteration data
4. Cookie jar, certificates, proxies, and detailed network timing
5. GraphQL, WebSocket, SSE, and gRPC clients
6. Examples, API documentation, mock servers, backup, and restore
7. Release packaging, updater support, and full cross-platform end-to-end tests

Postcall stores workspace data locally and does not send telemetry.
