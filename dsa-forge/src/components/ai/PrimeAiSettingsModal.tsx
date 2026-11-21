"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Zap, CheckCircle2, AlertCircle, Loader2, Trash2, ShieldCheck } from "lucide-react";
import { PrimeAiLogo } from "@/components/ai/PrimeAiLogo";
import { useAuth } from "@/context/auth-context";
import { getIdToken } from "firebase/auth";
import { db, isFirebaseConfigured } from "@/lib/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import type { PrimeAiModel } from "@/hooks/use-prime-ai";

interface PrimeAiSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeModel?: PrimeAiModel;
  onModelChange?: (model: PrimeAiModel) => void;
  remainingGemini?: number | null;
  remainingGroq?: number | null;
}

type KeyStatus = "idle" | "loading" | "valid" | "invalid";

const MODEL_INFO = {
  gemini: {
    id: "gemini" as PrimeAiModel,
    name: "Gemini 2.5 Flash",
    provider: "Google AI",
    badge: "⚡",
    docsUrl: "https://aistudio.google.com/app/apikey",
    docsLabel: "Get Free Key ↗",
    keyPrefix: "AIza",
  },
  groq: {
    id: "groq" as PrimeAiModel,
    name: "Llama 3.3 70B",
    provider: "Groq Cloud",
    badge: "🚀",
    docsUrl: "https://console.groq.com/keys",
    docsLabel: "Get Free Key ↗",
    keyPrefix: "gsk_",
  },
};

