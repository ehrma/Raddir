import { useState, useRef, useEffect, type ChangeEvent, type ClipboardEvent, type ReactNode } from "react";
import { useServerStore } from "../stores/serverStore";
import { getSignalingClient, getKeyManager } from "../hooks/useConnection";
import { Send, Lock, ShieldAlert, ShieldEllipsis, ImagePlus, Smile, X, ExternalLink } from "lucide-react";
import { getUserRoleColor } from "../lib/role-color";
import { getApiBase } from "../lib/api-base";
import {
  encryptFrame,
  decryptFrame,
  generateRandomIV,
  arrayBufferToBase64,
  base64ToArrayBuffer,
} from "../lib/e2ee/crypto";

interface ChatImageAttachment {
  mimeType: string;
  dataBase64: string;
  name?: string;
}

interface ChatPayloadV1 {
  version: 1;
  text?: string;
  image?: ChatImageAttachment;
}

interface ChatMessage {
  id: string;
  userId: string;
  nickname: string;
  text: string;
  image?: ChatImageAttachment;
  timestamp: number;
  encrypted: boolean;
}

const EMOTES = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "😎", "🤔", "😴", "😭",
  "😡", "👍", "👎", "👏", "🙏", "🔥", "🎉", "✅", "❌", "💯",
];

const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>()]+/gi;

