export type AiPurpose = 'selection_parse' | 'theme' | 'artwork';
export type ImagePurpose = Exclude<AiPurpose, 'selection_parse'>;
/** Provider ids are free-form; the catalog decides which (purpose, provider) pairs are usable. */
export type AiProvider = string;

export interface AiModelConfig {
  purpose: AiPurpose;
  provider: AiProvider;
  label: string;
  model: string;
  credentialConfigured: boolean;
  enabled: boolean;
  priority: number;
  unitCredits: number | null;
  revision: number;
}

export interface ActiveAiModel extends AiModelConfig {
  apiKey: string;
}

export type ProviderRequestObserver = (requestId: string) => Promise<void> | void;

export interface ImageEditRequest {
  /** Validated PNG/JPEG/WebP bytes of the image to edit. */
  reference: Buffer;
  prompt: string;
  /** Images wanted from this single call; never above the adapter's `maxImagesPerRequest`. */
  count: number;
  deadline: Date;
  /** Transparent pixels mark the editable region; adapters without mask support ignore it. */
  mask?: Buffer;
  /** Short-lived download URL of `reference` for providers that fetch inputs themselves. */
  sourceUrl?: string;
  /** Asynchronous providers report their task id before polling so a crash can resume it. */
  onSubmitted?: (taskId: string) => Promise<void>;
  onProviderRequest?: ProviderRequestObserver;
}

/**
 * Image adapters return generated images as `data:` URLs or trusted HTTPS URLs and must throw
 * `ImageGenerationError` with retryable/outcomeUnknown set so callers can decide on retries and billing.
 */
export interface ImageModelAdapter {
  maxImagesPerRequest: number;
  /** HTTPS host suffixes this provider may return result URLs on; `data:` URLs need none. */
  downloadHosts: readonly string[];
  edit(model: ActiveAiModel, request: ImageEditRequest): Promise<string[]>;
  /** Present only for asynchronous providers that hand back a task id via `onSubmitted`. */
  poll?(model: ActiveAiModel, taskId: string, deadline: Date): Promise<string[]>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface TextCompletionRequest {
  messages: ChatMessage[];
  maxTokens: number;
  /** Ask the provider to emit a single JSON object. */
  json?: boolean;
  signal: AbortSignal;
}

export interface TextModelAdapter {
  /** Returns the raw assistant text; callers own parsing and validation. */
  complete(model: ActiveAiModel, request: TextCompletionRequest): Promise<string>;
}