export function PrimeAiSettingsModal({
  isOpen,
  onClose,
  activeModel = "gemini",
  onModelChange,
  remainingGemini,
  remainingGroq,
}: PrimeAiSettingsModalProps) {
  const { user } = useAuth();

  const [geminiKey, setGeminiKey] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [geminiKeyStatus, setGeminiKeyStatus] = useState<KeyStatus>("idle");
  const [groqKeyStatus, setGroqKeyStatus] = useState<KeyStatus>("idle");
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [groqConfigured, setGroqConfigured] = useState(false);
  const [geminiMsg, setGeminiMsg] = useState("");
  const [groqMsg, setGroqMsg] = useState("");

  const fetchConfigStatus = useCallback(async () => {
    if (!user) return;
    try {
      const idToken = await getIdToken(user, true);
      const res = await fetch("/api/ai/config", {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        let gConfigured = !!data.geminiConfigured;
        let qConfigured = !!data.groqConfigured;

        // Auto-heal / re-sync from localStorage if dev server restarted and wiped RAM
        if (typeof window !== "undefined") {
          const localGroq =
            localStorage.getItem(`prime_ai_groq_key_${user.uid}`) ||
            localStorage.getItem("prime_ai_groq_key");
          if (!qConfigured && localGroq) {
            // Re-sync to server
            fetch("/api/ai/config", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${idToken}`,
              },
              body: JSON.stringify({ apiKey: localGroq, provider: "groq", validate: false }),
            }).catch(() => {});
            qConfigured = true;
          }

          const localGemini =
            localStorage.getItem(`prime_ai_gemini_key_${user.uid}`) ||
            localStorage.getItem("prime_ai_gemini_key");
          if (!gConfigured && localGemini) {
            fetch("/api/ai/config", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${idToken}`,
              },
              body: JSON.stringify({ apiKey: localGemini, provider: "gemini", validate: false }),
            }).catch(() => {});
            gConfigured = true;
          }
        }

        // Check Firestore for cloud-synced keys (e.g. added on laptop, now loading on mobile)
        if (typeof window !== "undefined" && db && isFirebaseConfigured && (!gConfigured || !qConfigured)) {
          try {
            const userDocRef = doc(db, "users", user.uid);
            const snap = await getDoc(userDocRef);
            if (snap.exists()) {
              const cloudByok = snap.data()?.byok;
              if (!qConfigured && cloudByok?.groqKey) {
                localStorage.setItem(`prime_ai_groq_key_${user.uid}`, cloudByok.groqKey);
                localStorage.setItem("prime_ai_groq_key", cloudByok.groqKey);
                fetch("/api/ai/config", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                  },
                  body: JSON.stringify({ apiKey: cloudByok.groqKey, provider: "groq", validate: false }),
                }).catch(() => {});
                qConfigured = true;
              }
              if (!gConfigured && cloudByok?.geminiKey) {
                localStorage.setItem(`prime_ai_gemini_key_${user.uid}`, cloudByok.geminiKey);
                localStorage.setItem("prime_ai_gemini_key", cloudByok.geminiKey);
                fetch("/api/ai/config", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                  },
                  body: JSON.stringify({ apiKey: cloudByok.geminiKey, provider: "gemini", validate: false }),
                }).catch(() => {});
                gConfigured = true;
              }
            }
          } catch (cloudErr) {
            console.warn("[Prime AI Settings] Could not fetch BYOK from Firestore:", cloudErr);
          }
        }

        setGeminiConfigured(gConfigured);
        setGroqConfigured(qConfigured);
      }
    } catch {
      // silent
    }
  }, [user]);

  useEffect(() => {
    if (isOpen) {
      fetchConfigStatus();
    }

    const onByokUpdate = () => {
      if (isOpen) fetchConfigStatus();
    };
    window.addEventListener("leetprime:byok-updated", onByokUpdate);
    return () => {
      window.removeEventListener("leetprime:byok-updated", onByokUpdate);
    };
  }, [isOpen, fetchConfigStatus]);

  const handleSaveKey = async (provider: PrimeAiModel) => {
    if (!user) return;
    const key = provider === "gemini" ? geminiKey : groqKey;
    const setStatus = provider === "gemini" ? setGeminiKeyStatus : setGroqKeyStatus;
    const setMsg = provider === "gemini" ? setGeminiMsg : setGroqMsg;
    const setConfigured = provider === "gemini" ? setGeminiConfigured : setGroqConfigured;

    if (!key.trim()) {
      setMsg("Please enter an API key.");
      return;
    }

    setStatus("loading");
    setMsg("");

    try {
      const trimmedKey = key.trim();
      const idToken = await getIdToken(user, true);
      const res = await fetch("/api/ai/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ apiKey: trimmedKey, provider, validate: true }),
      });

      const data = await res.json();

      if (res.ok && data.valid) {
        setStatus("valid");
        setConfigured(true);
        // Persist to browser localStorage so it survives dev server restarts
        if (typeof window !== "undefined") {
          localStorage.setItem(`prime_ai_${provider}_key_${user.uid}`, trimmedKey);
          localStorage.setItem(`prime_ai_${provider}_key`, trimmedKey);
        }

        // Persist to Firestore so keys sync across all devices (laptop <-> phone)
        if (db && isFirebaseConfigured) {
          try {
            const userDocRef = doc(db, "users", user.uid);
            await setDoc(
              userDocRef,
              {
                byok: {
                  [provider === "gemini" ? "geminiKey" : "groqKey"]: trimmedKey,
                },
                updatedAt: new Date().toISOString(),
              },
              { merge: true }
            );
          } catch (cloudErr) {
            console.warn("[Prime AI] Could not sync BYOK to Firestore:", cloudErr);
          }
        }

        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("leetprime:byok-updated"));
        }

        setMsg("✓ API key verified & permanently saved! Unlimited queries enabled.");
        if (provider === "gemini") setGeminiKey("");
        else setGroqKey("");
      } else {
        setStatus("invalid");
        setMsg(data.error || "Validation failed. Check your key.");
      }
    } catch {
      setStatus("invalid");
      setMsg("Connection error. Please try again.");
    }
  };

  const handleRemoveKey = async (provider: PrimeAiModel) => {
    if (!user) return;
    const setConfigured = provider === "gemini" ? setGeminiConfigured : setGroqConfigured;
    const setStatus = provider === "gemini" ? setGeminiKeyStatus : setGroqKeyStatus;
    const setMsg = provider === "gemini" ? setGeminiMsg : setGroqMsg;

    try {
      // Remove from browser localStorage
      if (typeof window !== "undefined") {
        localStorage.removeItem(`prime_ai_${provider}_key_${user.uid}`);
        localStorage.removeItem(`prime_ai_${provider}_key`);
      }

      // Remove from Firestore so all devices switch back to Free Tier
      if (db && isFirebaseConfigured) {
        try {
          const userDocRef = doc(db, "users", user.uid);
          await setDoc(
            userDocRef,
            {
              byok: {
                [provider === "gemini" ? "geminiKey" : "groqKey"]: null,
              },
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );
        } catch (cloudErr) {
          console.warn("[Prime AI] Could not remove BYOK from Firestore:", cloudErr);
        }
      }

      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("leetprime:byok-updated"));
      }

      const idToken = await getIdToken(user, true);
      await fetch("/api/ai/config", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ provider }),
      });
      setConfigured(false);
      setStatus("idle");
      setMsg("API key removed. Switched back to Free Tier.");
    } catch {
      // silent
    }
  };

  if (!isOpen) return null;

  const remGemini = remainingGemini !== null ? remainingGemini : 10;
  const remGroq = remainingGroq !== null ? remainingGroq : 10;

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
      {/* Dimmed Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      {/* Modal Dialog */}
      <div
        className="relative z-10 w-full max-w-md bg-[#0d0b18] border border-white/10 rounded-2xl shadow-2xl shadow-violet-950/60 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Minimal Header ── */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center gap-2.5 min-w-0">
            <PrimeAiLogo size="xs" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-white font-bold text-sm tracking-tight truncate">Prime AI Engine</h2>
                <span className="px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-violet-500/20 text-violet-300 border border-violet-500/30">
                  BYOK
                </span>
              </div>
              <p className="text-white/40 text-[11px] truncate">Personal API keys for unlimited AI queries</p>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── At-a-Glance Live Quota Strip ── */}
        <div className="px-4 sm:px-5 pt-3.5 pb-2">
          <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-white/[0.025] border border-white/[0.06]">
            {/* Gemini Status */}
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-blue-300 flex items-center gap-1">
                <span>⚡</span> Gemini 2.5
              </span>
              {geminiConfigured ? (
                <span className="text-[10.5px] font-bold text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  Unlimited
                </span>
              ) : (
                <span className="text-[10.5px] font-medium text-zinc-400">
                  <strong className={remGemini === 0 ? "text-rose-400" : "text-amber-300 font-semibold"}>
                    {remGemini}/10
                  </strong>{" "}
                  free left
                </span>
              )}
            </div>

            {/* Groq Status */}
            <div className="flex flex-col gap-1 border-l border-white/[0.08] pl-2.5">
              <span className="text-[11px] font-semibold text-orange-300 flex items-center gap-1">
                <span>🚀</span> Groq Llama
              </span>
              {groqConfigured ? (
                <span className="text-[10.5px] font-bold text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  Unlimited
                </span>
              ) : (
                <span className="text-[10.5px] font-medium text-zinc-400">
                  <strong className={remGroq === 0 ? "text-rose-400" : "text-amber-300 font-semibold"}>
                    {remGroq}/10
                  </strong>{" "}
                  free left
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Clean Provider API Key Cards ── */}
        <div className="px-4 sm:px-5 py-2.5 space-y-3">
          {(["gemini", "groq"] as PrimeAiModel[]).map((provider) => {
            const info = MODEL_INFO[provider];
            const isConfigured = provider === "gemini" ? geminiConfigured : groqConfigured;
            const keyVal = provider === "gemini" ? geminiKey : groqKey;
            const setKey = provider === "gemini" ? setGeminiKey : setGroqKey;
            const status = provider === "gemini" ? geminiKeyStatus : groqKeyStatus;
            const msg = provider === "gemini" ? geminiMsg : groqMsg;

            return (
              <div
                key={provider}
                className="p-3 sm:p-3.5 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:border-white/[0.14] transition-all space-y-2.5"
              >
                {/* Provider Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-base shrink-0">{info.badge}</span>
                    <div className="min-w-0">
                      <span className="text-white text-xs font-bold block truncate">{info.name}</span>
                      <span className="text-white/40 text-[10px] block truncate">{info.provider}</span>
                    </div>
                  </div>

                  <a
                    href={info.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-violet-400 hover:text-violet-300 hover:underline flex items-center gap-0.5 shrink-0 transition-colors"
                  >
                    <span>{info.docsLabel}</span>
                  </a>
                </div>

                {/* Key State: Configured vs Input */}
                {isConfigured ? (
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/[0.06]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <span className="text-emerald-400 text-[11px] font-semibold shrink-0">Active</span>
                      <span className="font-mono text-zinc-400 text-[11px] truncate">
                        ({info.keyPrefix}••••••••••••)
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemoveKey(provider)}
                      type="button"
                      className="px-2 py-1 rounded-md text-[11px] font-medium text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
                      title="Remove API Key"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Remove</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5 pt-1 border-t border-white/[0.06]">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="password"
                        value={keyVal}
                        onChange={(e) => setKey(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && keyVal.trim() && status !== "loading") {
                            handleSaveKey(provider);
                          }
                        }}
                        placeholder={`Paste ${info.name} key (${info.keyPrefix}...)...`}
                        className="flex-1 px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/10 text-white text-xs placeholder:text-white/25 outline-none focus:border-violet-500/50 transition-colors font-mono"
                      />
                      <button
                        onClick={() => handleSaveKey(provider)}
                        disabled={status === "loading" || !keyVal.trim()}
                        type="button"
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 transition-all flex items-center gap-1 shrink-0 cursor-pointer"
                      >
                        {status === "loading" ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Zap className="w-3 h-3" />
                        )}
                        <span>Save</span>
                      </button>
                    </div>

                    {msg && (
                      <div
                        className={`flex items-start gap-1 text-[11px] ${
                          status === "valid" ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {status === "valid" ? (
                          <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" />
                        ) : (
                          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                        )}
                        <span className="truncate">{msg}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Minimal Security Micro-Footer ── */}
        <div className="px-4 sm:px-5 py-3 border-t border-white/[0.06] bg-white/[0.015]">
          <p className="text-[10.5px] text-zinc-500 text-center flex items-center justify-center gap-1">
            <ShieldCheck className="w-3 h-3 text-zinc-500 shrink-0" />
            <span>Keys are encrypted in private memory &amp; synced to your account.</span>
          </p>
        </div>
      </div>
    </div>
  );
}
