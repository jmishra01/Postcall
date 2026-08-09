# Postcall

Postcall is a fast, local-first desktop application for creating, organizing, sending, and debugging API requests without sending workspace data to an external service.

## What you can do

- Build HTTP requests using GET, POST, PUT, PATCH, DELETE, HEAD, and OPTIONS.
- Manage query parameters, path variables, headers, authentication, request bodies, and request settings.
- Send raw text, JSON, JavaScript, HTML, XML, URL-encoded, multipart, binary-file, and GraphQL bodies.
- Upload files as multipart form fields or as the complete binary request body.
- Inspect response bodies, headers, status information, timing, and size using pretty or raw views.
- Search response content, copy responses, and download response bodies.
- Generate a cURL command from the active request or paste cURL text to create a request.
- Import and export Postman Collection v2 and v2.1 JSON files.

## Organize your APIs

Collections group related requests and can contain folders for individual API areas. Collections, folders, and requests have action menus for common operations such as creating, renaming, duplicating, moving, sorting, exporting, and deleting.

Independent workspaces keep different projects or teams separated. You can create, switch, and remove workspaces without mixing their collections, environments, or request history.

## Variables and authorization

Reusable variables can be defined in environments, collections, and folders using `{{variableName}}` syntax. The resolved-variable inspector shows the final URL, each variable value, and the scope supplying it.

Authorization can be configured on individual requests or inherited from a folder or collection. Supported modes include bearer tokens, JWT bearer tokens, OAuth access tokens, Basic authentication, and API keys in headers or query parameters.

## Local-first by design

Collections, workspaces, environments, and history remain on your device. Postcall does not send telemetry, and the application settings display the exact local storage path.

Requests entered without a protocol are attempted with HTTPS first and retried using HTTP when HTTPS does not return a response.

## Interface

Postcall includes request tabs, resizable request and response panels, searchable collections and history, light and dark themes, keyboard-friendly request sending, and menus that close automatically when you click elsewhere in the application.

For downloads, installation, development, builds, release packaging, and implementation technologies, see [installation.md](installation.md).
