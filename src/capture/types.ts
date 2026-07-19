export type CaptureStatus = "ready" | "saving" | "saved" | "copied" | "zipped" | "error";

export type CaptureDestination = {
  path: string;
  assetDirectory: string;
};

export type PersistedAsset = {
  path: string;
  markdownPath?: string;
};

export type SaveResult = {
  path: string;
  savedAt: string;
};

export type StartupSettings = {
  destination?: CaptureDestination;
  showStartupPrompt?: boolean;
};
