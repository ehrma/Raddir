import { useState, useEffect } from "react";
import { useServerStore } from "../stores/serverStore";
import { useVerificationStore } from "../stores/verificationStore";
import { computeSafetyNumber, computeFingerprint, getStoredIdentityPublicKey } from "../lib/e2ee/identity";
import { ShieldCheck, ShieldX, Copy, X } from "lucide-react";
import type { SessionInfo } from "@raddir/shared";

interface Props {
  user: SessionInfo;
  onClose: () => void;
}

export function VerifyUserDialog({ user, onClose }: Props) {
  const myPublicKey = getStoredIdentityPublicKey();
  const { isVerified, verifyUser, unverifyUser } = useVerificationStore();
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const verified = user.publicKey ? isVerified(user.publicKey) : false;

  useEffect(() => {
    if (myPublicKey && user.publicKey) {
      computeSafetyNumber(myPublicKey, user.publicKey).then(setSafetyNumber);
    }
  }, [myPublicKey, user.publicKey]);

  const handleCopy = () => {
    if (safetyNumber) {
      navigator.clipboard.writeText(safetyNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleVerify = () => {
    if (user.publicKey) {
      verifyUser(user.publicKey, user.nickname);
      onClose();
    }
  };

  const handleUnverify = () => {
    if (user.publicKey) {
      unverifyUser(user.publicKey);
      onClose();
    }
  };

  const theirFingerprint = user.publicKey ? computeFingerprint(user.publicKey) : null;
  const myFingerprint = myPublicKey ? computeFingerprint(myPublicKey) : null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-surface-900 rounded-xl border border-surface-700 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-800">
          <h2 className="text-sm font-semibold text-surface-200 flex items-center gap-2">
            {verified ? (
              <ShieldCheck className="w-4 h-4 text-green-400" />
            ) : (
              <ShieldX className="w-4 h-4 text-surface-400" />
            )}
            Verify {user.nickname}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {!user.publicKey ? (
            <p className="text-xs text-surface-500">
              This user has no identity key. They cannot be verified.
            </p>
          ) : !myPublicKey ? (
            <p className="text-xs text-surface-500">
              You don't have an identity key yet. Connect to a server first.
            </p>
          ) : (
            <>
              {/* Safety number */}
              <div className="text-center">
                <p className="text-[10px] text-surface-500 mb-2">Safety Number</p>
                <div className="inline-flex items-center gap-2 px-4 py-2.5 bg-surface-800 rounded-lg border border-surface-700">
                  <span className="text-lg font-mono font-bold text-surface-100 tracking-[0.2em]">
                    {safetyNumber ?? "..."}
                  </span>
                  <button
                    onClick={handleCopy}
                    className="p-1 rounded text-surface-500 hover:text-surface-300 transition-colors"
                    title="Copy safety number"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
                {copied && <p className="text-[10px] text-accent mt-1">Copied!</p>}
              </div>

              {/* Instructions */}
              <div className="p-3 bg-surface-800/30 rounded-lg border border-surface-700/50">
                <p className="text-[10px] text-surface-400 leading-relaxed">
                  Ask <strong className="text-surface-300">{user.nickname}</strong> to open your profile and read their safety number.
                  If both numbers match, you can be sure you're talking to the right person.
                  Share this number via a trusted channel (Signal, SMS, in person).
                </p>
              </div>

              {/* Fingerprints */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-2 bg-surface-800/40 rounded-lg">
                  <p className="text-[9px] text-surface-500 mb-1">Your fingerprint</p>
                  <p className="text-[10px] font-mono text-surface-400">{myFingerprint}</p>
                </div>
                <div className="p-2 bg-surface-800/40 rounded-lg">
                  <p className="text-[9px] text-surface-500 mb-1">Their fingerprint</p>
                  <p className="text-[10px] font-mono text-surface-400">{theirFingerprint}</p>
                </div>
              </div>

              {/* Actions */}
              {verified ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 p-2 bg-green-500/10 border border-green-500/20 rounded-lg">
                    <ShieldCheck className="w-4 h-4 text-green-400 flex-shrink-0" />
                    <p className="text-[10px] text-green-400">
                      You have verified this user's identity.
                    </p>
                  </div>
                  <button
                    onClick={handleUnverify}
                    className="w-full py-2 rounded-lg text-xs font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors"
                  >
                    Remove Verification
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleVerify}
                  className="w-full py-2.5 rounded-lg text-xs font-medium bg-green-600 text-white hover:bg-green-500 transition-colors"
                >
                  Mark as Verified
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
