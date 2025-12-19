import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Trophy, Mic, LogOut, CheckCircle, Sparkles, 
  ChevronRight, Activity, Flame
} from 'lucide-react';
import { GoogleGenAI, Modality, Blob, LiveServerMessage } from "@google/genai";

/**
 * 1. ENVIRONMENT & STORAGE
 */
// Ensure process.env is safely polyfilled for the browser
if (typeof window !== 'undefined') {
  (window as any).process = (window as any).process || { env: {} };
}

const STORAGE_KEYS = { USERS: 'lords_lab_v6_users' };
const getStorage = (k: string) => {
  try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; }
};
const saveStorage = (k: string, v: any) => localStorage.setItem(k, JSON.stringify(v));

/**
 * 2. AI VOICE LOGIC (GEMINI LIVE)
 */
let nextStartTime = 0;
let inputAudioContext: AudioContext | null = null;
let outputAudioContext: AudioContext | null = null;
const audioSources = new Set<AudioBufferSourceNode>();
let micStream: MediaStream | null = null;

const encodePCM = (data: Float32Array): Blob => {
  const int16 = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) int16[i] = data[i] * 32768;
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return { data: btoa(binary), mimeType: 'audio/pcm;rate=16000' };
};

const decodePCM = async (base64: string, ctx: AudioContext) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const data16 = new Int16Array(bytes.buffer);
  const buffer = ctx.createBuffer(1, data16.length, 24000);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < data16.length; i++) channelData[i] = data16[i] / 32768.0;
  return buffer;
};

const startVoiceLab = async (onTranscription: (text: string, isUser: boolean) => void, onEnd: (err?: string) => void) => {
  const apiKey = (process.env as any).API_KEY;
  if (!apiKey) return onEnd("API_KEY Missing.");

  const ai = new GoogleGenAI({ apiKey });
  inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
  outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    return onEnd("Mic access denied.");
  }

  const sessionPromise = ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-09-2025',
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } } },
      systemInstruction: 'You are the Durham Lords Coach. Be intense, brief. Use sports metaphors. Max 2 sentences.',
    },
    callbacks: {
      onopen: () => {
        if (!inputAudioContext || !micStream) return;
        const source = inputAudioContext.createMediaStreamSource(micStream);
        const processor = inputAudioContext.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (e) => {
          const blob = encodePCM(e.inputBuffer.getChannelData(0));
          sessionPromise.then(s => s.sendRealtimeInput({ media: blob }));
        };
        source.connect(processor);
        processor.connect(inputAudioContext.destination);
      },
      onmessage: async (msg: LiveServerMessage) => {
        const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
        if (audioData && outputAudioContext) {
          nextStartTime = Math.max(nextStartTime, outputAudioContext.currentTime);
          const buffer = await decodePCM(audioData, outputAudioContext);
          const source = outputAudioContext.createBufferSource();
          source.buffer = buffer;
          source.connect(outputAudioContext.destination);
          source.start(nextStartTime);
          nextStartTime += buffer.duration;
          audioSources.add(source);
        }
      },
      onerror: (e) => onEnd("Uplink lost."),
      onclose: () => onEnd()
    }
  });
};

const stopVoiceLab = () => {
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  if (inputAudioContext) inputAudioContext.close().catch(() => {});
  if (outputAudioContext) outputAudioContext.close().catch(() => {});
  audioSources.forEach(s => { try { s.stop(); } catch {} });
  audioSources.clear();
  nextStartTime = 0;
};

/**
 * 3. MAIN UI
 */
const Card = ({ children, className = "" }: { children: React.ReactNode, className?: string }) => (
  <div className={`glass-card rounded-[2rem] p-6 shadow-xl ${className}`}>{children}</div>
);