const TEXT_EMOTES: Array<{ pattern: RegExp; emoji: string }> = [
  { pattern: /(^|[\s])(:-?\))(?=\s|$)/g, emoji: "$1🙂" },
  { pattern: /(^|[\s])(:-?\()(?=\s|$)/g, emoji: "$1🙁" },
  { pattern: /(^|[\s])(;-?\))(?=\s|$)/g, emoji: "$1😉" },
  { pattern: /(^|[\s])(:-?D)(?=\s|$)/gi, emoji: "$1😄" },
  { pattern: /(^|[\s])(:-?[pP])(?=\s|$)/g, emoji: "$1😛" },
  { pattern: /(^|[\s])(:'\()(?=\s|$)/g, emoji: "$1😢" },
  { pattern: /(^|[\s])(:-?[oO])(?=\s|$)/g, emoji: "$1😮" },
  { pattern: /(^|[\s])(<3)(?=\s|$)/g, emoji: "$1❤️" },
];

function translateTextEmotes(input: string): string {
  let translated = input;
  for (const { pattern, emoji } of TEXT_EMOTES) {
    translated = translated.replace(pattern, emoji);
  }
  return translated;
}

function isValidImageAttachment(value: unknown): value is ChatImageAttachment {
  if (!value || typeof value !== "object") return false;
  const image = value as Partial<ChatImageAttachment>;
  return (
    typeof image.mimeType === "string"
    && image.mimeType.startsWith("image/")
    && typeof image.dataBase64 === "string"
    && image.dataBase64.length > 0
    && (image.name === undefined || typeof image.name === "string")
  );
}

function parseStructuredPayload(raw: string): { text: string; image?: ChatImageAttachment } {
  try {
    const parsed = JSON.parse(raw) as Partial<ChatPayloadV1>;
    if (!parsed || parsed.version !== 1) {
      return { text: raw };
    }

    return {
      text: typeof parsed.text === "string" ? parsed.text : "",
      ...(isValidImageAttachment(parsed.image) ? { image: parsed.image } : {}),
    };
  } catch {
    return { text: raw };
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function renderTextWithLinks(text: string, onLinkClick: (url: string) => void): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = new RegExp(URL_PATTERN);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const fullMatch = match[0];
    const start = match.index;

    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }

    let cleanUrl = fullMatch;
    while (cleanUrl.length > 0 && /[),.!?;:]$/.test(cleanUrl)) {
      cleanUrl = cleanUrl.slice(0, -1);
    }

    const trailing = fullMatch.slice(cleanUrl.length);

    if (cleanUrl.length > 0) {
      nodes.push(
        <a
          key={`url-${start}`}
          href={cleanUrl}
          onClick={(event) => {
            event.preventDefault();
            onLinkClick(cleanUrl);
          }}
          className="text-accent hover:text-accent-hover underline break-all"
        >
          {cleanUrl}
        </a>
      );
    }

    if (trailing) {
      nodes.push(trailing);
    }

    lastIndex = start + fullMatch.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export function TextChat() {
  const { currentChannelId, members } = useServerStore();
  const channelMessagesRef = useRef<Map<string, ChatMessage[]>>(new Map());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState<ChatImageAttachment | null>(null);
  const [pendingImagePreview, setPendingImagePreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [showEmotes, setShowEmotes] = useState(false);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [expandedImage, setExpandedImage] = useState<ChatImageAttachment | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Track channel key availability
  useEffect(() => {
    const km = getKeyManager();
    if (!km) { setHasKey(false); return; }
    setHasKey(!!km.getChannelKey());
    const unsub = km.onKeyChanged((key: CryptoKey | null) => setHasKey(!!key));
    return unsub;
  }, [currentChannelId]);

  // Sync displayed messages when channel changes
  useEffect(() => {
    if (!currentChannelId) {
      setMessages([]);
      return;
    }
    setMessages(channelMessagesRef.current.get(currentChannelId) ?? []);
  }, [currentChannelId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!expandedImage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpandedImage(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expandedImage]);

  const handleSend = async () => {
    const text = translateTextEmotes(input.trim());
    const hasImage = !!pendingImage;
    if ((!text && !hasImage) || !currentChannelId) return;

    const client = getSignalingClient();
    if (!client) return;

    const km = getKeyManager();
    const channelKey = km?.getChannelKey();
    const keyEpoch = km?.getKeyEpoch() ?? 0;

    const plaintextMessage = hasImage
      ? JSON.stringify({
          version: 1,
          ...(text ? { text } : {}),
          ...(pendingImage ? { image: pendingImage } : {}),
        } satisfies ChatPayloadV1)
      : text;
    const plaintext = new TextEncoder().encode(plaintextMessage);
    let ciphertext: string;
    let iv: string;

    if (!channelKey) return; // Never send unencrypted

    const ivBytes = generateRandomIV();
    const encrypted = await encryptFrame(channelKey, plaintext.buffer as ArrayBuffer, ivBytes);
    ciphertext = arrayBufferToBase64(encrypted);
    iv = arrayBufferToBase64(ivBytes.buffer as ArrayBuffer);

    client.send({
      type: "chat",
      channelId: currentChannelId,
      ciphertext,
      iv,
      keyEpoch,
      encoding: hasImage ? "json-v1" : "text",
    });

    setInput("");
    setPendingImage(null);
    setPendingImagePreview(null);
    setImageError(null);
    setShowEmotes(false);
  };

  const handleAddEmote = (emote: string) => {
    setInput((prev) => `${prev}${emote}`);
  };

  const handlePickImage = () => {
    imageInputRef.current?.click();
  };

  const processImageFile = async (file: File) => {
    const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      setImageError("Unsupported image type. Use PNG, JPEG, WebP, or GIF.");
      return;
    }

    if (file.size > IMAGE_MAX_BYTES) {
      setImageError("Image too large. Maximum size is 2MB.");
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const match = dataUrl.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
      if (!match) {
        setImageError("Failed to parse image data.");
        return;
      }

      setPendingImage({
        mimeType: match[1]!,
        dataBase64: match[2]!,
        name: file.name,
      });
      setPendingImagePreview(dataUrl);
      setImageError(null);
    } catch {
      setImageError("Failed to read image.");
    }
  };

  const handleExpandImage = (image: ChatImageAttachment) => {
    setExpandedImage(image);
  };

  const handleImageSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await processImageFile(file);
  };

  const handleInputPaste = async (event: ClipboardEvent<HTMLInputElement>) => {
    const items = event.clipboardData?.items;
    if (!items || items.length === 0) return;

    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) return;
        event.preventDefault();
        await processImageFile(file);
        return;
      }
    }
  };

  const clearPendingImage = () => {
    setPendingImage(null);
    setPendingImagePreview(null);
    setImageError(null);
  };

  const confirmOpenLink = async () => {
    const url = pendingLink;
    if (!url) return;

    setPendingLink(null);
    try {
      if (window.raddir) {
        if (!window.raddir.openExternalUrl) {
          console.error("[chat] Electron bridge missing openExternalUrl");
          return;
        }
        await window.raddir.openExternalUrl(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      console.error("[chat] Failed to open link:", err);
    }
  };

  // Listen for incoming chat messages
  useEffect(() => {
    const client = getSignalingClient();
    if (!client) return;

    const unsub = client.on("chat", async (msg: any) => {
      const chatChannelId = msg.channelId as string;

      try {
        let text = "";
        let image: ChatImageAttachment | undefined;
        let encrypted = false;

        if (msg.iv && msg.iv.length > 0) {
          const km = getKeyManager();
          const channelKey = km?.getChannelKey();
          if (channelKey) {
            const ivBytes = new Uint8Array(base64ToArrayBuffer(msg.iv));
            const ciphertextBytes = base64ToArrayBuffer(msg.ciphertext);
            const decrypted = await decryptFrame(channelKey, ciphertextBytes, ivBytes);
            const decryptedText = new TextDecoder().decode(decrypted);

            if (msg.encoding === "json-v1") {
              const structured = parseStructuredPayload(decryptedText);
              text = translateTextEmotes(structured.text);
              image = structured.image;
            } else {
              text = translateTextEmotes(decryptedText);
            }

            if (!text && !image) {
              text = "[empty message]";
            }
            encrypted = true;
          } else {
            text = "[encrypted - no key]";
          }
        } else {
          text = "[unencrypted message]";
        }

        const newMsg: ChatMessage = {
          id: `${msg.timestamp}-${msg.userId}-${Math.random().toString(36).slice(2, 6)}`,
          userId: msg.userId,
          nickname: msg.nickname,
          text,
          ...(image ? { image } : {}),
          timestamp: msg.timestamp,
          encrypted,
        };

        // Store in per-channel map
        const existing = channelMessagesRef.current.get(chatChannelId) ?? [];
        const updated = [...existing, newMsg];
        channelMessagesRef.current.set(chatChannelId, updated);

        // Update display if this message is for the current channel
        const current = useServerStore.getState().currentChannelId;
        if (chatChannelId === current) {
          setMessages(updated);
        }
      } catch {
        const errMsg: ChatMessage = {
          id: `${msg.timestamp}-${msg.userId}-err`,
          userId: msg.userId,
          nickname: msg.nickname,
          text: "[decryption failed]",
          timestamp: msg.timestamp,
          encrypted: false,
        };

        const chatChannelIdErr = msg.channelId as string;
        const existing = channelMessagesRef.current.get(chatChannelIdErr) ?? [];
        const updated = [...existing, errMsg];
        channelMessagesRef.current.set(chatChannelIdErr, updated);

        const current = useServerStore.getState().currentChannelId;
        if (chatChannelIdErr === current) {
          setMessages(updated);
        }
      }
    });

    return unsub;
  }, []);

  return (
    <>
      <div className="flex flex-col h-full min-w-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3 min-w-0">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-surface-500">
            {hasKey ? (
              <><Lock className="w-5 h-5 mb-2 text-green-500" /><p className="text-xs">Messages are end-to-end encrypted</p></>
            ) : (
              <><ShieldEllipsis className="w-5 h-5 mb-2 text-yellow-500" /><p className="text-xs">Negotiating encryption keys…</p></>
            )}
          </div>
        )}
        {messages.map((msg) => {
          const member = members.get(msg.userId);
          const avatarUrl = member?.avatarUrl;
          return (
          <div key={msg.id} className="group min-w-0">
            <div className="flex items-center gap-2">
              {avatarUrl ? (
                <img src={`${getApiBase()}${avatarUrl}`} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-surface-700 flex items-center justify-center text-[9px] font-medium text-surface-400 flex-shrink-0">
                  {msg.nickname.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-sm font-medium" style={{ color: getUserRoleColor(msg.userId) ?? undefined }}>
                {msg.nickname}
              </span>
              <span className="text-[10px] text-surface-600">
                {new Date(msg.timestamp * 1000).toLocaleTimeString()}
              </span>
              {msg.encrypted && (
                <span title="End-to-end encrypted"><Lock className="w-2.5 h-2.5 text-green-500" /></span>
              )}
              {msg.text === "[decryption failed]" && (
                <span title="Decryption failed"><ShieldAlert className="w-2.5 h-2.5 text-red-400" /></span>
              )}
            </div>
            {msg.text && (
              <p className="text-sm text-surface-300 mt-0.5 break-words whitespace-pre-wrap select-text">
                {renderTextWithLinks(msg.text, setPendingLink)}
              </p>
            )}
            {msg.image && (
              <div className="mt-2">
                <img
                  src={`data:${msg.image.mimeType};base64,${msg.image.dataBase64}`}
                  alt={msg.image.name ?? "Shared image"}
                  className="max-w-full max-h-72 rounded-lg border border-surface-700 object-contain cursor-pointer hover:border-accent transition-colors"
                  onClick={() => handleExpandImage(msg.image!)}
                  title="Open image"
                />
              </div>
            )}
          </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-surface-800">
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setShowEmotes((prev) => !prev)}
            type="button"
            className="p-2 rounded-lg bg-surface-800 text-surface-300 hover:bg-surface-700 hover:text-surface-100 transition-colors"
            title="Insert emote"
          >
            <Smile className="w-4 h-4" />
          </button>
          <button
            onClick={handlePickImage}
            type="button"
            className="p-2 rounded-lg bg-surface-800 text-surface-300 hover:bg-surface-700 hover:text-surface-100 transition-colors"
            title="Attach image"
          >
            <ImagePlus className="w-4 h-4" />
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleImageSelected}
            className="hidden"
          />
          {pendingImage && (
            <button
              onClick={clearPendingImage}
              type="button"
              className="text-xs text-red-400 hover:text-red-300"
              title="Remove selected image"
            >
              Remove image
            </button>
          )}
        </div>

        {showEmotes && (
          <div className="mb-2 p-2 rounded-lg border border-surface-700 bg-surface-800 grid grid-cols-10 gap-1">
            {EMOTES.map((emote) => (
              <button
                key={emote}
                onClick={() => handleAddEmote(emote)}
                type="button"
                className="h-7 rounded text-sm hover:bg-surface-700 transition-colors"
              >
                {emote}
              </button>
            ))}
          </div>
        )}

        {pendingImage && pendingImagePreview && (
          <div className="mb-2 p-2 rounded-lg border border-surface-700 bg-surface-800 flex items-center gap-2">
            <img src={pendingImagePreview} alt="Selected" className="w-10 h-10 rounded object-cover" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-surface-200 truncate">{pendingImage.name ?? "image"}</p>
              <p className="text-[10px] text-surface-500">Will be sent end-to-end encrypted</p>
            </div>
            <button
              onClick={clearPendingImage}
              type="button"
              className="p-1 rounded text-surface-400 hover:text-surface-100 hover:bg-surface-700 transition-colors"
              title="Remove selected image"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {imageError && (
          <p className="mb-2 text-xs text-red-400">{imageError}</p>
        )}

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handleInputPaste}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder={hasKey ? "Send an encrypted message…" : "Waiting for encryption keys…"}
            disabled={!hasKey}
            className="flex-1 px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-100 placeholder:text-surface-500 focus:outline-none focus:border-accent disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={(!input.trim() && !pendingImage) || !hasKey}
            className="p-2 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
      </div>

      {expandedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setExpandedImage(null)}
        >
          <div className="absolute top-4 right-4">
            <button
              type="button"
              onClick={() => setExpandedImage(null)}
              className="p-2 rounded-lg bg-surface-900/90 text-surface-200 hover:bg-surface-800 border border-surface-700 transition-colors"
              title="Close image"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <img
            src={`data:${expandedImage.mimeType};base64,${expandedImage.dataBase64}`}
            alt={expandedImage.name ?? "Shared image"}
            className="max-w-[96vw] max-h-[92vh] rounded-lg object-contain border border-surface-700"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}

      {pendingLink && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setPendingLink(null)}>
          <div
            className="w-full max-w-md bg-surface-900 rounded-xl border border-surface-700 shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-surface-800 flex items-center gap-2">
              <ExternalLink className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-surface-100">Open external link?</h3>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-surface-400">This link was shared in chat:</p>
              <p className="text-xs text-surface-200 break-all select-text">{pendingLink}</p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setPendingLink(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-surface-300 bg-surface-800 hover:bg-surface-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmOpenLink}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-amber-600 hover:bg-amber-500 transition-colors"
                >
                  Open Link
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
