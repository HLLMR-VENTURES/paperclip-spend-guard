/**
 * Package entrypoint.
 *
 * Re-exports the manifest and the worker plugin object so consumers (and tests)
 * can import them by name, mirroring the first-party Paperclip example plugins.
 * The host itself loads the manifest and worker through the `paperclipPlugin`
 * keys in package.json, not through this barrel — this exists for ergonomics.
 */

export { default as manifest } from "./manifest.js";
export { default as worker } from "./worker.js";
