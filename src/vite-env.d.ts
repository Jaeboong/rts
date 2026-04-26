/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_NANOCLAW?: string;
  readonly VITE_OPENCLAW_AGENT_ID?: string;
  readonly VITE_DEFAULT_ENEMY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
