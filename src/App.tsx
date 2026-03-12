import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, Bot, User, BarChart3, Upload, Loader2, 
  Download, Trash2, MessageSquare, ChevronRight,
  TrendingUp, DollarSign, Target, MousePointer2,
  Zap, Activity, Bell, Settings, LayoutDashboard,
  Database, PieChart as PieChartIcon, Flame,
  Cpu, Search, Plus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { analyzePrompt, AnalysisInstruction } from './services/aiService';
import { DynamicChart } from './components/DynamicChart';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  instruction?: AnalysisInstruction;
  data?: any[];
  timestamp: Date;
}

const BackgroundParticles = () => {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
      {[...Array(20)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full bg-fire-orange/10 blur-2xl"
          initial={{ 
            x: Math.random() * 100 + "%", 
            y: Math.random() * 100 + "%",
            scale: Math.random() * 2 + 1,
            opacity: Math.random() * 0.2
          }}
          animate={{ 
            y: [null, "-100%"],
            opacity: [0, 0.2, 0]
          }}
          transition={{ 
            duration: Math.random() * 15 + 15, 
            repeat: Infinity, 
            ease: "linear",
            delay: Math.random() * 10
          }}
          style={{ width: Math.random() * 200 + 100, height: Math.random() * 200 + 100 }}
        />
      ))}
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [hasData, setHasData] = useState(false);
  const [schema, setSchema] = useState<string>('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    fetchSchema();
  }, []);

  const fetchSchema = async () => {
    try {
      const response = await fetch('/api/schema');
      const data = await response.json();
      if (data.schema && data.schema.length > 0) {
        const schemaInfo = data.schema;
        const schemaStr = schemaInfo.map((s: any) => `- ${s.name} (${s.type})`).join('\n');
        setSchema(schemaStr);
        setHasData(true);
      }
    } catch (error) {
      console.error('Error fetching schema:', error);
    }
  };

  const uploadToServer = async (data: any[]) => {
    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });

      if (response.ok) {
        const result = await response.json();
        const schemaInfo = result.columns.map((c: string) => `- ${c} (TEXT)`).join('\n');
        setSchema(schemaInfo);
        setHasData(true);
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: `Data uploaded successfully! I've analyzed the dataset. You can now ask questions about it.`,
          timestamp: new Date()
        }]);
      }
    } catch (error) {
      console.error('Upload error:', error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.csv')) {
      Papa.parse(file, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: async (results) => {
          await uploadToServer(results.data);
        }
      });
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const bstr = evt.target?.result;
          const wb = XLSX.read(bstr, { type: 'binary' });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const data = XLSX.utils.sheet_to_json(ws);
          await uploadToServer(data);
        } catch (error: any) {
          console.error("Excel parse failed", error);
          setIsUploading(false);
        }
      };
      reader.readAsBinaryString(file);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const result = await analyzePrompt(input, schema);
      
      // Fetch data for the instruction
      const queryResponse = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: result.sql }),
      });
      
      const queryData = await queryResponse.json();

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result.explanation,
        instruction: result,
        data: queryData.results || [],
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Analysis error:', error);
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error analyzing your request. Please try again.',
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearData = async () => {
    try {
      await fetch('/api/clear', { method: 'POST' });
      setHasData(false);
      setSchema('');
      setMessages([]);
    } catch (error) {
      console.error('Clear error:', error);
    }
  };

  return (
    <div className="flex h-screen bg-deep-black text-zinc-100 overflow-hidden relative selection:bg-fire-orange/30">
      <BackgroundParticles />
      
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: sidebarCollapsed ? 80 : 280 }}
        className="glass-panel m-4 mr-0 flex flex-col border-white/5 relative z-10 overflow-hidden"
      >
        <div className="p-6 flex items-center gap-3">
          <motion.div 
            whileHover={{ rotate: 180 }}
            className="w-10 h-10 rounded-xl bg-gradient-to-br from-fire-red to-fire-orange flex items-center justify-center shadow-[0_0_20px_rgba(255,78,0,0.4)] shrink-0"
          >
            <Flame className="text-white w-6 h-6" />
          </motion.div>
          {!sidebarCollapsed && (
            <motion.div 
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex flex-col"
            >
              <span className="font-bold text-xl tracking-tighter neon-text leading-none">Ash Board</span>
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">Intelligence BI</span>
            </motion.div>
          )}
        </div>

        <div className="flex-1 px-4 space-y-2 overflow-y-auto py-4">
          <SidebarItem icon={<LayoutDashboard />} label="Dashboard" active collapsed={sidebarCollapsed} />
          <SidebarItem icon={<Activity />} label="Analytics" collapsed={sidebarCollapsed} />
          <SidebarItem icon={<PieChartIcon />} label="Reports" collapsed={sidebarCollapsed} />
          <SidebarItem icon={<Database />} label="Datasets" collapsed={sidebarCollapsed} />
          <SidebarItem icon={<Settings />} label="Settings" collapsed={sidebarCollapsed} />
        </div>

        <div className="p-4 space-y-4">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="w-full glass-panel glow-border p-3 flex items-center justify-center gap-2 text-fire-orange hover:text-white transition-all group"
          >
            {isUploading ? <Loader2 className="animate-spin" /> : <Plus className="group-hover:rotate-90 transition-transform" />}
            {!sidebarCollapsed && <span className="font-bold text-sm">New Dataset</span>}
          </motion.button>
          <input type="file" ref={fileInputRef} onChange={handleUpload} className="hidden" accept=".csv,.xlsx,.xls" />
          
          {hasData && !sidebarCollapsed && (
            <button onClick={clearData} className="w-full p-2 text-[10px] text-zinc-600 hover:text-red-400 flex items-center justify-center gap-2 transition-colors uppercase tracking-widest font-bold">
              <Trash2 size={12} /> Purge Data
            </button>
          )}
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col p-4 gap-4 overflow-hidden relative z-10">
        {/* Header */}
        <header className="glass-panel p-4 flex items-center justify-between border-white/5">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-white/5 border border-white/10">
              <div className="ai-pulse">
                <span className="ai-pulse-dot"></span>
                <span className="ai-pulse-center"></span>
              </div>
              <span className="text-xs font-bold text-ai-glow uppercase tracking-tighter">Neural Link Active</span>
            </div>
            <div className="h-4 w-[1px] bg-white/10 hidden sm:block" />
            <div className="hidden sm:flex items-center gap-2 text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
              <Activity size={14} className="text-fire-orange" />
              <span>System Load: 12%</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
              <input 
                placeholder="Search intelligence..." 
                className="bg-white/5 border border-white/10 rounded-xl py-2 pl-10 pr-4 text-xs focus:outline-none focus:border-fire-orange/50 transition-all w-64"
              />
            </div>
            <button className="p-2 rounded-xl hover:bg-white/5 text-zinc-400 transition-colors relative">
              <Bell size={20} />
              <span className="absolute top-2 right-2 w-2 h-2 bg-fire-red rounded-full shadow-[0_0_10px_rgba(255,0,0,0.5)]"></span>
            </button>
            <div className="flex items-center gap-3 pl-4 border-l border-white/10">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold">Owais Khader</p>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Senior Analyst</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-zinc-700 to-zinc-900 border border-white/10 flex items-center justify-center overflow-hidden shadow-lg">
                <User className="text-zinc-400" />
              </div>
            </div>
          </div>
        </header>

        {/* Dashboard Grid */}
        <div className="flex-1 flex flex-col gap-4 overflow-hidden">
          {!hasData ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <motion.div 
                animate={{ 
                  scale: [1, 1.1, 1],
                  rotate: [0, 5, -5, 0]
                }}
                transition={{ duration: 6, repeat: Infinity }}
                className="w-40 h-40 rounded-3xl bg-fire-orange/5 flex items-center justify-center mb-12 relative group"
              >
                <div className="absolute inset-0 rounded-3xl border-2 border-dashed border-fire-orange/20 animate-[spin_30s_linear_infinite]" />
                <div className="absolute inset-4 rounded-2xl border border-fire-orange/10 animate-[spin_20s_linear_infinite_reverse]" />
                <Zap size={64} className="text-fire-orange drop-shadow-[0_0_20px_rgba(255,78,0,0.5)]" />
              </motion.div>
              <h2 className="text-4xl font-black mb-4 tracking-tighter uppercase">Initialize Intelligence</h2>
              <p className="text-zinc-500 max-w-md mb-12 text-lg leading-relaxed">Connect your marketing datasets to activate the AI command center and begin deep neural analysis.</p>
              <motion.button 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => fileInputRef.current?.click()}
                className="px-12 py-5 glass-panel glow-border text-fire-orange font-black uppercase tracking-widest hover:text-white transition-all shadow-[0_0_30px_rgba(255,78,0,0.2)]"
              >
                Connect Data Source
              </motion.button>
            </div>
          ) : (
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 overflow-hidden">
              {/* Chat Panel */}
              <div className="lg:col-span-4 flex flex-col glass-panel border-white/5 overflow-hidden">
                <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                  <div className="flex items-center gap-2">
                    <Cpu size={18} className="text-ai-glow" />
                    <span className="font-black text-xs uppercase tracking-widest">AI Command</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <div className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Neural Link Established</div>
                  </div>
                </div>
                
                <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth">
                  {messages.length === 0 && (
                    <div className="text-center py-8">
                      <p className="text-[10px] text-zinc-600 mb-6 uppercase tracking-[0.2em] font-black">Suggested Neural Queries</p>
                      <div className="space-y-3">
                        {[
                          'Show me revenue trends by month', 
                          'Top 5 performing campaigns', 
                          'Customer acquisition cost analysis'
                        ].map((q, i) => (
                          <motion.button 
                            key={i} 
                            whileHover={{ x: 5, backgroundColor: 'rgba(255,255,255,0.05)' }}
                            onClick={() => { setInput(q); handleSendMessage(); }}
                            className="w-full p-4 text-left text-xs glass-panel border-white/5 transition-all text-zinc-400 hover:text-fire-orange"
                          >
                            {q}
                          </motion.button>
                        ))}
                      </div>
                    </div>
                  )}
                  {messages.map((m) => (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, x: m.role === 'user' ? 20 : -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={cn(
                        "flex gap-3",
                        m.role === 'user' ? "flex-row-reverse" : ""
                      )}
                    >
                      <div className={cn(
                        "w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-lg",
                        m.role === 'user' ? "bg-zinc-800" : "bg-fire-orange/20 text-fire-orange border border-fire-orange/20"
                      )}>
                        {m.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                      </div>
                      <div className={cn(
                        "max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed",
                        m.role === 'user' ? "bg-zinc-800 text-zinc-200" : "bg-white/[0.03] text-zinc-300 border border-white/5 shadow-xl"
                      )}>
                        <div className="markdown-body">
                          {m.content}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  {isLoading && (
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-xl bg-fire-orange/20 text-fire-orange flex items-center justify-center border border-fire-orange/20 shadow-lg">
                        <Loader2 size={16} className="animate-spin" />
                      </div>
                      <div className="bg-white/[0.03] p-4 rounded-2xl border border-white/5 shadow-xl">
                        <div className="flex gap-1.5">
                          <motion.div animate={{ opacity: [0.3, 1, 0.3], scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="w-2 h-2 bg-fire-orange rounded-full" />
                          <motion.div animate={{ opacity: [0.3, 1, 0.3], scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-2 h-2 bg-fire-orange rounded-full" />
                          <motion.div animate={{ opacity: [0.3, 1, 0.3], scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-2 h-2 bg-fire-orange rounded-full" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <form onSubmit={handleSendMessage} className="p-4 border-t border-white/5 bg-white/[0.01]">
                  <div className="relative">
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Ask AI for deep insights..."
                      className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-5 pr-14 text-sm focus:outline-none focus:border-fire-orange/50 transition-all placeholder:text-zinc-600"
                    />
                    <motion.button 
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      type="submit"
                      disabled={isLoading || !input.trim()}
                      className="absolute right-2 top-2 p-2.5 bg-fire-orange text-white rounded-xl shadow-lg disabled:opacity-50 disabled:grayscale"
                    >
                      <Send size={20} />
                    </motion.button>
                  </div>
                </form>
              </div>

              {/* Analytics Panel */}
              <div className="lg:col-span-8 flex flex-col gap-4 overflow-y-auto pr-2 custom-scrollbar">
                {/* Stats Row */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <StatCard icon={<TrendingUp />} label="Growth" value="+24.5%" trend="up" />
                  <StatCard icon={<DollarSign />} label="Revenue" value="$1.2M" trend="up" />
                  <StatCard icon={<Target />} label="Conversion" value="3.8%" trend="down" />
                </div>

                {/* Main Visualization */}
                <AnimatePresence mode="wait">
                  {messages.filter(m => m.instruction).length > 0 ? (
                    <motion.div
                      key={messages.filter(m => m.instruction).slice(-1)[0].id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="glass-panel p-8 border-white/5 min-h-[500px] flex flex-col relative group"
                    >
                      <div className="absolute top-0 left-0 w-full h-1 energy-line opacity-30" />
                      {(() => {
                        const lastMsg = messages.filter(m => m.instruction).slice(-1)[0];
                        return (
                          <>
                            <div className="flex items-center justify-between mb-8">
                              <div>
                                <h3 className="text-2xl font-black tracking-tighter uppercase">{lastMsg.instruction?.title}</h3>
                                <div className="flex items-center gap-2 mt-2">
                                  <div className="w-2 h-2 rounded-full bg-fire-orange animate-pulse" />
                                  <p className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-black">Live Intelligence Feed</p>
                                </div>
                              </div>
                              <div className="flex gap-3">
                                <motion.button whileHover={{ scale: 1.1 }} className="p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors border border-white/5"><Download size={18} /></motion.button>
                                <motion.button whileHover={{ scale: 1.1 }} className="p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors border border-white/5"><Settings size={18} /></motion.button>
                              </div>
                            </div>
                            <div className="flex-1 min-h-[350px]">
                              <ErrorBoundary fallback={<div className="h-full flex flex-col items-center justify-center text-red-500 bg-red-50/5 rounded-3xl border border-red-500/20">
                                <Activity size={48} className="mb-4 opacity-50" />
                                <span className="font-black uppercase tracking-widest text-xs">Visualizer Offline</span>
                              </div>}>
                                <DynamicChart 
                                  type={lastMsg.instruction?.chart_type || 'bar'}
                                  data={lastMsg.data || []}
                                  title={lastMsg.instruction?.title || ''}
                                  metrics={lastMsg.instruction?.metrics || []}
                                  dimensions={lastMsg.instruction?.dimensions || []}
                                />
                              </ErrorBoundary>
                            </div>
                          </>
                        );
                      })()}
                    </motion.div>
                  ) : (
                    <div className="glass-panel p-16 border-white/5 flex flex-col items-center justify-center text-center bg-white/[0.01]">
                      <motion.div 
                        animate={{ rotate: 360 }}
                        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                        className="w-24 h-24 rounded-3xl border border-white/10 flex items-center justify-center mb-8 relative"
                      >
                        <div className="absolute inset-2 rounded-2xl border border-fire-orange/20" />
                        <BarChart3 size={40} className="text-zinc-700" />
                      </motion.div>
                      <h3 className="text-xl font-black uppercase tracking-widest mb-3">Awaiting Analysis</h3>
                      <p className="text-sm text-zinc-500 max-w-xs leading-relaxed">Ask a question in the command center to generate interactive neural visualizations.</p>
                    </div>
                  )}
                </AnimatePresence>

                {/* Recent Activity / Insights */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4">
                  <div className="glass-panel p-6 border-white/5 bg-white/[0.01]">
                    <div className="flex items-center justify-between mb-6">
                      <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Neural Insights</h4>
                      <Zap size={14} className="text-fire-orange" />
                    </div>
                    <div className="space-y-4">
                      <InsightItem text="Revenue spike detected in North America region." type="success" />
                      <InsightItem text="Ad spend efficiency decreasing on Social channels." type="warning" />
                      <InsightItem text="New customer segment identified: Tech Early Adopters." type="info" />
                    </div>
                  </div>
                  <div className="glass-panel p-6 border-white/5 bg-white/[0.01]">
                    <div className="flex items-center justify-between mb-6">
                      <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">System Telemetry</h4>
                      <Cpu size={14} className="text-ai-glow" />
                    </div>
                    <div className="space-y-5">
                      <TelemetryItem label="Processing Power" value={78} color="bg-fire-orange" />
                      <TelemetryItem label="Data Integrity" value={99} color="bg-emerald-500" />
                      <TelemetryItem label="AI Confidence" value={92} color="bg-ai-glow" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function SidebarItem({ icon, label, active = false, collapsed = false }: { icon: React.ReactNode, label: string, active?: boolean, collapsed?: boolean }) {
  return (
    <motion.button
      whileHover={{ x: 4, backgroundColor: active ? 'rgba(255,78,0,0.15)' : 'rgba(255,255,255,0.05)' }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        "w-full flex items-center gap-4 p-4 rounded-2xl transition-all relative group",
        active ? "bg-fire-orange/10 text-fire-orange shadow-[inset_0_0_20px_rgba(255,78,0,0.05)]" : "text-zinc-500 hover:text-zinc-200"
      )}
    >
      <div className={cn(
        "transition-all duration-300 group-hover:scale-110",
        active ? "text-fire-orange drop-shadow-[0_0_8px_rgba(255,78,0,0.5)]" : ""
      )}>
        {React.cloneElement(icon as React.ReactElement<{ size?: number }>, { size: 22 })}
      </div>
      {!collapsed && <span className="text-sm font-bold uppercase tracking-widest">{label}</span>}
      {active && (
        <motion.div 
          layoutId="active-pill"
          className="absolute left-0 w-1.5 h-8 bg-fire-orange rounded-r-full shadow-[0_0_15px_rgba(255,78,0,0.8)]"
        />
      )}
    </motion.button>
  );
}

function StatCard({ icon, label, value, trend }: { icon: React.ReactNode, label: string, value: string, trend: 'up' | 'down' }) {
  return (
    <motion.div 
      whileHover={{ y: -8, scale: 1.02 }}
      className="glass-panel p-6 border-white/5 group relative overflow-hidden bg-white/[0.01]"
    >
      <div className="absolute -top-4 -right-4 p-2 opacity-[0.03] group-hover:opacity-[0.08] transition-all duration-500 group-hover:scale-150 group-hover:-rotate-12">
        {React.cloneElement(icon as React.ReactElement<{ size?: number }>, { size: 120 })}
      </div>
      <div className="flex items-center gap-2 text-zinc-500 mb-4">
        <div className="p-2 rounded-lg bg-white/5 border border-white/5">
          {React.cloneElement(icon as React.ReactElement<{ size?: number }>, { size: 16 })}
        </div>
        <span className="text-[10px] uppercase tracking-[0.2em] font-black">{label}</span>
      </div>
      <div className="flex items-end justify-between relative z-10">
        <span className="text-3xl font-black tracking-tighter">{value}</span>
        <div className={cn(
          "flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-lg border",
          trend === 'up' ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-fire-red/10 text-fire-red border-fire-red/20"
        )}>
          {trend === 'up' ? <TrendingUp size={10} /> : <TrendingUp size={10} className="rotate-180" />}
          12%
        </div>
      </div>
      <div className="mt-4 h-1 w-full bg-white/5 rounded-full overflow-hidden">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: '65%' }}
          className={cn("h-full", trend === 'up' ? "bg-emerald-500" : "bg-fire-red")}
        />
      </div>
    </motion.div>
  );
}

function InsightItem({ text, type }: { text: string, type: 'success' | 'warning' | 'info' }) {
  const colors = {
    success: 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]',
    warning: 'bg-fire-orange shadow-[0_0_10px_rgba(255,78,0,0.5)]',
    info: 'bg-ai-glow shadow-[0_0_10px_rgba(139,92,246,0.5)]'
  };
  return (
    <motion.div 
      whileHover={{ x: 5 }}
      className="flex items-start gap-4 group cursor-pointer p-2 rounded-xl hover:bg-white/[0.02] transition-colors"
    >
      <div className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0", colors[type])} />
      <p className="text-xs text-zinc-400 group-hover:text-zinc-200 transition-colors leading-relaxed">{text}</p>
    </motion.div>
  );
}

function TelemetryItem({ label, value, color }: { label: string, value: number, color: string }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-[10px] uppercase tracking-[0.2em] font-black text-zinc-500">
        <span>{label}</span>
        <span className="text-zinc-300">{value}%</span>
      </div>
      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden p-[1px]">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 1.5, ease: "easeOut" }}
          className={cn("h-full rounded-full relative", color)}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_2s_infinite]" />
        </motion.div>
      </div>
    </div>
  );
}
