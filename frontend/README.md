# Installer frontend

The installer's desktop app: a React 19 + TypeScript interface built with
Vite and styled with the thinkube-style components, wrapped by Tauri.

- `src/pages/`: one page per installer step, from `welcome` to `complete`.
- `src/components/`: shared parts, such as the playbook output stream.
- `src-tauri/`: the Tauri shell, and in `src-tauri/backend/` the FastAPI
  backend it starts.

Run it in development from this folder with `npm run tauri:dev`. The
repository README explains building and packaging.
