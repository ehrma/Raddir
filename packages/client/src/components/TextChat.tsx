import { useState, useRef, useEffect } from "react";
import { useServerStore } from "../stores/serverStore";
import { getSignalingClient, getKeyManager } from "../hooks/useConnection";
import { Send, Lock, ShieldAlert } from "lucide-react";
import {
  encryptFrame,
  decryptFrame,
  generateIV,
  arrayBufferToBase64,
  base64ToArrayBuffer,
} from "../lib/e2ee/crypto";

interface ChatMessage {
  id: string;
  userId: string;
  nickname: string;
  content: string;
  timestamp: number;
  encrypted: boolean;
}

export function TextChat() {
  const { currentChannelId } = useServerStore();
  const channelMessagesRef = useRef<Map<string, ChatMessage[]>>(new Map());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const frameCounterRef = useRef(0);

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

  const handleSend = async () => {
    if (!input.trim() || !currentChannelId) return;

    const client = getSignalingClient();
    if (!client) return;

    const km = getKeyManager();
    const channelKey = km?.getChannelKey();
    const keyEpoch = km?.getKeyEpoch() ?? 0;

    const plaintext = new TextEncoder().encode(input.trim());
    let ciphertext: string;
    let iv: string;

    if (channelKey) {
      const ivBytes = generateIV(frameCounterRef.current++, 0);
      const encrypted = await encryptFrame(channelKey, plaintext.buffer as ArrayBuffer, ivBytes);
      ciphertext = arrayBufferToBase64(encrypted);
      iv = arrayBufferToBase64(ivBytes.buffer as ArrayBuffer);
    } else {
      ciphertext = btoa(input.trim());
      iv = "";
    }

    client.send({
      type: "chat",
      channelId: currentChannelId,
      ciphertext,
      iv,
      keyEpoch,
    });

    setInput("");
  };

  // Listen for incoming chat messages
  useEffect(() => {
    const client = getSignalingClient();
    if (!client) return;

    const unsub = client.on("chat", async (msg: any) => {
      const chatChannelId = msg.channelId as string;

      try {
        let content: string;
        let encrypted = false;

        if (msg.iv && msg.iv.length > 0) {
          const km = getKeyManager();
          const channelKey = km?.getChannelKey();
          if (channelKey) {
            const ivBytes = new Uint8Array(base64ToArrayBuffer(msg.iv));
            const ciphertextBytes = base64ToArrayBuffer(msg.ciphertext);
            const decrypted = await decryptFrame(channelKey, ciphertextBytes, ivBytes);
            content = new TextDecoder().decode(decrypted);
            encrypted = true;
          } else {
            content = "[encrypted — no key]";
          }
        } else {
          content = atob(msg.ciphertext);
        }

        const newMsg: ChatMessage = {
          id: `${msg.timestamp}-${msg.userId}-${Math.random().toString(36).slice(2, 6)}`,
          userId: msg.userId,
          nickname: msg.nickname,
          content,
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
          content: "[decryption failed]",
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
    <div className="flex flex-col h-full min-w-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3 min-w-0">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-surface-500">
            <Lock className="w-5 h-5 mb-2" />
            <p className="text-xs">Messages are end-to-end encrypted</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className="group min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-surface-200">
                {msg.nickname}
              </span>
              <span className="text-[10px] text-surface-600">
                {new Date(msg.timestamp * 1000).toLocaleTimeString()}
              </span>
              {msg.encrypted && (
                <span title="End-to-end encrypted"><Lock className="w-2.5 h-2.5 text-green-500" /></span>
              )}
              {msg.content === "[decryption failed]" && (
                <span title="Decryption failed"><ShieldAlert className="w-2.5 h-2.5 text-red-400" /></span>
              )}
            </div>
            <p className="text-sm text-surface-300 mt-0.5 break-all">{msg.content}</p>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-surface-800">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Send an encrypted message..."
            className="flex-1 px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-100 placeholder:text-surface-500 focus:outline-none focus:border-accent"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="p-2 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
