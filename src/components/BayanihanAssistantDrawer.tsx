import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  MessageSquare,
  Phone,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { EMERGENCY_HOTLINES } from '../data/seedData';
import type {
  Advisory,
  AssistantMessage,
  EvacuationCenter,
  HazardReport,
} from '../types/alert';
import { safeFetchJson } from '../utils/apiClient';
import { buildSafeTelHref, formatClockTime } from '../utils/formatters';

interface BayanihanAssistantDrawerProps {
  reports: HazardReport[];
  centers: EvacuationCenter[];
  advisories: Advisory[];
  isOffline: boolean;
  selectedLocationLabel?: string;
}

const STARTER_PROMPTS = [
  'Saan pinakamalapit na bukas na evacuation center?',
  'Passable ba sa Commonwealth / Araneta Ave ngayon?',
  'Ano dapat ihanda sa Go-Bag?',
  'Kailangan namin ng rescue / tumataas ang baha sa amin!',
];

function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

const INITIAL_ASSISTANT_MESSAGE: AssistantMessage = {
  id: 'welcome-msg',
  role: 'assistant',
  text: 'Kumusta! Ako ang Bayanihan Assistant. Pwede kang magtanong sa Tagalog, Taglish, o English tungkol sa bukas na evacuation centers, passable roads, PAGASA updates, o Go-Bag preparation. Inuuna ko ang verified barangay/LGU alerts.',
  createdAt: new Date().toISOString(),
};

