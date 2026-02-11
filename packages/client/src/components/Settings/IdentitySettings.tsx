import { useState, useEffect, useRef } from "react";
import { getOrCreateIdentity, clearIdentity, getStoredIdentityPublicKey, computeFingerprint, exportIdentity, importIdentity } from "../../lib/e2ee/identity";
import { useVerificationStore } from "../../stores/verificationStore";
import { Shield, Copy, RefreshCw, ShieldCheck, Trash2, Download, Upload } from "lucide-react";

export function IdentitySettings() {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const key = getStoredIdentityPublicKey();
    setPublicKey(key);
  }, []);

  const handleRegenerate = async () => {
    clearIdentity();
    const { publicKeyHex } = await getOrCreateIdentity();
    setPublicKey(publicKeyHex);
  };

  const handleCopy = () => {
    if (publicKey) {
      navigator.clipboard.writeText(publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleExport = async () => {
    if (!passphrase.trim()) return;
    setError("");
    setBusy(true);
    try {
      const data = await exportIdentity(passphrase);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "raddir-identity.json";
      a.click();
      URL.revokeObjectURL(url);
      setShowExport(false);
      setPassphrase("");
    } catch (err: any) {
      setError(err.message ?? "Export failed");
    } finally {
      setBusy(false);
    }
  };

  const handleImportFile = async (file: File) => {
    if (!passphrase.trim()) return;
    setError("");
    setBusy(true);
    try {
      const contents = await file.text();
      await importIdentity(contents, passphrase);
      const key = getStoredIdentityPublicKey();
      setPublicKey(key);
      setShowImport(false);
      setPassphrase("");
    } catch (err: any) {
      setError(err.message?.includes("decrypt") ? "Wrong passphrase" : (err.message ?? "Import failed"));
    } finally {
      setBusy(false);
    }
  };

  const fingerprint = publicKey ? computeFingerprint(publicKey) : "";
  const { verifiedUsers, unverifyUser } = useVerificationStore();
  const verifiedList = Array.from(verifiedUsers.values());

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-surface-200">Identity</h3>

      <div className="p-3 bg-surface-800/50 rounded-lg border border-surface-700">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-4 h-4 text-accent" />
          <span className="text-xs font-medium text-surface-300">Your Identity Key</span>
        </div>

        {publicKey ? (
          <>
            <code className="block text-xs text-surface-400 font-mono break-all mb-2">
              {publicKey.slice(0, 32)}...
            </code>
            <p className="text-[10px] text-surface-500 mb-3">
              Fingerprint: <span className="font-mono text-surface-400">{fingerprint}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-2 py-1 text-[10px] bg-surface-700 rounded text-surface-400 hover:text-surface-200 transition-colors"
              >
                <Copy className="w-3 h-3" />
                {copied ? "Copied!" : "Copy"}
              </button>
              <button
                onClick={() => { setShowExport(true); setShowImport(false); setPassphrase(""); setError(""); }}
                className="flex items-center gap-1 px-2 py-1 text-[10px] bg-surface-700 rounded text-surface-400 hover:text-surface-200 transition-colors"
              >
                <Download className="w-3 h-3" />
                Export
              </button>
              <button
                onClick={() => { setShowImport(true); setShowExport(false); setPassphrase(""); setError(""); }}
                className="flex items-center gap-1 px-2 py-1 text-[10px] bg-surface-700 rounded text-surface-400 hover:text-surface-200 transition-colors"
              >
                <Upload className="w-3 h-3" />
                Import
              </button>
              <button
                onClick={handleRegenerate}
                className="flex items-center gap-1 px-2 py-1 text-[10px] bg-surface-700 rounded text-surface-400 hover:text-orange-400 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                Regenerate
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-surface-500">
              Identity will be generated on first connection.
            </p>
            <button
              onClick={() => { setShowImport(true); setShowExport(false); setPassphrase(""); setError(""); }}
              className="flex items-center gap-1 px-2 py-1 text-[10px] bg-surface-700 rounded text-surface-400 hover:text-surface-200 transition-colors"
            >
              <Upload className="w-3 h-3" />
              Import existing identity
            </button>
          </div>
        )}

        {/* Export dialog */}
        {showExport && (
          <div className="mt-3 p-3 bg-surface-800 rounded-lg border border-surface-700 space-y-2">
            <p className="text-[10px] text-surface-400">Enter a passphrase to encrypt your identity file:</p>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleExport()}
              placeholder="Passphrase"
              className="w-full px-2.5 py-1.5 bg-surface-900 border border-surface-700 rounded text-surface-100 text-xs placeholder:text-surface-500 focus:outline-none focus:border-accent"
              autoFocus
            />
            {error && <p className="text-[10px] text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleExport}
                disabled={!passphrase.trim() || busy}
                className="px-3 py-1.5 text-[10px] font-medium bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-40 transition-colors"
              >
                {busy ? "Encrypting..." : "Download"}
              </button>
              <button
                onClick={() => { setShowExport(false); setPassphrase(""); setError(""); }}
                className="px-3 py-1.5 text-[10px] text-surface-400 hover:text-surface-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Import dialog */}
        {showImport && (
          <div className="mt-3 p-3 bg-surface-800 rounded-lg border border-surface-700 space-y-2">
            <p className="text-[10px] text-surface-400">Enter the passphrase used when exporting:</p>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Passphrase"
              className="w-full px-2.5 py-1.5 bg-surface-900 border border-surface-700 rounded text-surface-100 text-xs placeholder:text-surface-500 focus:outline-none focus:border-accent"
              autoFocus
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportFile(file);
              }}
            />
            {error && <p className="text-[10px] text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!passphrase.trim() || busy}
                className="px-3 py-1.5 text-[10px] font-medium bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-40 transition-colors"
              >
                {busy ? "Decrypting..." : "Choose file..."}
              </button>
              <button
                onClick={() => { setShowImport(false); setPassphrase(""); setError(""); }}
                className="px-3 py-1.5 text-[10px] text-surface-400 hover:text-surface-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Verified Users */}
      <div>
        <h3 className="text-sm font-semibold text-surface-200 flex items-center gap-1.5 mb-3">
          <ShieldCheck className="w-4 h-4 text-green-400" />
          Verified Users ({verifiedList.length})
        </h3>

        {verifiedList.length === 0 ? (
          <p className="text-[10px] text-surface-500">
            No verified users yet. Click on a user in the channel tree to verify them.
          </p>
        ) : (
          <div className="space-y-1">
            {verifiedList.map((v) => (
              <div key={v.publicKey} className="flex items-center justify-between p-2 bg-surface-800/40 rounded-lg group">
                <div className="flex items-center gap-2 min-w-0">
                  <ShieldCheck className="w-3 h-3 text-green-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs text-surface-300 truncate">{v.nickname}</p>
                    <p className="text-[9px] text-surface-600 font-mono">{computeFingerprint(v.publicKey)}</p>
                  </div>
                </div>
                <button
                  onClick={() => unverifyUser(v.publicKey)}
                  className="p-1 rounded text-surface-600 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all"
                  title="Remove verification"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="p-3 bg-surface-800/30 rounded-lg border border-surface-700/50">
        <p className="text-[10px] text-surface-500 leading-relaxed">
          Your identity key is stored locally on this device. It is used to verify your identity
          to other users via safety numbers. The server never sees your private key.
          Regenerating will create a new identity — other users will need to re-verify you.
        </p>
      </div>
    </div>
  );
}
