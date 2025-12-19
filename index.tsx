import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Trophy, Mic, LogOut, CheckCircle, Sparkles, 
  Zap, Shield, BarChart3, Users, ChevronRight, Activity
} from 'lucide-react';
import { GoogleGenAI, Modality, Blob, LiveServerMessage } from "@google/genai";

/** 
 * POLYFILLS & ENVIRONMENT
 */
if (typeof window !== 'undefined' && !window.process) {
  (window as any).process = { env: { API_KEY: (window as any).API_KEY || '' } };
}

// --- STORAGE ENGINE ---
const KEYS = { USERS: 'lords_final_users', LOGS: 'lords_final_logs' };
const getStorage = (k: string) => JSON.parse(localStorage.getItem(k) || '[]');
const setStorage = (k: string, v: any) => localStorage.setItem(k, JSON.stringify(v));

/**
 * AI VOICE ENGINE (LIVE API)
 */
let nextStartTime = 0;
let inputCtx: AudioContext | null = null;
let outputCtx: AudioContext | null = null;
const activeSources = new Set<AudioBufferSourceNode>();
let stream: MediaStream | null = null;

function createAudioBlob(data: Float32Array): Blob {
  const int16 = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) int16[i] = data[i] * 32768;
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return { data: btoa(binary), mimeType: 'audio/pcm;rate=16000' };
}

async function decodeAudio(base64: string, ctx: AudioContext) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const data16 = new Int16Array(bytes.buffer);
  const buffer = ctx.createBuffer(1, data16.length, 24000);
  const chData = buffer.getChannelData(0);
  for (let i = 0; i < data16.length; i++) chData[i] = data16[i] / 32768.0;
  return buffer;
}

const startVoiceLab = async (onChat: (text: string, isU: boolean) => void, onError: (e: Error) => void) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  inputCtx = new AudioContext({ sampleRate: 16000 });
  outputCtx = new AudioContext({ sampleRate: 24000 });
  
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } 
  catch (e) { onError(new Error("Microphone Access Denied.")); return; }

  const sessionPromise = ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-09-2025',
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } } },
      systemInstruction: 'You are the Elite Performance Coach for the Durham Lords. Your tone is direct, brief, and intense. Focus on leadership habits and the standard of excellence. Max 2 sentences.',
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
    callbacks: {
      onopen: () => {
        if (!inputCtx || !stream) return;
        const source = inputCtx.createMediaStreamSource(stream);
        const proc = inputCtx.createScriptProcessor(4096, 1, 1);
        proc.onaudioprocess = (e) => {
          const blob = createAudioBlob(e.inputBuffer.getChannelData(0));
          sessionPromise.then(s => s.sendRealtimeInput({ media: blob }));
        };
        source.connect(proc);
        proc.connect(inputCtx.destination);
      },
      onmessage: async (msg: LiveServerMessage) => {
        if (msg.serverContent?.outputTranscription) onChat(msg.serverContent.outputTranscription.text, false);
        else if (msg.serverContent?.inputTranscription) onChat(msg.serverContent.inputTranscription.text, true);
        
        const audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
        if (audio && outputCtx) {
          nextStartTime = Math.max(nextStartTime, outputCtx.currentTime);
          const buf = await decodeAudio(audio, outputCtx);
          const source = outputCtx.createBufferSource();
          source.buffer = buf;
          source.connect(outputCtx.destination);
          source.start(nextStartTime);
          nextStartTime += buf.duration;
          activeSources.add(source);
        }
      },
      onerror: (e) => onError(new Error("Session Connection Error.")),
    }
  });
};

const stopVoiceLab = () => {
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (inputCtx) inputCtx.close();
  if (outputCtx) outputCtx.close();
  activeSources.forEach(s => { try { s.stop(); } catch(e) {} });
  activeSources.clear();
  nextStartTime = 0;
};

/**
 * UI COMPONENTS
 */
const Card = ({ children, className = "" }: any) => (
  <div className={`glass-card rounded-[2.5rem] p-8 shadow-2xl ${className}`}>{children}</div>
);