export function BayanihanAssistantDrawer({
  reports,
  centers,
  advisories,
  isOffline,
  selectedLocationLabel = 'Quezon City / Metro Manila',
}: BayanihanAssistantDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([
    INITIAL_ASSISTANT_MESSAGE,
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  async function sendMessageText(rawText: string) {
    const text = rawText.trim();
    if (!text || sending) return;

    setError(null);
    const userMsg: AssistantMessage = {
      id: `user-${Date.now().toString(36)}`,
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput('');

    if (isOffline) {
      const openCenters = centers
        .filter((c) => c.status === 'Open' || c.status === 'Near Full')
        .slice(0, 3)
        .map((c) => `• ${c.name} (${c.barangay}, ${c.status}: ${c.current_occupancy}/${c.max_capacity})`)
        .join('\n');

      setMessages((prev) => [
        ...prev,
        {
          id: `offline-${Date.now().toString(36)}`,
          role: 'assistant',
          text: `Offline ka ngayon, kaya hindi makakonekta sa live AI/Search. Base sa huling cached shelters:\n${openCenters || '• Tingnan ang Evacuation Centers tab.'}\n\nKung may agarang panganib o kailangan ng rescue, tumawag agad sa mga hotline sa ibaba.`,
          createdAt: new Date().toISOString(),
          needsEmergencyHotlines: true,
        },
      ]);
      return;
    }

    setSending(true);
    try {
      const payloadMessages = nextHistory
        .filter((m) => m.id !== 'welcome-msg')
        .map((m) => ({
          role: m.role,
          text: m.text,
        }));

      const data = await safeFetchJson<{
        reply?: string;
        sources?: Array<{ title: string; url: string }>;
        needsEmergencyHotlines?: boolean;
        generatedAt?: string;
      }>('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: payloadMessages,
          context: {
            location: selectedLocationLabel,
            advisories: advisories.slice(0, 6),
            centers: centers.slice(0, 14),
            reports: reports.filter((r) => r.status !== 'dismissed').slice(0, 18),
          },
        }),
      });

      const assistantMsg: AssistantMessage = {
        id: `asst-${Date.now().toString(36)}`,
        role: 'assistant',
        text: data.reply || 'Unable to generate response.',
        createdAt: data.generatedAt || new Date().toISOString(),
        sources: Array.isArray(data.sources)
          ? data.sources.filter((s) => s?.url && isSafeHttpUrl(s.url))
          : [],
        needsEmergencyHotlines: Boolean(data.needsEmergencyHotlines),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Hindi maabot ang Bayanihan Assistant ngayon.'
      );
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void sendMessageText(input);
  }

  const emergencyQuickButtons = [
    EMERGENCY_HOTLINES[0], // 911
    EMERGENCY_HOTLINES[3], // NDRRMC
    EMERGENCY_HOTLINES[2], // Red Cross 143
  ];

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Open Bayanihan Assistant chat"
          className="fixed right-4 bottom-4 z-40 inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-slate-800 sm:right-6 sm:bottom-6"
        >
          <MessageSquare className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Bayanihan Assistant</span>
        </button>
      )}

      {isOpen && (
        <aside
          aria-label="Bayanihan AI Assistant Chat Drawer"
          className="fixed inset-x-0 bottom-0 z-50 flex h-[82vh] flex-col border-t border-slate-300 bg-white shadow-2xl sm:inset-x-auto sm:right-5 sm:bottom-5 sm:h-[600px] sm:w-[420px] sm:rounded-xl sm:border"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-900 px-4 py-3 text-white sm:rounded-t-xl">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                <h2 className="font-display truncate text-sm font-bold">
                  Bayanihan Assistant
                </h2>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-slate-300">
                Grounded in live Supabase alerts, shelters &amp; PAGASA/LGU search
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close Bayanihan Assistant"
              className="cursor-pointer rounded-md p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {/* Starter Prompts */}
          <div className="flex gap-1.5 overflow-x-auto border-b border-slate-100 bg-slate-50 px-3 py-2">
            {STARTER_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={sending}
                onClick={() => void sendMessageText(prompt)}
                className="shrink-0 cursor-pointer rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-100 disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>

          {/* Conversation Thread */}
          <div className="flex-1 space-y-3 overflow-y-auto p-3.5 text-xs sm:text-sm">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.role === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div
                  className={`max-w-[90%] rounded-lg px-3.5 py-2.5 whitespace-pre-line leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-200 bg-slate-50 text-slate-900'
                  }`}
                >
                  <p>{msg.text}</p>

                  {msg.needsEmergencyHotlines && (
                    <div className="mt-3 space-y-2 border-t border-red-200 pt-2.5">
                      <p className="flex items-center gap-1.5 text-[11px] font-bold text-red-700">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>One-Tap Emergency Dispatch Hotlines</span>
                      </p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {emergencyQuickButtons.map((hl) => (
                          <a
                            key={hl.id}
                            href={buildSafeTelHref(hl.number)}
                            className="flex flex-col rounded border border-red-200 bg-red-50 px-2 py-1.5 text-center transition-colors hover:bg-red-100"
                          >
                            <span className="truncate text-[10px] font-semibold text-red-900">
                              {hl.shortLabel}
                            </span>
                            <span className="mt-0.5 inline-flex items-center justify-center gap-1 font-mono text-[11px] font-bold tabular-nums text-red-700">
                              <Phone className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                              <span className="truncate">{hl.number}</span>
                            </span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2.5 space-y-1 border-t border-slate-200 pt-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Sources
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.sources.slice(0, 4).map((src) => (
                          <a
                            key={src.url}
                            href={src.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                          >
                            <span className="max-w-[160px] truncate">{src.title}</span>
                            <ExternalLink className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <span className="mt-1 font-mono text-[10px] tabular-nums text-slate-400">
                  {formatClockTime(msg.createdAt)}
                </span>
              </div>
            ))}

            {sending && (
              <div className="flex items-start">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Checking verified alerts and PAGASA/LGU updates...
                </div>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
              >
                {error}
              </div>
            )}

            <div ref={threadEndRef} />
          </div>

          {/* Input Bar */}
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 border-t border-slate-200 bg-white p-3 sm:rounded-b-xl"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask in English, Tagalog, or Taglish..."
              aria-label="Ask Bayanihan Assistant"
              maxLength={1000}
              disabled={sending}
              className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none sm:text-sm"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send message"
              className="inline-flex cursor-pointer items-center justify-center rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>
        </aside>
      )}
    </>
  );
}
