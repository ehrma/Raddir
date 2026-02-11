import { useVoiceStore } from "../stores/voiceStore";
import { getActiveMediaClient } from "../lib/audio/audio-bridge";

export function VolumeSlider({ userId }: { userId: string }) {
  const { userVolumes, setUserVolume } = useVoiceStore();
  const volume = userVolumes.get(userId) ?? 1.0;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseInt(e.target.value) / 100;
    setUserVolume(userId, newVolume);
    getActiveMediaClient()?.setUserVolume(userId, newVolume);
  };

  return (
    <input
      type="range"
      min="0"
      max="200"
      value={Math.round(volume * 100)}
      onChange={handleChange}
      className="w-16 h-1 accent-accent cursor-pointer"
    />
  );
}
