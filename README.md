# Postcall

Postcall is a fast, local-first desktop application for creating, organizing, sending, and debugging API requests without sending workspace data to an external service.

## What you can do

- Build HTTP requests using GET, POST, PUT, PATCH, DELETE, HEAD, and OPTIONS.
- Manage query parameters, path variables, headers, authentication, request bodies, and request settings.
- Send raw text, JSON, JavaScript, HTML, XML, URL-encoded, multipart, binary-file, and GraphQL bodies.
- Upload files as multipart form fields or as the complete binary request body.
- Inspect response bodies, headers, status information, timing, and size using pretty or raw views.
- Search response content, copy responses, and download response bodies.
- Generate ready-to-run request code for cURL, JavaScript, Python, Go, Rust, C#, and PHP, or paste cURL text to create a request.
- Import and export Postman Collection v2 and v2.1 JSON files.
- Build reusable API Journeys that run saved requests in sequence. Extract JSON paths, headers, response bodies, or status codes into runtime variables, optionally format them, and reference them in later steps with `{{variableName}}`.

## Organize your APIs

Collections group related requests and can contain folders for individual API areas. Collections, folders, and requests have action menus for common operations such as creating, renaming, duplicating, moving, sorting, exporting, and deleting.

Independent workspaces keep different projects or teams separated. You can create, switch, and remove workspaces without mixing their collections, environments, or request history.

## Variables and authorization

Reusable variables can be defined in environments, collections, and folders using `{{variableName}}` syntax. The resolved-variable inspector shows the final URL, each variable value, and the scope supplying it.

Authorization can be configured on individual requests or inherited from a folder or collection. Supported modes include bearer tokens, JWT bearer tokens, OAuth access tokens, Basic authentication, and API keys in headers or query parameters.

## Local-first by design

Collections, workspaces, environments, and history remain on your device. Postcall does not send telemetry, and the application settings display the exact local storage path.

Requests entered without a protocol are attempted with HTTPS first and retried using HTTP when HTTPS does not return a response.

## Cloud sync via your own GitHub repository

Collections can optionally be synced through a GitHub repository you own, so the same collections are available on every device without relying on a third-party cloud service. This is opt-in: nothing leaves your device unless you link a repository.

To link a repository, open Settings and provide:

- **Repository owner and name** — the GitHub repo to store collections in (create an empty one first, e.g. `postcall-collections`).
- **Branch** — the branch to read from and write to (`main` by default).
- **A fine-grained personal access token** — scoped to read/write access to "Contents" on that one repository. The token is stored in your OS keychain (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux), never in the workspace file or the SQLite database.

Once linked, **Sync now** pulls remote changes and pushes any collections that changed locally since the last sync:

- Each collection is stored as its own file under `collections/`, tracked by a `manifest.json` at the repository root.
- Pushes are conditioned on the collection's last-known remote SHA, so a change someone else pushed since your last sync is never silently overwritten — it surfaces as a conflict instead.
- When a collection changed both locally and on GitHub since the last sync, you choose **Keep mine** or **Keep GitHub's** to resolve it explicitly.
- Deleting a collection does not currently sync — removing it locally or on GitHub does not remove its counterpart on the other side.

Unlinking clears the stored config, the sync state, and the keychain token, and stops any further sync activity.

## Interface

Postcall includes request tabs, resizable request and response panels, searchable collections and history, light and dark themes, keyboard-friendly request sending, and menus that close automatically when you click elsewhere in the application.

For downloads, installation, development, builds, release packaging, and implementation technologies, see [installation.md](installation.md).
