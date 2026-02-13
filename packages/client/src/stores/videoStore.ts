import { create } from "zustand";

export interface RemoteVideo {
  stream: MediaStream;
  mediaType: "webcam" | "screen";
}

export interface VideoState {
  webcamActive: boolean;
  screenShareActive: boolean;
  showSourcePicker: boolean;
  localWebcamStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  remoteVideos: Map<string, RemoteVideo>; // keyed by `${userId}:${mediaType}`

  setWebcamActive: (active: boolean) => void;
  setScreenShareActive: (active: boolean) => void;
  setShowSourcePicker: (show: boolean) => void;
  setLocalWebcamStream: (stream: MediaStream | null) => void;
  setLocalScreenStream: (stream: MediaStream | null) => void;
  addRemoteVideo: (userId: string, mediaType: "webcam" | "screen", stream: MediaStream) => void;
  removeRemoteVideo: (userId: string, mediaType: "webcam" | "screen") => void;
  removeAllRemoteVideosForUser: (userId: string) => void;
  clearAll: () => void;
}

export const useVideoStore = create<VideoState>((set) => ({
  webcamActive: false,
  screenShareActive: false,
  showSourcePicker: false,
  localWebcamStream: null,
  localScreenStream: null,
  remoteVideos: new Map(),

  setWebcamActive: (active) => set({ webcamActive: active }),
  setScreenShareActive: (active) => set({ screenShareActive: active }),
  setShowSourcePicker: (show) => set({ showSourcePicker: show }),
  setLocalWebcamStream: (stream) => set({ localWebcamStream: stream }),
  setLocalScreenStream: (stream) => set({ localScreenStream: stream }),

  addRemoteVideo: (userId, mediaType, stream) =>
    set((s) => {
      const updated = new Map(s.remoteVideos);
      updated.set(`${userId}:${mediaType}`, { stream, mediaType });
      return { remoteVideos: updated };
    }),

  removeRemoteVideo: (userId, mediaType) =>
    set((s) => {
      const updated = new Map(s.remoteVideos);
      updated.delete(`${userId}:${mediaType}`);
      return { remoteVideos: updated };
    }),

  removeAllRemoteVideosForUser: (userId) =>
    set((s) => {
      const updated = new Map(s.remoteVideos);
      for (const key of updated.keys()) {
        if (key.startsWith(`${userId}:`)) {
          updated.delete(key);
        }
      }
      return { remoteVideos: updated };
    }),

  clearAll: () =>
    set({
      webcamActive: false,
      screenShareActive: false,
      showSourcePicker: false,
      localWebcamStream: null,
      localScreenStream: null,
      remoteVideos: new Map(),
    }),
}));