const App = () => {
  const [screen, setScreen] = useState<'LOGIN' | 'ATHLETE' | 'VOICE' | 'COACH'>('LOGIN');
  const [user, setUser] = useState<any>(null);
  const [metrics, setMetrics] = useState({ effort: 3, attitude: 3 });
  const [insight, setInsight] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Reveal app
    const loader = document.getElementById('loading-overlay');
    if (loader) loader.style.display = 'none';
  }, []);

  const handleLogin = (name: string, jersey: string, role: string) => {
    const users = getStorage(STORAGE_KEYS.USERS);
    let u = users.find((curr: any) => curr.jersey === jersey);
    if (!u) {
      u = { name, jersey, role, points: 0, streak: 1 };
      users.push(u);
      saveStorage(STORAGE_KEYS.USERS, users);
    }
    setUser(u);
    setScreen(role === 'COACH' ? 'COACH' : 'ATHLETE');
  };

  const generateInsight = async () => {
    const apiKey = (process.env as any).API_KEY;
    if (!apiKey) { setInsight("API_KEY missing."); return; }
    setLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey });
      const res = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Durham Lords Athletics. Leadership tip for effort ${metrics.effort}/5. Max 1 sentence.`
      });
      setInsight(res.text || "Hold the standard.");
    } catch {
      setInsight("Winning is a habit. Choose yours.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex flex-col max-w-md mx-auto relative overflow-hidden">
      
      {screen === 'LOGIN' && (
        <div className="flex-1 flex flex-col justify-center p-8 z-10 space-y-10">
          <div className="text-center">
            <h1 className="text-6xl font-black italic tracking-tighter text-white">LORDS<span className="text-green-500">LAB</span></h1>
            <p className="text-slate-500 font-bold uppercase tracking-[0.4em] text-[10px] mt-2">Elite Leadership Protocol</p>
          </div>
          <Card className="space-y-4">
            <input id="ln" placeholder="Athlete Surname" className="w-full bg-slate-950/50 border border-slate-800 rounded-2xl p-5 outline-none focus:border-green-500 text-white font-bold" />
            <input id="jn" placeholder="Jersey #" className="w-full bg-slate-950/50 border border-slate-800 rounded-2xl p-5 outline-none focus:border-green-500 text-white font-bold" />
            <div className="flex gap-2 p-1 bg-slate-900 rounded-2xl border border-slate-800" id="role_sel">
              <button onClick={(e) => {
                const p = e.currentTarget.parentElement!;
                Array.from(p.children).forEach(c => c.classList.remove('bg-green-600', 'text-white'));
                e.currentTarget.classList.add('bg-green-600', 'text-white');
                p.dataset.role = 'ATHLETE';
              }} className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase bg-green-600 text-white">Athlete</button>
              <button onClick={(e) => {
                const p = e.currentTarget.parentElement!;
                Array.from(p.children).forEach(c => c.classList.remove('bg-green-600', 'text-white'));
                e.currentTarget.classList.add('bg-green-600', 'text-white');
                p.dataset.role = 'COACH';
              }} className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase text-slate-400">Coach</button>
            </div>
            <button 
              onClick={() => {
                const n = (document.getElementById('ln') as HTMLInputElement).value;
                const j = (document.getElementById('jn') as HTMLInputElement).value;
                const r = (document.getElementById('role_sel') as HTMLElement).dataset.role || 'ATHLETE';
                if(n && j) handleLogin(n, j, r);
              }}
              className="w-full py-5 bg-green-600 hover:bg-green-500 text-white font-black rounded-[2rem] shadow-lg neon-glow transition-all active:scale-95 mt-4"
            >
              INITIALIZE PROTOCOL
            </button>
          </Card>
        </div>
      )}

      {screen === 'ATHLETE' && user && (
        <div className="flex-1 p-6 space-y-6 overflow-y-auto pb-32 z-10">
          <header className="flex justify-between items-center py-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-green-600 rounded-2xl flex items-center justify-center font-black text-white shadow-xl italic">#{user.jersey}</div>
              <div>
                <p className="text-2xl font-black italic text-white uppercase tracking-tighter">{user.name}</p>
                <div className="flex items-center gap-1 text-[9px] font-black text-green-500 uppercase">
                  <Flame size={10} fill="currentColor"/> {user.streak} Day Streak
                </div>
              </div>
            </div>
            <button onClick={() => setScreen('LOGIN')} className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800 text-slate-500 hover:text-white transition-colors"><LogOut size={18}/></button>
          </header>

          <Card className="bg-gradient-to-br from-green-600/10 to-transparent border-green-500/20">
            <div className="flex items-center gap-2 mb-3 text-green-400 font-black text-[10px] uppercase tracking-[0.2em]">
              <Sparkles size={14}/> Daily Insight
            </div>
            {insight ? (
              <p className="text-lg font-bold italic leading-tight text-white border-l-2 border-green-500 pl-4 py-1">"{insight}"</p>
            ) : (
              <button onClick={generateInsight} className="w-full py-4 text-[11px] text-green-500 font-black uppercase tracking-widest bg-green-500/5 rounded-2xl border border-green-500/10 hover:bg-green-500/10 transition-all">
                {loading ? 'Analyzing...' : 'Sync Insight'}
              </button>
            )}
          </Card>

          <Card className="space-y-10 py-8">
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Effort Output</span>
                <span className="text-4xl font-black text-green-500 italic tabular-nums">{metrics.effort}</span>
              </div>
              <input type="range" min="1" max="5" step="0.5" value={metrics.effort} onChange={e => setMetrics({...metrics, effort: parseFloat(e.target.value)})} className="w-full appearance-none h-2 bg-slate-950 rounded-full accent-green-500" />
            </div>
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Elite Attitude</span>
                <span className="text-4xl font-black text-yellow-500 italic tabular-nums">{metrics.attitude}</span>
              </div>
              <input type="range" min="1" max="5" step="0.5" value={metrics.attitude} onChange={e => setMetrics({...metrics, attitude: parseFloat(e.target.value)})} className="w-full appearance-none h-2 bg-slate-950 rounded-full accent-yellow-500" />
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-4">
            <button onClick={() => alert("Locked In.")} className="h-32 bg-green-600 rounded-[2.5rem] font-black text-white flex flex-col items-center justify-center gap-2 shadow-xl neon-glow active:scale-95 transition-all">
              <CheckCircle size={32}/>
              <span className="text-[10px] uppercase tracking-widest">Lock In</span>
            </button>
            <button onClick={() => setScreen('VOICE')} className="h-32 bg-slate-900 border border-slate-800 rounded-[2.5rem] font-black text-white flex flex-col items-center justify-center gap-2 active:scale-95 transition-all">
              <Mic size={32} className="text-green-500"/>
              <span className="text-[10px] uppercase tracking-widest">Voice Lab</span>
            </button>
          </div>
        </div>
      )}

      {screen === 'VOICE' && (
        <div className="flex-1 bg-black flex flex-col items-center justify-center p-8 text-center space-y-12 z-20">
          <div className="relative">
            <div className="absolute inset-0 bg-green-500/10 blur-[100px] animate-pulse rounded-full"></div>
            <div className="w-56 h-56 rounded-full border border-green-500/20 flex items-center justify-center relative bg-slate-900/30">
              <Mic size={80} className="text-green-500 drop-shadow-[0_0_20px_rgba(34,197,94,0.6)]" />
            </div>
          </div>
          <button onClick={() => { stopVoiceLab(); setScreen('ATHLETE'); }} className="w-full py-6 bg-slate-900 border border-slate-800 rounded-[2rem] text-slate-400 font-black uppercase text-xs tracking-widest hover:text-white transition-all">
            Terminate Session
          </button>
        </div>
      )}

      {screen === 'COACH' && (
        <div className="flex-1 p-6 space-y-8 overflow-y-auto pb-32 z-10">
          <header className="flex justify-between items-center py-4">
            <h1 className="text-3xl font-black italic text-white uppercase tracking-tighter">COACH<span className="text-green-500">LAB</span></h1>
            <button onClick={() => setScreen('LOGIN')} className="p-4 rounded-2xl bg-slate-900 border border-slate-800 text-slate-500"><LogOut size={18}/></button>
          </header>
          
          <Card className="p-0 overflow-hidden divide-y divide-slate-800/30">
            {getStorage(STORAGE_KEYS.USERS).map((u: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-6">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center font-black text-slate-600 border border-slate-800 italic">#{u.jersey}</div>
                  <span className="font-bold text-lg uppercase italic">{u.name}</span>
                </div>
                <div className="text-right">
                  <p className="font-black text-green-400 text-xl leading-none">{u.points}</p>
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
};

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}