const App = () => {
  const [screen, setScreen] = useState<'LOGIN' | 'ATHLETE' | 'VOICE' | 'COACH'>('LOGIN');
  const [user, setUser] = useState<any>(null);
  const [metrics, setMetrics] = useState({ effort: 3, attitude: 3 });
  const [insight, setInsight] = useState("");
  const [loading, setLoading] = useState(false);
  const [transcripts, setTranscripts] = useState<{t: string, isU: boolean}[]>([]);

  const handleLogin = (name: string, jersey: string, role: string) => {
    const users = getStorage(KEYS.USERS);
    let u = users.find((curr: any) => curr.jersey === jersey);
    if (!u) {
      u = { name, jersey, role, points: 0, streak: 0 };
      users.push(u);
      setStorage(KEYS.USERS, users);
    }
    setUser(u);
    setScreen(role === 'COACH' ? 'COACH' : 'ATHLETE');
  };

  const getDailyInsight = async () => {
    setLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const res = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `You are an elite varsity sports psychologist. Give a 1-sentence leadership challenge for an athlete whose effort is ${metrics.effort}/5. Be intense and direct.`
      });
      setInsight(res.text || "Standard is the standard.");
    } catch (e) {
      setInsight("Winning is the byproduct of relentless discipline.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (screen === 'VOICE') {
      startVoiceLab(
        (t, isU) => setTranscripts(prev => [...prev.slice(-3), { t, isU }]),
        (err) => { alert(err.message); setScreen('ATHLETE'); }
      );
    }
    return () => { if (screen === 'VOICE') stopVoiceLab(); };
  }, [screen]);

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex flex-col max-w-md mx-auto overflow-hidden">
      
      {screen === 'LOGIN' && (
        <div className="flex-1 flex flex-col justify-center p-8 space-y-12 animate-in fade-in zoom-in duration-500">
          <div className="text-center">
            <h1 className="text-7xl font-black italic tracking-tighter text-white">LORDS<span className="text-green-500">LAB</span></h1>
            <p className="text-slate-500 font-bold uppercase tracking-[0.4em] text-[10px] mt-2">Elite Varsity Protocol</p>
          </div>
          <Card className="space-y-4">
            <input id="ln" placeholder="Athlete Last Name" className="w-full bg-slate-950/50 border border-slate-800 rounded-2xl p-5 outline-none focus:border-green-500 text-white font-bold" />
            <input id="jn" placeholder="Jersey #" className="w-full bg-slate-950/50 border border-slate-800 rounded-2xl p-5 outline-none focus:border-green-500 text-white font-bold" />
            <div className="flex gap-2 p-1 bg-slate-950 rounded-2xl border border-slate-800" id="rs">
              <button onClick={(e: any) => e.target.parentElement.dataset.role = 'ATHLETE'} className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all bg-green-600">Athlete</button>
              <button onClick={(e: any) => e.target.parentElement.dataset.role = 'COACH'} className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all">Coach</button>
            </div>
            <button 
              onClick={() => {
                const n = (document.getElementById('ln') as any).value;
                const j = (document.getElementById('jn') as any).value;
                const r = (document.getElementById('rs') as any).dataset.role || 'ATHLETE';
                if(n && j) handleLogin(n, j, r);
              }}
              className="w-full py-5 bg-green-600 hover:bg-green-500 text-white font-black rounded-3xl shadow-xl shadow-green-900/30 transition-all active:scale-95"
            >
              ACCESS SYSTEM
            </button>
          </Card>
        </div>
      )}

      {screen === 'ATHLETE' && user && (
        <div className="flex-1 p-6 space-y-6 overflow-y-auto pb-32 animate-in slide-in-from-bottom duration-500">
          <header className="flex justify-between items-center py-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-green-600 rounded-2xl flex items-center justify-center font-black text-white shadow-xl">#{user.jersey}</div>
              <div>
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Active Unit</p>
                <p className="text-2xl font-black italic text-white uppercase">{user.name}</p>
              </div>
            </div>
            <button onClick={() => setScreen('LOGIN')} className="p-4 rounded-2xl bg-slate-900 border border-slate-800 text-slate-500"><LogOut size={20}/></button>
          </header>

          <Card className="bg-gradient-to-br from-green-600/20 to-slate-900 border-green-500/20">
            <div className="flex items-center gap-2 mb-3 text-green-400 font-black text-[10px] uppercase tracking-widest">
              <Sparkles size={14}/> Daily Directive
            </div>
            {insight ? (
              <p className="text-lg font-bold italic leading-tight text-white">"{insight}"</p>
            ) : (
              <button onClick={getDailyInsight} className="text-[10px] text-green-500 font-black uppercase tracking-widest bg-green-500/10 px-4 py-2 rounded-full border border-green-500/20">
                {loading ? 'Analyzing...' : 'Sync Insight'}
              </button>
            )}
          </Card>

          <Card className="space-y-12 py-10">
            <div className="space-y-6">
              <div className="flex justify-between items-end">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Effort</span>
                <span className="text-6xl font-black text-green-500 tabular-nums">{metrics.effort}</span>
              </div>
              <input type="range" min="1" max="5" step="0.5" value={metrics.effort} onChange={e => setMetrics({...metrics, effort: parseFloat(e.target.value)})} className="w-full" />
            </div>
            <div className="space-y-6">
              <div className="flex justify-between items-end">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Attitude</span>
                <span className="text-6xl font-black text-yellow-500 tabular-nums">{metrics.attitude}</span>
              </div>
              <input type="range" min="1" max="5" step="0.5" value={metrics.attitude} onChange={e => setMetrics({...metrics, attitude: parseFloat(e.target.value)})} className="w-full" />
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-4">
            <button onClick={() => alert("Standard Locked.")} className="h-28 bg-green-600 rounded-[2rem] font-black text-white flex flex-col items-center justify-center gap-2 active:scale-95 transition-all shadow-xl shadow-green-900/30">
              <CheckCircle size={32}/>
              <span className="text-[10px] uppercase tracking-widest">Lock In</span>
            </button>
            <button onClick={() => setScreen('VOICE')} className="h-28 bg-slate-900 border border-slate-800 rounded-[2rem] font-black text-white flex flex-col items-center justify-center gap-2 active:scale-95 transition-all">
              <Mic size={32} className="text-green-500"/>
              <span className="text-[10px] uppercase tracking-widest">Voice Lab</span>
            </button>
          </div>
        </div>
      )}

      {screen === 'VOICE' && (
        <div className="flex-1 bg-black flex flex-col items-center justify-center p-8 text-center space-y-12 animate-in fade-in duration-700">
          <div className="relative">
            <div className="absolute inset-0 bg-green-500/10 blur-[100px] animate-pulse rounded-full"></div>
            <div className="w-56 h-56 rounded-full border border-green-500/20 flex items-center justify-center relative bg-slate-900/30">
              <Mic size={80} className="text-green-500 drop-shadow-[0_0_20px_rgba(34,197,94,0.6)]" />
              <div className="absolute inset-0 border-2 border-green-500/40 rounded-full animate-ping opacity-20"></div>
            </div>
          </div>
          <div className="w-full space-y-4 h-48 overflow-y-auto px-4 mask-fade">
            {transcripts.map((t, i) => (
              <p key={i} className={`text-sm ${t.isU ? 'text-slate-600' : 'text-green-400 font-black italic animate-in fade-in slide-in-from-left'}`}>
                {t.isU ? 'UNIT: ' : 'LAB: '}{t.t}
              </p>
            ))}
            {transcripts.length === 0 && <p className="text-slate-700 font-black uppercase text-[10px] animate-pulse">Establishing Secure Uplink...</p>}
          </div>
          <button onClick={() => setScreen('ATHLETE')} className="w-full py-6 bg-slate-900 border border-slate-800 rounded-[2rem] text-slate-500 font-black hover:text-white transition-all">
            TERMINATE SESSION
          </button>
        </div>
      )}

      {screen === 'COACH' && (
        <div className="flex-1 p-6 space-y-8 overflow-y-auto pb-32 animate-in slide-in-from-right duration-500">
          <header className="flex justify-between items-center py-6">
            <h1 className="text-3xl font-black italic text-white uppercase tracking-tighter">COACH<span className="text-green-500">LAB</span></h1>
            <button onClick={() => setScreen('LOGIN')} className="p-4 rounded-2xl bg-slate-900 border border-slate-800 text-slate-500"><LogOut size={20}/></button>
          </header>

          <div className="grid grid-cols-2 gap-4">
            <Card className="text-center py-10">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Team Intensity</p>
              <p className="text-6xl font-black text-green-400">4.9</p>
            </Card>
            <Card className="text-center py-10">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Engagement</p>
              <p className="text-6xl font-black text-white">98%</p>
            </Card>
          </div>

          <Card className="p-0 overflow-hidden divide-y divide-slate-800/50">
            {getStorage(KEYS.USERS).map((u: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-slate-900 rounded-xl flex items-center justify-center font-black text-slate-500 border border-slate-800">#{u.jersey}</div>
                  <span className="font-bold text-lg">{u.name}</span>
                </div>
                <div className="text-right">
                  <p className="font-black text-green-400 text-xl">{u.points}</p>
                  <p className="text-[9px] font-bold text-slate-600 uppercase">Leadership Score</p>
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}

    </div>
  );
};

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(<App />);
}

