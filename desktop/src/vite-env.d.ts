/// <reference types="vite/client" />

/** URLs de los servicios por ambiente (.env.development / .env.staging / .env.production). */
interface ImportMetaEnv {
  readonly VITE_AUTH_URL?: string;
  readonly VITE_CATALOG_URL?: string;
  readonly VITE_ALGORITHMS_URL?: string;
  readonly VITE_DECISION_URL?: string;
  readonly VITE_DOCUMENTS_URL?: string;
  readonly VITE_INGESTION_URL?: string;
  readonly VITE_SEGMENTATION_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
