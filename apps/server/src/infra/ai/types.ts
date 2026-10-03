export type AiPurpose = 'selection_parse' | 'theme' | 'artwork';
export type ImagePurpose = Exclude<AiPurpose, 'selection_parse'>;
export type ModelKind = 'text' | 'image';
export type ProviderProtocol = 'openai' | 'gemini' | 'dashscope';
export type ModelParams = Record<string, string | number>;

/** A model assigned to a purpose, without secrets; safe for snapshots, offers and listings. */
export interface AssignedAiModel {
  id: string;
  kind: ModelKind;
  /** Model id sent to the provider. */
  model: string;
  params: ModelParams;
  /** Bumped on every model edit; snapshots pin it so edits invalidate offers and in-flight jobs. */
  revision: number;
  purpose: AiPurpose;
  /** 1-based order inside the purpose: primary first, then fallbacks. */
  position: number;
  /** Credits per image (theme) or per direction (artwork); null for text purposes. */
  unitCredits: number | null;
  protocol: ProviderProtocol;
  providerName: string;
}

export interface ActiveAiModel extends AssignedAiModel {
  baseUrl: string;
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
  /** The caller needs a single JSON object; adapters request JSON mode when the model params allow it. */
  json?: boolean;
  signal: AbortSignal;
}

export interface TextModelAdapter {
  /** Returns the raw assistant text; callers own parsing and validation. */
  complete(model: ActiveAiModel, request: TextCompletionRequest): Promise<string>;
}

export interface DiscoveredModel {
  id: string;
  name?: string;
  /** Best-effort guess from the provider listing; admins can still pick another kind. */
  kind?: ModelKind;
}

export type ParamField =
  | { key: string; label: string; description?: string; type: 'number'; default: number; min: number; max: number; step?: number }
  | { key: string; label: string; description?: string; type: 'select'; default: string; options: { label: string; value: string }[] };
