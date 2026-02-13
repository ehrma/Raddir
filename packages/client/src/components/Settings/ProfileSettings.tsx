import { useState } from "react";
import { useServerStore } from "../../stores/serverStore";
import { getApiBase, getAuthHeaders } from "../../lib/api-base";
import { Upload, Image, Trash2 } from "lucide-react";

export function ProfileSettings() {
  const { userId, members } = useServerStore();
  const me = userId ? members.get(userId) : undefined;
  const currentAvatarUrl = me?.avatarUrl;

  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const avatarSrc = currentAvatarUrl ? `${getApiBase()}${currentAvatarUrl}` : null;

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setError("Image too large. Maximum 2MB.");
      return;
    }

    const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      setError("Unsupported format. Use PNG, JPEG, WebP, or GIF.");
      return;
    }

    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      setIconPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = async () => {
    if (!userId || !iconPreview) return;
    setUploading(true);
    setError(null);
    setSuccess(false);
    try {
      const match = iconPreview.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!match) {
        setError("Invalid image data");
        setUploading(false);
        return;
      }

      const res = await fetch(`${getApiBase()}/api/users/${userId}/avatar`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ data: match[2], mimeType: match[1] }),
      });
      if (res.ok) {
        setIconPreview(null);
        const data = await res.json();
        // Update our own member entry with the new avatar URL
        const store = useServerStore.getState();
        const me = store.members.get(userId);
        if (me) {
          const updated = new Map(store.members);
          updated.set(userId, { ...me, avatarUrl: data.avatarUrl + `?t=${Date.now()}` });
          useServerStore.setState({ members: updated });
        }
        setSuccess(true);
        setTimeout(() => setSuccess(false), 2000);
      } else {
        const body = await res.json().catch(() => ({ error: "Upload failed" }));
        setError(body.error ?? "Upload failed");
      }
    } catch (err) {
      console.error("[profile] Failed to upload avatar:", err);
      setError("Network error");
    }
    setUploading(false);
  };

  const handleDelete = async () => {
    if (!userId) return;
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/api/users/${userId}/avatar`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        setIconPreview(null);
        const store = useServerStore.getState();
        const me = store.members.get(userId);
        if (me) {
          const updated = new Map(store.members);
          updated.set(userId, { ...me, avatarUrl: null });
          useServerStore.setState({ members: updated });
        }
      }
    } catch (err) {
      console.error("[profile] Failed to delete avatar:", err);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-surface-200 mb-4">Profile</h3>

        {/* Avatar */}
        <label className="text-xs font-medium text-surface-300 mb-2 block">Avatar</label>
        <div className="flex items-start gap-4">
          <div className="relative">
            {iconPreview ? (
              <img src={iconPreview} alt="Preview" className="w-20 h-20 rounded-xl object-cover border-2 border-accent/50" />
            ) : avatarSrc ? (
              <img src={avatarSrc} alt="Your avatar" className="w-20 h-20 rounded-xl object-cover border border-surface-700" />
            ) : (
              <div className="w-20 h-20 rounded-xl bg-surface-800 border border-surface-700 flex items-center justify-center">
                <Image className="w-8 h-8 text-surface-600" />
              </div>
            )}
          </div>
          <div className="space-y-2 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-800 border border-surface-700 rounded-lg text-xs text-surface-300 hover:border-surface-600 hover:text-surface-200 transition-colors cursor-pointer">
                <Upload className="w-3 h-3" /> Choose Image
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleSelect} className="hidden" />
              </label>
              {iconPreview && (
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="px-3 py-1.5 bg-accent text-white text-xs rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-colors"
                >
                  {uploading ? "Uploading..." : "Upload"}
                </button>
              )}
              {(avatarSrc && !iconPreview) && (
                <button
                  onClick={handleDelete}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-red-400 bg-red-400/10 rounded-lg hover:bg-red-400/20 transition-colors"
                >
                  <Trash2 className="w-3 h-3" /> Remove
                </button>
              )}
            </div>
            <p className="text-[9px] text-surface-500">Square image recommended. PNG, JPEG, WebP, or GIF. Max 2MB.</p>
            {error && <p className="text-[10px] text-red-400">{error}</p>}
            {success && <p className="text-[10px] text-green-400">Avatar updated!</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
