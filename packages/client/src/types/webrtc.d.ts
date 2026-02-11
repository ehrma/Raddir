interface RTCEncodedAudioFrame {
  data: ArrayBuffer;
  readonly timestamp: number;
  getMetadata(): RTCEncodedAudioFrameMetadata;
}

interface RTCEncodedAudioFrameMetadata {
  synchronizationSource?: number;
  contributingSources?: number[];
}

interface RTCRtpScriptTransform {
  new (worker: Worker, options?: any): RTCRtpScriptTransform;
}
